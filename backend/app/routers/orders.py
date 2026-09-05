import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.features import require_feature
from app.services.open_orders import (
    get_cached_open_orders,
    get_employees,
    get_open_orders,
    refresh_open_orders_cache,
)
from app.timeutil import restaurant_today

router = APIRouter(prefix="/api/orders", tags=["orders"], dependencies=[Depends(require_feature("open_orders"))])


@router.get("/open")
def open_orders(
    date: Optional[dt.date] = Query(default=None),
    employee_guid: Optional[str] = Query(default=None),
):
    """Live, single-date view (one Toast API call) - fast, normally used for
    "today". For every open order regardless of date, see /open/all-time.
    """
    target_date = date or restaurant_today()
    orders = get_open_orders(target_date, employee_guid=employee_guid or None)
    return {"mode": "day", "date": target_date.isoformat(), "count": len(orders), "orders": orders}


@router.get("/open/all-time")
def open_orders_all_time(
    employee_guid: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Instant read of the background-refreshed cache (see scheduler.py -
    refreshed today-only every 15 min, full history once daily). Does NOT
    hit Toast live - use POST /open/all-time/rescan to force a fresh full
    scan on demand instead.
    """
    result = get_cached_open_orders(db, employee_guid=employee_guid or None)
    return {
        "mode": "all_time",
        "scanned_from": result["scanned_from"],
        "scanned_to": result["scanned_to"],
        "last_refreshed_at": result["last_refreshed_at"],
        "last_job_status": result["last_job_status"],
        "count": len(result["orders"]),
        "orders": result["orders"],
    }


@router.post("/open/all-time/rescan")
def open_orders_rescan(db: Session = Depends(get_db)):
    """Forces a full re-scan right now (slow - minutes, one Toast call per
    historical business date) instead of waiting for the next scheduled
    background refresh. Manual escape hatch, not the normal path.
    """
    job = refresh_open_orders_cache(db, full=True)
    return {"status": job.status, "detail": job.detail}


@router.get("/employees")
def employees():
    return {"employees": get_employees()}
