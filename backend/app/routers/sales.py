import datetime as dt
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.features import require_feature
from app.services.export import export_csv, export_pdf
from app.services.items_sold import get_items_sold
from app.timeutil import restaurant_today

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(get_current_user)])


@router.get("/items-sold", dependencies=[Depends(require_feature("items_sold"))])
def items_sold(date: Optional[dt.date] = None, db: Session = Depends(get_db)):
    target_date = date or restaurant_today()
    return get_items_sold(db, target_date)


# SalesDownload lives on the Overview page, so this is gated as "overview",
# not a standalone feature of its own.
@router.get("/export", dependencies=[Depends(require_feature("overview"))])
def export_sales(
    start: dt.date = Query(..., description="Start of date range, inclusive"),
    end: dt.date = Query(..., description="End of date range, inclusive"),
    format: Literal["csv", "pdf"] = Query("csv"),
    db: Session = Depends(get_db),
):
    if end < start:
        raise HTTPException(status_code=400, detail="`end` must be on or after `start`")

    filename = f"spicetown-sales-{start.isoformat()}_to_{end.isoformat()}.{format}"

    if format == "csv":
        content = export_csv(db, start, end)
        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    content = export_pdf(db, start, end)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
