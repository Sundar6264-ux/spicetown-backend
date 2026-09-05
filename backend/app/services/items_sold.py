"""Items sold on a given calendar date - our own logic, not Toast's dashboard
number, chosen deliberately per the user's explicit direction on 2026-09-01
after checking both approaches against real data. Documented here precisely
since "how is the total computed" is exactly what's been asked to be clear
about.

**Exactly how a date's total is computed:**

1. Every line item (a sold product, or a priced modifier) has a "paid at"
   timestamp resolved in `sales_sync.py::_extract_line_items`: the check's
   own `paidDate`, falling back to the order's own `paidDate`, falling back
   (ONLY if the order/check is voided) to the order's `createdDate` just so
   a comped/voided row has *some* date - voided rows are excluded from
   revenue regardless of what date they land on. A real, non-voided order
   that simply hasn't been paid yet has no resolved paid_at and doesn't
   count toward any date's total until it's actually paid.
2. A line item counts toward date D if its resolved paid_at falls on D, in
   the restaurant's own timezone - **not** whichever calendar day Toast's
   own `businessDate` field happens to file the order under. Concretely: if
   a guest pays today for a pickup scheduled tomorrow, that sale counts as
   TODAY's - the day the money actually came in - not tomorrow's, even
   though Toast internally files the whole order under tomorrow.
3. Revenue for a date is the sum of every counted item's own net price
   (post per-item discount, pre-tax) - not each check's official total.
   This is a deliberate, known difference from Toast's own daily dashboard
   figure, which is bucketed by `businessDate` instead of payment date and
   uses each check's official total (which nets out a check-level discount
   that isn't reflected in the sum of individual item prices). Both were
   checked against real data on 2026-09-01: this app's number and Toast's
   number will not always match exactly, on purpose, because they answer a
   genuinely different question ("what did we actually get paid for today"
   vs. "what's Toast's own headline number for this business date").

The nightly cron only ever syncs *yesterday and earlier* (see scheduler.py) -
today's business date has no rows in `orders` yet. So "today" (or any date
that hasn't closed out yet) is pulled live from Toast on demand instead of
from the DB; any earlier date is served from the already-synced `orders`
table, which is faster and doesn't re-hit Toast's API for static history.
"""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order
from app.services.sales_sync import _extract_line_items
from app.timeutil import restaurant_today, to_restaurant_date
from app.toast_client import fetch_orders_for_business_date


def _items_sold_live(target_date: dt.date) -> list[dict]:
    # A payment made on target_date for a pickup scheduled the next day gets
    # filed by Toast under tomorrow's businessDate, not today's - fetch both
    # and keep only the line items that actually resolve to target_date once
    # paid_at is checked. (Fetching a not-yet-started future business date is
    # safe - Toast returns an empty list for it, handled in toast_client.)
    raw_today = fetch_orders_for_business_date(target_date)
    raw_next = fetch_orders_for_business_date(target_date + dt.timedelta(days=1))

    line_items = [li for order in raw_today for li in _extract_line_items(order)]
    line_items += [li for order in raw_next for li in _extract_line_items(order)]

    agg: dict[str, dict] = {}
    for li in line_items:
        if li["voided"]:
            continue
        paid_at = li.get("paid_at")
        if paid_at is None:
            continue  # not actually paid yet - doesn't count until it is
        if to_restaurant_date(paid_at) != target_date:
            continue
        key = li["item_guid"] or li["item_name"] or "unknown"
        row = agg.setdefault(key, {"item_id": li["item_guid"], "name": li["item_name"], "quantity": 0.0, "revenue": 0.0})
        row["quantity"] += li["quantity"]
        row["revenue"] += li["net_price"]
    return list(agg.values())


def _items_sold_stored(db: Session, target_date: dt.date) -> list[dict]:
    # Widen the business_date window by a day on each side, since a row's
    # business_date can be one day off from its actual paid_at date - then do
    # the exact date match in Python against paid_at. Rows synced before
    # paid_at existed have it NULL; fall back to business_date for those so
    # old, never-re-synced history doesn't just disappear.
    window_start = target_date - dt.timedelta(days=1)
    window_end = target_date + dt.timedelta(days=1)
    stmt = select(
        Order.item_guid,
        Order.item_name,
        Order.quantity,
        Order.net_price,
        Order.paid_at,
        Order.business_date,
    ).where(
        Order.business_date >= window_start,
        Order.business_date <= window_end,
        Order.voided.is_(False),
    )

    agg: dict[str, dict] = {}
    for item_guid, item_name, quantity, net_price, paid_at, business_date in db.execute(stmt):
        effective_date = to_restaurant_date(paid_at) if paid_at is not None else business_date
        if effective_date != target_date:
            continue
        key = item_guid or item_name or "unknown"
        row = agg.setdefault(key, {"item_id": item_guid, "name": item_name, "quantity": 0.0, "revenue": 0.0})
        row["quantity"] += quantity
        row["revenue"] += net_price
    return list(agg.values())


def get_items_sold(db: Session, target_date: dt.date) -> dict:
    if target_date >= restaurant_today():
        items = _items_sold_live(target_date)
        source = "live"  # pulled fresh from Toast just now, not yet in our DB
    else:
        items = _items_sold_stored(db, target_date)
        source = "stored"  # served from the already-synced orders table

    for item in items:
        item["quantity"] = round(item["quantity"], 3)
        item["revenue"] = round(item["revenue"], 2)
        item["avg_price"] = round(item["revenue"] / item["quantity"], 2) if item["quantity"] else 0.0

    items.sort(key=lambda i: i["revenue"], reverse=True)

    return {
        "date": target_date.isoformat(),
        "source": source,
        "items": items,
        "total_quantity": round(sum(i["quantity"] for i in items), 3),
        "total_revenue": round(sum(i["revenue"] for i in items), 2),
    }
