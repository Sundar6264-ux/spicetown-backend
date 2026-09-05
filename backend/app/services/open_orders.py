"""Open orders - Toast orders that have not yet been closed on the POS.

Two ways to see this:
  - get_open_orders(business_date): a live, single-date pull straight from
    Toast (one API call) - stays fast, used for "today" in the UI.
  - The "all-time" view (every business date since real sales began) is too
    expensive to compute live on every page load (~100+ Toast API calls,
    several minutes) - see the real ~3.5 minute scan confirmed in this
    project's skill notes. Instead it's kept in `open_order_cache`
    (models.py), refreshed in the background on a schedule
    (scheduler.py) via refresh_open_orders_cache(), and read instantly by
    get_cached_open_orders(). The cache is a full-replace snapshot, not an
    append-only log - a row not present after a scan means that order is no
    longer open (closed, or fell outside the scanned range).
"""

import datetime as dt
import json
import logging
import time
from typing import Optional

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import JobRun, OpenOrderCache
from app.services.sales_sync import _extract_line_items, _parse_toast_timestamp
from app.timeutil import restaurant_today, utcnow
from app.toast_client import fetch_employees, fetch_orders_for_business_date

logger = logging.getLogger(__name__)

JOB_NAME = "open_orders_scan"

_EMPLOYEE_CACHE: dict = {"at": 0.0, "by_guid": {}}
_EMPLOYEE_CACHE_TTL_SECONDS = 600

# Real order volume (actual line items, not empty onboarding test orders)
# starts here - confirmed in an earlier session by checking for real
# non-voided selections, not just order objects existing. Scanning further
# back than this for an "all time" open-orders sweep would only spend Toast
# API calls on dates that can't contain anything real to find.
FIRST_REAL_SALES_DATE = dt.date(2026, 5, 26)


def _employee_name(emp: dict) -> str:
    chosen = (emp.get("chosenName") or "").strip()
    first = (emp.get("firstName") or "").strip()
    last = (emp.get("lastName") or "").strip()
    full = " ".join(p for p in (first, last) if p)
    if chosen and full:
        return f"{full} ({chosen})"
    return chosen or full or "Unknown"


def get_employees(force_refresh: bool = False) -> list[dict]:
    """[{guid, name}] for every non-deleted Toast employee, cached briefly -
    the employee roster changes rarely, so there's no need to hit Toast's
    Labor API on every single open-orders refresh.
    """
    now = time.time()
    if force_refresh or now - _EMPLOYEE_CACHE["at"] > _EMPLOYEE_CACHE_TTL_SECONDS:
        raw = fetch_employees()
        by_guid = {
            e["guid"]: _employee_name(e)
            for e in raw
            if not e.get("deleted") and e.get("guid")
        }
        _EMPLOYEE_CACHE["by_guid"] = by_guid
        _EMPLOYEE_CACHE["at"] = now
    return [{"guid": guid, "name": name} for guid, name in sorted(_EMPLOYEE_CACHE["by_guid"].items(), key=lambda kv: kv[1])]


def _order_total(order: dict) -> float:
    total = 0.0
    for check in order.get("checks") or []:
        amt = check.get("totalAmount")
        if isinstance(amt, (int, float)):
            total += amt
    return round(total, 2)


def _line_items(order: dict) -> list[dict]:
    """Top-level (non-modifier, non-voided) items on this order, reusing
    sales_sync.py's own selection-flattening so modifier/voided handling
    can't drift between "what counts as a sold item" and "what shows up
    here" (see the modifier-double-counting gotcha in the project skill).
    """
    items = []
    for row in _extract_line_items(order):
        if row["parent_selection_guid"] is not None or row["voided"]:
            continue
        items.append({"name": row["item_name"] or "Item", "quantity": row["quantity"]})
    return items


def _paid_at(o: dict) -> Optional[dt.datetime]:
    """The order is only "paid" if every check on it has a paidDate - a
    split-check order with one paid, one still open isn't fully settled.
    Returns the latest of the checks' paidDate (when it became fully paid).
    """
    checks = o.get("checks") or []
    if not checks:
        return None
    paid_dates = []
    for c in checks:
        d = _parse_toast_timestamp(c.get("paidDate"), "check paidDate")
        if d is None:
            return None  # at least one check unpaid -> order not fully paid
        paid_dates.append(d)
    return max(paid_dates)


