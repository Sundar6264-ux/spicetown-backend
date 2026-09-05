"""CRUD for manually-logged purchase/receiving records (see PurchaseLogEntry
in models.py for why this exists instead of pulling from Toast).
"""

import datetime as dt
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PurchaseLogEntry


def create_purchase_entry(
    db: Session,
    item_id: str,
    item_name: Optional[str],
    supplier: Optional[str],
    quantity_received: float,
    unit_cost: Optional[float],
    received_date: dt.date,
    notes: Optional[str],
    logged_by_user_id: Optional[int],
) -> PurchaseLogEntry:
    entry = PurchaseLogEntry(
        item_id=item_id,
        item_name=item_name,
        supplier=supplier,
        quantity_received=quantity_received,
        unit_cost=unit_cost,
        received_date=received_date,
        notes=notes,
        logged_by_user_id=logged_by_user_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_purchase_entries(
    db: Session, start_date: Optional[dt.date] = None, end_date: Optional[dt.date] = None
) -> list[PurchaseLogEntry]:
    stmt = select(PurchaseLogEntry).order_by(
        PurchaseLogEntry.received_date.desc(), PurchaseLogEntry.id.desc()
    )
    if start_date is not None:
        stmt = stmt.where(PurchaseLogEntry.received_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(PurchaseLogEntry.received_date <= end_date)
    return list(db.execute(stmt).scalars())


def delete_purchase_entry(db: Session, entry_id: int) -> bool:
    entry = db.get(PurchaseLogEntry, entry_id)
    if entry is None:
        return False
    db.delete(entry)
    db.commit()
    return True
