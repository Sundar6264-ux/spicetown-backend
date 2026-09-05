"""Phase 3 - Reconciliation: purchased vs. sold vs. counted, the
shrinkage/spoilage signal.

    expected_closing = opening_count + purchased - sold
    variance = actual_closing_count - expected_closing

A negative variance means less is physically on hand than the math says
there should be - shrinkage, spoilage, theft, or an unlogged giveaway/waste.
A positive variance usually means an unlogged purchase or a miscount.

"Purchased" comes from the manual `purchase_log` table (see models.py -
Toast's Purchasing API isn't accessible with current credentials, see skill
gotcha #15). "Sold" reuses forecast.py's exact query (top-level, non-voided,
modifier-excluded - the established-correct definition of "really sold",
see skill gotcha #17) so this doesn't risk re-introducing that bug with a
second, slightly-different query. "Counted" is whatever the closest
inventory upload on or before each boundary date says.
"""

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventorySnapshot, PurchaseLogEntry
from app.services.forecast import forecast_daily_demand
from app.services.reorder import latest_inventory_by_item


def _purchased_in_range(db: Session, start_date: dt.date, end_date: dt.date) -> dict[str, float]:
    stmt = (
        select(PurchaseLogEntry.item_id, func.sum(PurchaseLogEntry.quantity_received))
        .where(
            PurchaseLogEntry.received_date >= start_date,
            PurchaseLogEntry.received_date <= end_date,
        )
        .group_by(PurchaseLogEntry.item_id)
    )
    return {item_id: float(qty) for item_id, qty in db.execute(stmt)}


def get_reconciliation(db: Session, start_date: dt.date, end_date: dt.date) -> list[dict]:
    # "Opening" = on-hand as of the day *before* the period starts (what you
    # had going into it); "closing" = on-hand as of the period's last day.
    opening = latest_inventory_by_item(db, as_of_date=start_date - dt.timedelta(days=1))
    closing = latest_inventory_by_item(db, as_of_date=end_date)

    purchased_by_item = _purchased_in_range(db, start_date, end_date)

    # forecast_daily_demand's window is [as_of_date - lookback_days, as_of_date)
    # - exclusive at the end, so push as_of_date one day past end_date to
    # include a full end_date's sales. Its `total_quantity` (not the average)
    # is exactly the "sold" figure needed here.
    lookback_days = (end_date - start_date).days + 1
    demand = forecast_daily_demand(db, lookback_days, end_date + dt.timedelta(days=1))
    sold_by_item = {item_id: d["total_quantity"] for item_id, d in demand.items()}

    all_item_ids = set(opening) | set(closing) | set(purchased_by_item) | set(sold_by_item)

    results = []
    for item_id in all_item_ids:
        opening_snap = opening.get(item_id)
        closing_snap = closing.get(item_id)
        opening_qty = opening_snap.inventory_quantity if opening_snap else None
        closing_qty = closing_snap.inventory_quantity if closing_snap else None

        if opening_qty is None or closing_qty is None:
            continue  # can't reconcile without a real count on both ends

        purchased = purchased_by_item.get(item_id, 0.0)
        sold = sold_by_item.get(item_id, 0.0)

        if purchased == 0 and sold == 0:
            continue  # nothing happened for this item in the window - not interesting

        expected_closing = opening_qty + purchased - sold
        variance = closing_qty - expected_closing

        name = (closing_snap or opening_snap).name
        cost = closing_snap.cost if closing_snap and closing_snap.cost is not None else None

        results.append(
            {
                "item_id": item_id,
                "name": name,
                "category": (closing_snap or opening_snap).category,
                "supplier": (closing_snap or opening_snap).supplier,
                "opening_qty": round(opening_qty, 2),
                "purchased": round(purchased, 2),
                "sold": round(sold, 2),
                "expected_closing_qty": round(expected_closing, 2),
                "actual_closing_qty": round(closing_qty, 2),
                "variance_qty": round(variance, 2),
                "variance_value": round(variance * cost, 2) if cost is not None else None,
            }
        )

    results.sort(key=lambda r: r["variance_qty"])
    return results


def get_reconciliation_demo(db: Session) -> Optional[dict]:
    """A real-data walkthrough for the Reconciliation tab's Demo section -
    runs get_reconciliation() over the widest window the current inventory
    snapshot history actually supports (opening needs a real snapshot the
    day before the window starts), so this stays valid as more uploads
    accumulate instead of pointing at a hardcoded date range that goes stale.

    Highlights one real item with a positive variance (actual on hand more
    than the math expects) if one exists, since that's the clearest example
    of what an unlogged purchase looks like in the report - the largest
    negative-variance item, by contrast, is just as likely a miscount or a
    Toast-side data quirk (see skill gotcha on dead-stock anomalies) and
    would be a confusing thing to hold up as "here's how a purchase shows up."
    """
    earliest, latest = db.execute(
        select(func.min(InventorySnapshot.snapshot_date), func.max(InventorySnapshot.snapshot_date))
    ).first()
    if earliest is None or latest is None or earliest >= latest:
        return None  # not enough snapshot history yet for even a one-day window

    start_date = earliest + dt.timedelta(days=1)
    end_date = latest
    items = get_reconciliation(db, start_date, end_date)
    if not items:
        return None

    positive = [r for r in items if r["variance_qty"] > 0]
    highlight = max(positive, key=lambda r: r["variance_qty"]) if positive else items[0]

    return {
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "item_count": len(items),
        "highlight": highlight,
        "items": items[:10],
    }