def _promised_at(o: dict) -> Optional[dt.datetime]:
    # promisedDate is the guest-facing commitment (e.g. a scheduled pickup/
    # delivery time); estimatedFulfillmentDate is Toast's own estimate when
    # no explicit promise was made. Same "future order" pattern as gotcha
    # #12 in the project skill - a guest can pay tonight for tomorrow.
    raw = o.get("promisedDate") or o.get("estimatedFulfillmentDate")
    return _parse_toast_timestamp(raw, "promisedDate") if raw else None


def _normalize_open_order(o: dict, business_date: dt.date, names_by_guid: dict, now: dt.datetime) -> dict:
    server = o.get("server") or {}
    server_guid = server.get("guid")
    opened_at = _parse_toast_timestamp(o.get("openedDate"), "openedDate")
    elapsed_minutes = None
    if opened_at is not None:
        elapsed_minutes = round((now - opened_at).total_seconds() / 60)
    paid_at = _paid_at(o)
    promised_at = _promised_at(o)
    return {
        "guid": o.get("guid"),
        "business_date": business_date.isoformat(),
        "display_number": o.get("displayNumber"),
        "opened_at": opened_at.isoformat() if opened_at else None,
        "elapsed_minutes": elapsed_minutes,
        "server_guid": server_guid,
        "server_name": names_by_guid.get(server_guid, "Unknown"),
        "num_guests": o.get("numberOfGuests"),
        "approval_status": o.get("approvalStatus"),
        "total_amount": _order_total(o),
        "num_checks": len(o.get("checks") or []),
        "line_items": _line_items(o),
        "paid_at": paid_at.isoformat() if paid_at else None,
        "promised_at": promised_at.isoformat() if promised_at else None,
    }


def _fetch_with_retry(business_date: dt.date, max_retries: int = 4) -> list[dict]:
    """fetch_orders_for_business_date, retrying on Toast's 429 (real rate
    limit hit roughly once per 25-30 sequential day-requests during the
    original historical backfill - see the project skill) with exponential
    backoff, honoring Retry-After when Toast sends one.
    """
    delay = 2.0
    for attempt in range(max_retries + 1):
        try:
            return fetch_orders_for_business_date(business_date)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries:
                retry_after = e.response.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else delay
                logger.info("Toast 429 for %s, retrying in %.1fs", business_date, wait)
                time.sleep(wait)
                delay *= 2
                continue
            raise
    raise RuntimeError(f"Failed to fetch orders for {business_date} after {max_retries} retries")


def get_open_orders(business_date: dt.date, employee_guid: Optional[str] = None) -> list[dict]:
    """Currently-open orders for one Toast business date: opened, not
    voided/deleted, and never closed. Optionally filtered to one employee
    (matched against the order's `server` guid). Live pull, one API call -
    used for the fast single-date view (normally "today").
    """
    employees = get_employees()
    names_by_guid = {e["guid"]: e["name"] for e in employees}

    raw_orders = fetch_orders_for_business_date(business_date)
    now = utcnow()
    results = []
    for o in raw_orders:
        if o.get("closedDate") or o.get("voided") or o.get("deleted"):
            continue
        server_guid = (o.get("server") or {}).get("guid")
        if employee_guid and server_guid != employee_guid:
            continue
        results.append(_normalize_open_order(o, business_date, names_by_guid, now))
    results.sort(key=lambda r: r["opened_at"] or "")
    return results


def _scan_open_orders(start: dt.date, end: dt.date) -> list[dict]:
    """One Toast API call per date in [start, end] (plus pagination on busy
    days), retried on rate limits, with a small courtesy delay between
    requests. This is the genuinely slow part (real-world: ~100+ calls,
    minutes) - callers should not run this inline on a request a user is
    waiting on; see refresh_open_orders_cache.
    """
    employees = get_employees()
    names_by_guid = {e["guid"]: e["name"] for e in employees}
    now = utcnow()

    open_orders: list[dict] = []
    d = start
    while d <= end:
        raw_orders = _fetch_with_retry(d)
        for o in raw_orders:
            if o.get("closedDate") or o.get("voided") or o.get("deleted"):
                continue
            open_orders.append(_normalize_open_order(o, d, names_by_guid, now))
        d += dt.timedelta(days=1)
        time.sleep(0.15)
    return open_orders


