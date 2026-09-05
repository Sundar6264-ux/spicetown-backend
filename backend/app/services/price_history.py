"""Price-change tracking across daily inventory snapshots.

`inventory_snapshots` has one row per item per upload date, so an item's price
history is just its rows ordered by date. This only has as much history as
there have been uploads - a single-snapshot database (e.g. day one) will
correctly report zero changes, not an error.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InventorySnapshot


def _snapshots_by_item(db: Session) -> dict[str, list[InventorySnapshot]]:
    stmt = select(InventorySnapshot).order_by(InventorySnapshot.item_id, InventorySnapshot.snapshot_date)
    by_item: dict[str, list[InventorySnapshot]] = {}
    for row in db.execute(stmt).scalars():
        by_item.setdefault(row.item_id, []).append(row)
    return by_item


def get_price_changed_items(db: Session) -> list[dict]:
    """Only items with at least one detected price change between consecutive
    snapshots - not the whole catalog.
    """
    by_item = _snapshots_by_item(db)
    results = []

    for item_id, snaps in by_item.items():
        change_count = 0
        last_change = None
        prev = None
        for snap in snaps:
            if prev is not None and prev.price is not None and snap.price is not None and snap.price != prev.price:
                change_count += 1
                last_change = {"date": snap.snapshot_date.isoformat(), "old_price": prev.price, "new_price": snap.price}
            prev = snap

        if change_count == 0:
            continue

        latest = snaps[-1]
        results.append(
            {
                "item_id": item_id,
                "name": latest.name,
                "category": latest.category,
                "barcode": latest.barcode,
                "current_price": latest.price,
                "previous_price": last_change["old_price"],
                "last_change_date": last_change["date"],
                "change_count": change_count,
            }
        )

    results.sort(key=lambda r: r["last_change_date"], reverse=True)
    return results


def search_price_history(db: Session, query: str) -> list[dict]:
    """Items whose latest name or barcode matches `query` (case-insensitive
    substring), each with its full price/cost timeline across every snapshot
    date on file - regardless of whether the price ever actually changed,
    since a flat history ("never changed") is itself a useful answer here.
    """
    needle = query.strip().lower()
    if not needle:
        return []

    by_item = _snapshots_by_item(db)
    matches = []
    for item_id, snaps in by_item.items():
        latest = snaps[-1]
        name_match = bool(latest.name) and needle in latest.name.lower()
        barcode_match = bool(latest.barcode) and needle in latest.barcode.lower()
        if not (name_match or barcode_match):
            continue

        matches.append(
            {
                "item_id": item_id,
                "name": latest.name,
                "barcode": latest.barcode,
                "category": latest.category,
                "history": [
                    {"date": s.snapshot_date.isoformat(), "price": s.price, "cost": s.cost} for s in snaps
                ],
            }
        )

    matches.sort(key=lambda m: m["name"] or "")
    return matches
