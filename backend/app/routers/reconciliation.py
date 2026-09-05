import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.features import require_feature
from app.models import User
from app.schemas import (
    DeliveryConfirmRequest,
    PurchaseLogCreate,
    PurchaseLogImportResult,
    PurchaseLogOut,
)
from app.services.csv_util import rows_to_csv
from app.services.delivery_review import confirm_delivery, get_delivery_candidates
from app.services.purchase_log import create_purchase_entry, delete_purchase_entry, list_purchase_entries
from app.services.purchase_log_import import PurchaseLogImportError, import_purchase_log
from app.services.reconciliation import get_reconciliation, get_reconciliation_demo

router = APIRouter(
    prefix="/api/reconciliation", tags=["reconciliation"], dependencies=[Depends(get_current_user)]
)


@router.post("/purchases", response_model=PurchaseLogOut, dependencies=[Depends(require_feature("reconciliation"))])
def log_purchase(
    body: PurchaseLogCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return create_purchase_entry(
        db,
        item_id=body.item_id,
        item_name=body.item_name,
        supplier=body.supplier,
        quantity_received=body.quantity_received,
        unit_cost=body.unit_cost,
        received_date=body.received_date,
        notes=body.notes,
        logged_by_user_id=user.id,
    )


@router.post(
    "/purchases/upload",
    response_model=PurchaseLogImportResult,
    dependencies=[Depends(require_feature("reconciliation"))],
)
async def upload_purchase_log(
    file: UploadFile = File(...),
    default_received_date: Optional[dt.date] = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        content = await file.read()
        return import_purchase_log(
            db,
            filename=file.filename or "upload",
            content=content,
            default_received_date=default_received_date,
            logged_by_user_id=user.id,
        )
    except PurchaseLogImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/purchases", dependencies=[Depends(require_feature("reconciliation"))])
def get_purchases(
    start: Optional[dt.date] = Query(None),
    end: Optional[dt.date] = Query(None),
    db: Session = Depends(get_db),
):
    entries = list_purchase_entries(db, start, end)
    return {"count": len(entries), "items": [PurchaseLogOut.model_validate(e) for e in entries]}


@router.delete("/purchases/{entry_id}", dependencies=[Depends(require_feature("reconciliation"))])
def remove_purchase(entry_id: int, db: Session = Depends(get_db)):
    if not delete_purchase_entry(db, entry_id):
        raise HTTPException(status_code=404, detail="Purchase log entry not found")
    return {"deleted": entry_id}


@router.get("/delivery-candidates", dependencies=[Depends(require_feature("delivery_review"))])
def delivery_candidates(vendor: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    result = get_delivery_candidates(db, vendor)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Not enough inventory upload history yet to compare against (need at least two "
            "snapshot dates).",
        )
    return result


@router.post("/delivery-confirm", dependencies=[Depends(require_feature("delivery_review"))])
def delivery_confirm(
    payload: DeliveryConfirmRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logged = confirm_delivery(
        db,
        vendor=payload.vendor,
        received_date=payload.received_date,
        items=[item.model_dump() for item in payload.items],
        logged_by_user_id=user.id,
    )
    return {"logged": logged}


@router.get("/demo", dependencies=[Depends(require_feature("reconciliation"))])
def demo(db: Session = Depends(get_db)):
    result = get_reconciliation_demo(db)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Not enough inventory upload history yet to build a demo (need at least two "
            "snapshot dates).",
        )
    return result


@router.get("/report", dependencies=[Depends(require_feature("reconciliation"))])
def report(
    start: dt.date = Query(...),
    end: dt.date = Query(...),
    db: Session = Depends(get_db),
):
    items = get_reconciliation(db, start, end)
    return {"start": start.isoformat(), "end": end.isoformat(), "count": len(items), "items": items}


@router.get("/report/export", dependencies=[Depends(require_feature("reconciliation"))])
def report_export(
    start: dt.date = Query(...),
    end: dt.date = Query(...),
    db: Session = Depends(get_db),
):
    items = get_reconciliation(db, start, end)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="reconciliation-{start}-{end}.csv"'},
    )