def _replace_cache_rows(db: Session, orders: list[dict], business_dates: Optional[list[dt.date]] = None) -> None:
    """Replaces cache rows with fresh `orders`. If `business_dates` is given,
    only rows for those dates are deleted first (a partial/"today" refresh
    that must leave older cached days untouched); otherwise every existing
    row is cleared first (a full rescan, where "not present in `orders`
    anymore" correctly means "no longer open").
    """
    now = utcnow()
    if business_dates is not None:
        db.execute(delete(OpenOrderCache).where(OpenOrderCache.business_date.in_(business_dates)))
    else:
        db.execute(delete(OpenOrderCache))
    for o in orders:
        db.add(
            OpenOrderCache(
                toast_order_guid=o["guid"],
                business_date=dt.date.fromisoformat(o["business_date"]),
                display_number=o["display_number"],
                opened_at=dt.datetime.fromisoformat(o["opened_at"]) if o["opened_at"] else None,
                server_guid=o["server_guid"],
                server_name=o["server_name"],
                num_guests=o["num_guests"],
                approval_status=o["approval_status"],
                total_amount=o["total_amount"],
                num_checks=o["num_checks"],
                line_items_json=json.dumps(o["line_items"]),
                paid_at=dt.datetime.fromisoformat(o["paid_at"]) if o["paid_at"] else None,
                promised_at=dt.datetime.fromisoformat(o["promised_at"]) if o["promised_at"] else None,
                scanned_at=now,
            )
        )
    db.commit()


def refresh_open_orders_cache(db: Session, full: bool = False) -> JobRun:
    """Rescans Toast and replaces `open_order_cache`.

    full=False (the frequent, cheap tick): only re-scans today's business
    date - covers the vast majority of real status changes (an order opening
    or closing), since a day that's weeks old essentially never changes.
    full=True (the once-daily sweep): re-scans the entire history from
    FIRST_REAL_SALES_DATE, the only way to catch an order that's been stuck
    open on an OLDER date that a today-only refresh would never look at
    again once that date rolled off "today".
    """
    job = JobRun(job_name=JOB_NAME, status="running")
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        if full:
            start = FIRST_REAL_SALES_DATE
            end = restaurant_today()
            orders = _scan_open_orders(start, end)
            _replace_cache_rows(db, orders, business_dates=None)
            job.detail = f"full scan {start}..{end}: {len(orders)} open order(s)"
        else:
            today = restaurant_today()
            orders = _scan_open_orders(today, today)
            _replace_cache_rows(db, orders, business_dates=[today])
            job.detail = f"today ({today}) refresh: {len(orders)} open order(s)"
        job.status = "success"
    except Exception as exc:  # noqa: BLE001 - log and record, don't crash the caller
        db.rollback()
        logger.exception("Open orders cache refresh failed (full=%s)", full)
        job.status = "failed"
        job.detail = str(exc)
    finally:
        job.finished_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
        db.refresh(job)
    return job


def get_cached_open_orders(db: Session, employee_guid: Optional[str] = None) -> dict:
    """Instant read of the background-refreshed cache - no live Toast calls."""
    stmt = select(OpenOrderCache)
    if employee_guid:
        stmt = stmt.where(OpenOrderCache.server_guid == employee_guid)
    rows = db.execute(stmt).scalars().all()

    bounds_stmt = select(
        JobRun.started_at, JobRun.finished_at, JobRun.status, JobRun.detail
    ).where(JobRun.job_name == JOB_NAME).order_by(JobRun.started_at.desc()).limit(1)
    last_job = db.execute(bounds_stmt).first()

    scanned_from = min((r.business_date for r in rows), default=None)
    scanned_to = max((r.business_date for r in rows), default=None)
    last_refreshed_at = max((r.scanned_at for r in rows), default=None)

    orders = [
        {
            "guid": r.toast_order_guid,
            "business_date": r.business_date.isoformat(),
            "display_number": r.display_number,
            "opened_at": r.opened_at.isoformat() if r.opened_at else None,
            # r.opened_at already comes back UTC-aware (UTCDateTime re-attaches
            # tzinfo on read - see db.py), so this is a plain aware-aware diff.
            "elapsed_minutes": (
                round((utcnow() - r.opened_at).total_seconds() / 60) if r.opened_at else None
            ),
            "server_guid": r.server_guid,
            "server_name": r.server_name,
            "num_guests": r.num_guests,
            "approval_status": r.approval_status,
            "total_amount": r.total_amount,
            "num_checks": r.num_checks,
            "line_items": json.loads(r.line_items_json) if r.line_items_json else [],
            "paid_at": r.paid_at.isoformat() if r.paid_at else None,
            "promised_at": r.promised_at.isoformat() if r.promised_at else None,
        }
        for r in rows
    ]
    orders.sort(key=lambda o: o["opened_at"] or "")
    return {
        "scanned_from": scanned_from.isoformat() if scanned_from else None,
        "scanned_to": scanned_to.isoformat() if scanned_to else None,
        "last_refreshed_at": last_refreshed_at.isoformat() if last_refreshed_at else None,
        "last_job_status": last_job.status if last_job else None,
        "orders": orders,
    }
