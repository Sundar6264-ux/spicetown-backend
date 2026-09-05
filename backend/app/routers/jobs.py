import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.features import require_feature
from app.db import get_db
from app.schemas import JobStatusOut
from app.services.open_orders import JOB_NAME as OPEN_ORDERS_JOB
from app.services.sales_sync import JOB_NAME as SALES_SYNC_JOB, latest_job_run, sync_sales_for_date

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(require_feature("overview"))])

TRACKED_JOBS = [SALES_SYNC_JOB, "inventory_upload", OPEN_ORDERS_JOB]


@router.get("/status", response_model=list[JobStatusOut])
def get_job_status(db: Session = Depends(get_db)):
    results = []
    for job_name in TRACKED_JOBS:
        job = latest_job_run(db, job_name)
        if job:
            results.append(job)
    return results


@router.post("/sales-sync/run", response_model=JobStatusOut)
def run_sales_sync_now(business_date: Optional[dt.date] = None, db: Session = Depends(get_db)):
    """Manually trigger the sales sync (e.g. for backfilling a missed day or testing)."""
    target_date = business_date or (dt.date.today() - dt.timedelta(days=1))
    return sync_sales_for_date(db, target_date)
