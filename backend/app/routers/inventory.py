import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.features import require_feature
from app.models import JobRun
from app.schemas import InventoryUploadResult
from app.services.csv_util import rows_to_csv
from app.services.inventory_parser import InventoryParseError, parse_and_store
from app.services.price_history import get_price_changed_items, search_price_history
from app.services.reorder import latest_inventory_by_item
from app.services.supplier_projection import _split_suppliers, _supplier_item_id_for

router = APIRouter(prefix="/api/inventory", tags=["inventory"], dependencies=[Depends(get_current_user)])

JOB_NAME = "inventory_upload"


# Deliberately not feature-gated beyond plain login: this lightweight name
# search is a shared helper used by several different pages/features
# (Reconciliation's item picker, PO Cart's "add an item" search, Delivery/
# Transfer Review) - gating it would mean an OR of every feature that
# happens to use it today, and breaking silently the next time a new page
# starts using it too. It only returns id/name/category/supplier - the same
# category of info already visible on several already-gated pages.
@router.get("/items/search")
def search_items(
    q: str = Query(..., min_length=1),
    supplier: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Lightweight name search over the latest inventory snapshot, for
    autocomplete (e.g. picking a real item when logging a purchase, or
    finding an existing item to add to a supplier's PO cart) - not a full
    report, just id/name/category/supplier, capped at 25 matches. When
    `supplier` is given, only items actually carried by that vendor are
    returned (see supplier_projection.py's `_split_suppliers` for why a
    plain `==` check doesn't work - one item can list several suppliers),
    and each match's own supplier_item_id (that vendor's SKU) is resolved.
    """
    needle = q.strip().lower()
    supplier_filter = supplier.strip() if supplier else None
    latest = latest_inventory_by_item(db)
    matches = []
    for item_id, snap in latest.items():
        if not snap.name or needle not in snap.name.lower():
            continue
        if supplier_filter and supplier_filter not in _split_suppliers(snap.supplier):
            continue
        matches.append(
            {
                "item_id": item_id,
                "name": snap.name,
                "category": snap.category,
                "supplier": snap.supplier,
                "supplier_item_id": _supplier_item_id_for(snap, supplier_filter) if supplier_filter else None,
            }
        )
    matches.sort(key=lambda m: m["name"])
    return {"items": matches[:25]}


@router.get("/price-changes", dependencies=[Depends(require_feature("inventory_reports"))])
def price_changes(db: Session = Depends(get_db)):
    items = get_price_changed_items(db)
    return {"count": len(items), "items": items}


@router.get("/price-changes/export", dependencies=[Depends(require_feature("inventory_reports"))])
def price_changes_export(db: Session = Depends(get_db)):
    items = get_price_changed_items(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="price-change-log.csv"'},
    )


@router.get("/price-history", dependencies=[Depends(require_feature("inventory_reports"))])
def price_history(search: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    return {"items": search_price_history(db, search)}


# InventoryUpload lives on the Overview page, so this is gated as "overview".
@router.post("/upload", response_model=InventoryUploadResult, dependencies=[Depends(require_feature("overview"))])
async def upload_inventory(
    file: UploadFile = File(...),
    snapshot_date: Optional[dt.date] = None,
    db: Session = Depends(get_db),
):
    target_date = snapshot_date or dt.date.today()

    job = JobRun(job_name=JOB_NAME, status="running", business_date=target_date)
    db.add(job)
    db.commit()

    try:
        content = await file.read()
        result = parse_and_store(db, file.filename or "upload", content, target_date)

        job.status = "success"
        job.detail = (
            f"{result['rows_loaded']} items loaded for {target_date.isoformat()}. "
            f"Columns ignored (not in COLUMN_MAP): {', '.join(result['columns_ignored']) or 'none'}"
        )
        job.finished_at = dt.datetime.now(dt.timezone.utc)
        db.add(job)
        db.commit()

        return result
    except InventoryParseError as exc:
        job.status = "failed"
        job.detail = str(exc)
        job.finished_at = dt.datetime.now(dt.timezone.utc)
        db.add(job)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.detail = f"Unexpected error: {exc}"
        job.finished_at = dt.datetime.now(dt.timezone.utc)
        db.add(job)
        db.commit()
        raise HTTPException(status_code=500, detail="Unexpected error while processing upload") from exc
