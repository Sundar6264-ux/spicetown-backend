"""Pulls a day's completed orders from Toast and upserts line items into `orders`.

Idempotency: each selection (line item) carries a unique Toast GUID
(`toast_selection_guid`). Re-running this for a date that's already been
synced updates existing rows in place (via an upsert keyed on that GUID)
rather than creating duplicates, so it's safe to re-run or backfill.
"""

import datetime as dt
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import JobRun, Order
from app.toast_client import fetch_orders_for_business_date

logger = logging.getLogger(__name__)

JOB_NAME = "toast_sales_sync"


def _parse_toast_timestamp(raw: Optional[str], field_name: str) -> Optional[dt.datetime]:
    if not raw:
        return None
    # Toast returns e.g. "2026-08-23T18:28:45.000+0000" - a +HHMM offset with no
    # colon, which datetime.fromisoformat can't parse (even on 3.11+, since the
    # fractional seconds aren't exactly 3 or 6 digits in all cases). strptime's
    # %z accepts both the colon and no-colon offset forms.
    try:
        return dt.datetime.strptime(raw, "%Y-%m-%dT%H:%M:%S.%f%z")
    except ValueError:
        logger.warning("Could not parse order %s %r", field_name, raw)
        return None


def _flatten_selection(
    selection: dict,
    order_guid: str,
    check_guid: str,
    opened_at: Optional[dt.datetime],
    paid_at: Optional[dt.datetime],
    order_dining_option: Optional[str],
    order_voided: bool,
    check_voided: bool,
    parent_selection_guid: Optional[str],
) -> list[dict]:
    """One selection can carry its own nested `modifiers` (e.g. "extra cheese"),
    each of which is itself a full selection object with its own guid/price/tax
    and can in turn carry further modifiers (e.g. a combo's sub-choices). Every
    level gets its own `orders` row - modifiers have real, separate prices and
    were previously silently dropped, undercounting captured revenue.
    """
    quantity = float(selection.get("quantity") or 0)
    net_price = float(selection.get("price") or 0)
    unit_price = net_price / quantity if quantity else net_price
    tax_amount = float(selection.get("tax") or 0)
    item_obj = selection.get("item") or {}
    selection_guid = selection.get("guid", "")

    rows = [
        {
            "toast_order_guid": order_guid,
            "toast_check_guid": check_guid,
            "toast_selection_guid": selection_guid,
            "parent_selection_guid": parent_selection_guid,
            "opened_at": opened_at,
            "paid_at": paid_at,
            "item_guid": item_obj.get("guid"),
            "item_name": selection.get("displayName") or selection.get("name"),
            "quantity": quantity,
            "unit_price": unit_price,
            "net_price": net_price,
            "tax_amount": tax_amount,
            "voided": order_voided or check_voided or bool(selection.get("voided", False)),
            "dining_option": order_dining_option,
        }
    ]

    for modifier in selection.get("modifiers", []) or []:
        rows.extend(
            _flatten_selection(
                modifier,
                order_guid,
                check_guid,
                opened_at,
                paid_at,
                order_dining_option,
                order_voided,
                check_voided,
                parent_selection_guid=selection_guid,
            )
        )
    return rows


def _extract_line_items(raw_order: dict) -> list[dict]:
    """Flatten a raw Toast order JSON object into one dict per selection (line item),
    including nested modifier selections.
    """
    order_guid = raw_order.get("guid", "")
    opened_at = _parse_toast_timestamp(raw_order.get("openedDate"), "openedDate")
    order_paid_at = _parse_toast_timestamp(raw_order.get("paidDate"), "paidDate")
    order_created_at = _parse_toast_timestamp(raw_order.get("createdDate"), "createdDate")
    # Toast's order payload only returns a diningOption reference (guid), not a human
    # name — resolving that would need a separate call to the Restaurant Config API,
    # out of scope for this phase. Store the guid as-is.
    order_dining_option = (raw_order.get("diningOption") or {}).get("guid")
    order_voided = bool(raw_order.get("voided", False))

    items = []
    for check in raw_order.get("checks", []) or []:
        check_guid = check.get("guid", "")
        check_voided = bool(check.get("voided", False))
        # Prefer the check's own paidDate (a split-check order can have checks
        # paid at different times); fall back to the order-level paidDate.
        # Only fall back further to createdDate (placement time) when the
        # order/check is actually voided - a comped/voided check never gets a
        # real paidDate from Toast, but it's excluded from every revenue total
        # downstream via the `voided` flag regardless of what date it lands
        # on, so this fallback is purely cosmetic for that case. A real,
        # non-voided order that simply hasn't been paid yet (e.g. a
        # prepaid-later future-pickup order still marked unpaid) must NOT get
        # this fallback - it hasn't actually generated revenue yet, and using
        # createdDate here was counting its price as "sold" on the day it was
        # placed rather than the day (if ever) it's actually paid, inflating
        # Items Sold for a day that hadn't really earned that money. Leaving
        # check_paid_at as None for that case lets the existing "no paid_at ->
        # skip/fall back to business_date" handling in items_sold.py exclude
        # or defer it correctly instead.
        check_paid_at = _parse_toast_timestamp(check.get("paidDate"), "check paidDate") or order_paid_at
        if check_paid_at is None and (order_voided or check_voided):
            check_paid_at = order_created_at
        for selection in check.get("selections", []) or []:
            items.extend(
                _flatten_selection(
                    selection,
                    order_guid,
                    check_guid,
                    opened_at,
                    check_paid_at,
                    order_dining_option,
                    order_voided,
                    check_voided,
                    parent_selection_guid=None,
                )
            )
    return items


def _upsert_line_items(db: Session, business_date: dt.date, line_items: list[dict]) -> int:
    count = 0
    for item in line_items:
        if not item["toast_selection_guid"]:
            continue
        stmt = sqlite_insert(Order).values(business_date=business_date, **item)
        update_cols = {c: getattr(stmt.excluded, c) for c in item if c != "toast_selection_guid"}
        update_cols["business_date"] = business_date
        stmt = stmt.on_conflict_do_update(
            index_elements=[Order.toast_selection_guid],
            set_=update_cols,
        )
        db.execute(stmt)
        count += 1
    return count


def sync_sales_for_date(db: Session, business_date: dt.date) -> JobRun:
    job = JobRun(job_name=JOB_NAME, status="running", business_date=business_date)
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        raw_orders = fetch_orders_for_business_date(business_date)
        line_items = [li for order in raw_orders for li in _extract_line_items(order)]
        synced = _upsert_line_items(db, business_date, line_items)
        db.commit()

        job.status = "success"
        job.detail = f"{synced} line items synced from {len(raw_orders)} orders"
    except Exception as exc:  # noqa: BLE001 - want to log any failure and keep going
        db.rollback()
        logger.exception("Sales sync failed for %s", business_date)
        job.status = "failed"
        job.detail = str(exc)
    finally:
        job.finished_at = dt.datetime.now(dt.timezone.utc)
        db.add(job)
        db.commit()
        db.refresh(job)

    return job


def latest_job_run(db: Session, job_name: str) -> Optional[JobRun]:
    stmt = (
        select(JobRun)
        .where(JobRun.job_name == job_name)
        .order_by(JobRun.started_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()
