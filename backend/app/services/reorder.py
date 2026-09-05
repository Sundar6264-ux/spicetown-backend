"""Reorder trigger: forecasted demand over vendor lead time vs. latest on-hand count.

No PAR levels (confirmed unused by the store - see spec). Vendor lead time is a
temporary manual input (query parameter) rather than pulled from
`vendors_reference`, because the Toast credentials currently in use don't have
Purchasing & Receiving API scope (confirmed via a live 403) - that table is
scaffolded but empty. Once vendor data is available, lead_time_days should be
looked up per-item/vendor from `vendors_reference` instead of passed in flat.

Only items with a known on-hand quantity (i.e. present in the latest inventory
snapshot with a non-null `inventory_quantity`) are considered - an item absent
from the snapshot might be a prepared kitchen item never tracked in the retail
export, not an out-of-stock retail product, so defaulting it to on_hand=0 would
falsely flag it as needing reorder.
"""

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventorySnapshot
from app.services.forecast import forecast_daily_demand


def latest_inventory_by_item(
    db: Session, as_of_date: Optional[dt.date] = None
) -> dict[str, InventorySnapshot]:
    """The most recent snapshot per item - as of right now by default, or as
    of a given date (the latest snapshot on or before it) when `as_of_date`
    is given, e.g. to answer "what was on hand going into this period" for
    reconciliation (services/reconciliation.py) rather than "what's on hand
    today".
    """
    latest_dates_query = select(
        InventorySnapshot.item_id,
        func.max(InventorySnapshot.snapshot_date).label("max_date"),
    )
    if as_of_date is not None:
        latest_dates_query = latest_dates_query.where(InventorySnapshot.snapshot_date <= as_of_date)
    latest_dates = latest_dates_query.group_by(InventorySnapshot.item_id).subquery()

    stmt = select(InventorySnapshot).join(
        latest_dates,
        (InventorySnapshot.item_id == latest_dates.c.item_id)
        & (InventorySnapshot.snapshot_date == latest_dates.c.max_date),
    )
    return {row.item_id: row for row in db.execute(stmt).scalars()}


def compute_reorder_candidates(
    db: Session,
    lookback_days: int,
    lead_time_days: int,
    as_of_date: Optional[dt.date] = None,
) -> list[dict]:
    as_of_date = as_of_date or dt.date.today()

    demand_by_item = forecast_daily_demand(db, lookback_days, as_of_date)
    inventory_by_item = latest_inventory_by_item(db)

    candidates = []
    for item_id, demand in demand_by_item.items():
        snap = inventory_by_item.get(item_id)
        if snap is None or snap.inventory_quantity is None:
            continue  # no known on-hand count - can't assess reorder need

        forecast_over_lead_time = demand["avg_daily_demand"] * lead_time_days
        shortfall = forecast_over_lead_time - snap.inventory_quantity
        if shortfall <= 0:
            continue

        candidates.append(
            {
                "item_id": item_id,
                "name": demand["name"] or snap.name,
                "avg_daily_demand": round(demand["avg_daily_demand"], 3),
                "forecast_over_lead_time": round(forecast_over_lead_time, 2),
                "on_hand_qty": snap.inventory_quantity,
                "shortfall": round(shortfall, 2),
                "supplier": snap.supplier,
                "category": snap.category,
                "inventory_snapshot_date": snap.snapshot_date.isoformat(),
            }
        )

    candidates.sort(key=lambda c: c["shortfall"], reverse=True)
    return candidates
