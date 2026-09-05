"""CRUD for the persistent, multi-supplier purchase order cart (see CartItem
in models.py). One shared cart for the store, not per-user - any staff
member can add to or check any supplier's section.
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CartItem


def add_items(db: Session, supplier: str, items: list[dict], added_by_user_id: Optional[int]) -> list[CartItem]:
    """Add one or more items to `supplier`'s cart section. An item with a
    real `item_id` that's already in that supplier's cart has its quantity
    replaced (re-adding the same reorder-candidate item updates the
    quantity rather than creating a duplicate row); a hand-added item with
    no `item_id` always becomes its own new row, since name alone isn't a
    reliable identity for a real product.
    """
    added = []
    for item in items:
        item_id = item.get("item_id")
        existing = None
        if item_id:
            existing = db.execute(
                select(CartItem).where(CartItem.supplier == supplier, CartItem.item_id == item_id)
            ).scalar_one_or_none()
        if existing:
            existing.qty = item["qty"]
            existing.case_of = item.get("case_of") or existing.case_of
            existing.name = item.get("name") or existing.name
            existing.supplier_item_id = item.get("supplier_item_id") or existing.supplier_item_id
            added.append(existing)
        else:
            row = CartItem(
                supplier=supplier,
                item_id=item_id,
                name=item["name"],
                supplier_item_id=item.get("supplier_item_id"),
                qty=item["qty"],
                case_of=item.get("case_of") or 1.0,
                added_by_user_id=added_by_user_id,
            )
            db.add(row)
            added.append(row)
    db.commit()
    for row in added:
        db.refresh(row)
    return added


def list_cart(db: Session) -> list[CartItem]:
    stmt = select(CartItem).order_by(CartItem.supplier, CartItem.added_at)
    return list(db.execute(stmt).scalars())


def update_item(
    db: Session, cart_item_id: int, qty: Optional[float] = None, case_of: Optional[float] = None
) -> Optional[CartItem]:
    row = db.get(CartItem, cart_item_id)
    if row is None:
        return None
    if qty is not None:
        row.qty = qty
    if case_of is not None:
        row.case_of = case_of
    db.commit()
    db.refresh(row)
    return row


def delete_item(db: Session, cart_item_id: int) -> bool:
    row = db.get(CartItem, cart_item_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def clear_supplier(db: Session, supplier: str) -> int:
    rows = list(db.execute(select(CartItem).where(CartItem.supplier == supplier)).scalars())
    for row in rows:
        db.delete(row)
    db.commit()
    return len(rows)
