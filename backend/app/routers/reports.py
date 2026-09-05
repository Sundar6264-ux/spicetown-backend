from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.features import require_feature
from app.db import get_db
from app.services.barcode_report import get_invalid_barcodes, get_missing_barcodes
from app.services.csv_util import rows_to_csv
from app.services.inventory_intelligence import get_dead_stock, get_margin_report
from app.services.vendor_cost import get_vendor_price_comparison

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(require_feature("inventory_reports"))])


@router.get("/missing-barcodes")
def missing_barcodes(db: Session = Depends(get_db)):
    items = get_missing_barcodes(db)
    return {"count": len(items), "items": items}


@router.get("/missing-barcodes/export")
def missing_barcodes_export(db: Session = Depends(get_db)):
    items = get_missing_barcodes(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="missing-barcodes.csv"'},
    )


@router.get("/invalid-barcodes")
def invalid_barcodes(db: Session = Depends(get_db)):
    items = get_invalid_barcodes(db)
    return {"count": len(items), "items": items}


@router.get("/invalid-barcodes/export")
def invalid_barcodes_export(db: Session = Depends(get_db)):
    items = get_invalid_barcodes(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="invalid-barcodes.csv"'},
    )


@router.get("/dead-stock")
def dead_stock(db: Session = Depends(get_db)):
    items = get_dead_stock(db)
    return {"count": len(items), "items": items}


@router.get("/dead-stock/export")
def dead_stock_export(db: Session = Depends(get_db)):
    items = get_dead_stock(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="dead-stock.csv"'},
    )


@router.get("/margin")
def margin_report(db: Session = Depends(get_db)):
    items = get_margin_report(db)
    return {"count": len(items), "items": items}


@router.get("/margin/export")
def margin_report_export(db: Session = Depends(get_db)):
    items = get_margin_report(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="margin-report.csv"'},
    )


@router.get("/vendor-price-comparison")
def vendor_price_comparison(db: Session = Depends(get_db)):
    items = get_vendor_price_comparison(db)
    return {"count": len(items), "items": items}


@router.get("/vendor-price-comparison/export")
def vendor_price_comparison_export(db: Session = Depends(get_db)):
    items = get_vendor_price_comparison(db)
    return Response(
        content=rows_to_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vendor-price-comparison.csv"'},
    )
