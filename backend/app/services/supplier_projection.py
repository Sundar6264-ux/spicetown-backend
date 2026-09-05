"""Per-supplier demand projection across multiple horizons (1wk/2wk/3wk/month, etc.).

`inventory_snapshots.supplier` sometimes lists multiple suppliers for one item,
semicolon-separated (e.g. "KP Produce;Raja Foods;Sai Florals") - a real quirk in
the Toast Retail export, not a bug. Split those out for the supplier list and
for matching which items belong to a chosen supplier.

The daily export also carries a second "Container" row for some items - same
item name, tracking on-hand quantity held in a different physical storage
location, but with no price/cost/supplier/sales of its own (it's not a
separately-sellable line, and it's why it's excluded from `matching_items`
below). There's no captured column that labels this directly - the Toast
export column that would (something under "storage locations" / "item multi
location id", currently ignored - see inventory_parser.py) was never
confirmed against a real file. What's confirmed against real data instead:
of 29 retail items sharing a name with another row, 26 fit "one priced row +
one bare row" exactly, and the bare row always has `price IS NULL` and no
supplier. The other 3 (e.g. Banana Leaves) have two real priced rows and are
genuinely different products, not an Each/Container split - left alone. See
`_container_qty_by_name`.
"""

import datetime as dt
from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from app.models import InventorySnapshot
from app.services.forecast import forecast_daily_demand
from app.services.reorder import latest_inventory_by_item


def _split_suppliers(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(";") if s.strip()]


def _supplier_item_id_for(snap, supplier: str) -> Optional[str]:
    """`supplier_item_id` is semicolon-separated in the same order as `supplier`
    when an item has multiple vendors - pick the entry at the matching index.
    Falls back to the raw (possibly single) value if the two lists don't line
    up 1:1, which is better than showing nothing.
    """
    suppliers = _split_suppliers(snap.supplier)
    item_ids = _split_suppliers(getattr(snap, "supplier_item_id", None))
    if not item_ids:
        return None
    if len(suppliers) == len(item_ids) and supplier in suppliers:
        return item_ids[suppliers.index(supplier)]
    return item_ids[0] if len(item_ids) == 1 else "; ".join(item_ids)


def _container_qty_by_name(
    latest_inventory: dict[str, InventorySnapshot]
) -> dict[str, tuple[str, float]]:
    """Name -> (item_id, qty) for the bare Container-location duplicate of a
    priced item, per the heuristic in this module's docstring. Skips any name
    with more than one bare candidate - ambiguous, and not a pattern seen in
    real data yet, so safer to leave those items un-merged than guess.
    """
    candidates: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for item_id, snap in latest_inventory.items():
        if snap.price is None and not snap.supplier and snap.inventory_quantity is not None:
            candidates[snap.name].append((item_id, snap.inventory_quantity))
    return {name: matches[0] for name, matches in candidates.items() if len(matches) == 1}


def list_suppliers(db: Session) -> list[str]:
    latest = latest_inventory_by_item(db)
    names = set()
    for snap in latest.values():
        for name in _split_suppliers(snap.supplier):
            names.add(name)
    return sorted(names)


def compute_supplier_projection(
    db: Session,
    supplier: str,
    lookback_days: int,
    horizons_days: list[int],
    as_of_date: Optional[dt.date] = None,
) -> list[dict]:
    as_of_date = as_of_date or dt.date.today()

    latest_inventory = latest_inventory_by_item(db)
    demand_by_item = forecast_daily_demand(db, lookback_days, as_of_date)
    container_qty_by_name = _container_qty_by_name(latest_inventory)

    matching_items = {
        item_id: snap
        for item_id, snap in latest_inventory.items()
        if supplier in _split_suppliers(snap.supplier)
    }

    results = []
    for item_id, snap in matching_items.items():
        demand = demand_by_item.get(item_id)
        avg_daily_demand = demand["avg_daily_demand"] if demand else 0.0
        on_hand = snap.inventory_quantity  # may be None - not all items are quantity-tracked

        container = container_qty_by_name.get(snap.name)
        container_qty = container[1] if container else None
        if container_qty is not None:
            on_hand = (on_hand or 0.0) + container_qty

        projections = {}
        for horizon in horizons_days:
            projected_demand = round(avg_daily_demand * horizon, 2)
            need_to_order = round(max(0.0, projected_demand - on_hand), 2) if on_hand is not None else None
            projections[str(horizon)] = {
                "projected_demand": projected_demand,
                "need_to_order": need_to_order,
            }

        results.append(
            {
                "item_id": item_id,
                "name": snap.name,
                "category": snap.category,
                "avg_daily_demand": round(avg_daily_demand, 3),
                "avg_weekly_demand": round(avg_daily_demand * 7, 2),
                "on_hand_qty": on_hand,
                "container_qty": container_qty,
                "supplier_item_id": _supplier_item_id_for(snap, supplier),
                "inventory_snapshot_date": snap.snapshot_date.isoformat(),
                "projections": projections,
            }
        )

    max_horizon = str(max(horizons_days))
    results.sort(
        key=lambda r: r["projections"][max_horizon]["need_to_order"]
        if r["projections"][max_horizon]["need_to_order"] is not None
        else r["projections"][max_horizon]["projected_demand"],
        reverse=True,
    )
    return results
