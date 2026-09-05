"""Daily cron job wiring, via APScheduler running in-process with the API server.

Chosen over OS-level cron/node-cron because the job needs to write into the same
SQLite DB and be inspectable from the API (job status endpoint) without shelling
out or reading log files. The tradeoff: the scheduler only runs while the FastAPI
process is up, so the process needs to be kept alive (e.g. under systemd/pm2/a
container restart policy) for the daily job to fire reliably.
"""

import datetime as dt
import logging
import zoneinfo
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import JobRun
from app.services.open_orders import refresh_open_orders_cache
from app.services.sales_sync import JOB_NAME, sync_sales_for_date

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


def _dates_without_successful_sync(db: Session, start: dt.date, end: dt.date) -> list[dt.date]:
    """Every date in [start, end] that does NOT have a successful sales-sync run yet.

    A date can have a failed run (e.g. Toast rate-limited us) and still show up
    here - "missing" means "not yet confirmed synced", not "never attempted".
    """
    stmt = select(JobRun.business_date).where(
        JobRun.job_name == JOB_NAME,
        JobRun.status == "success",
        JobRun.business_date >= start,
        JobRun.business_date <= end,
    )
    synced = {row[0] for row in db.execute(stmt)}

    missing = []
    d = start
    while d <= end:
        if d not in synced:
            missing.append(d)
        d += dt.timedelta(days=1)
    return missing


def run_daily_sales_sync() -> None:
    """Runs at the scheduled hour, AND once right after the service starts up.

    Rather than only syncing "yesterday", this scans the trailing
    `sales_sync_backfill_days` window and (re-)syncs every date in it that
    doesn't have a confirmed-successful run - so a missed night (service was
    down, Toast had an outage, etc.) gets caught up automatically on the next
    run instead of silently staying missing forever.
    """
    settings = get_settings()
    tz = zoneinfo.ZoneInfo(settings.toast_timezone)
    # "Yesterday" in the restaurant's local timezone - the most recent business
    # date that's actually closed out by the time this runs.
    through_date = (dt.datetime.now(tz) - dt.timedelta(days=1)).date()
    window_start = through_date - dt.timedelta(days=settings.sales_sync_backfill_days - 1)

    db = SessionLocal()
    try:
        missing_dates = _dates_without_successful_sync(db, window_start, through_date)
        if not missing_dates:
            logger.info("Sales sync: %s already up to date, nothing to backfill", through_date)
            return

        if len(missing_dates) > 1:
            logger.warning(
                "Sales sync: %d missing day(s) in the last %d days, backfilling: %s",
                len(missing_dates), settings.sales_sync_backfill_days, missing_dates,
            )

        for business_date in missing_dates:
            job = sync_sales_for_date(db, business_date)
            logger.info("Sales sync for %s: %s (%s)", business_date, job.status, job.detail)
    finally:
        db.close()


def run_open_orders_full_scan() -> None:
    """Re-scans every business date since real sales began for still-open
    orders (see open_orders.py::FIRST_REAL_SALES_DATE) and fully replaces
    `open_order_cache`. This is the only path that can notice an order
    stuck open on some OLD date - the frequent today-only refresh below
    never looks at a date again once it's no longer "today". Slow (minutes,
    ~100+ Toast calls), which is exactly why it only runs once a day rather
    than on every dashboard load.
    """
    db = SessionLocal()
    try:
        job = refresh_open_orders_cache(db, full=True)
        logger.info("Open orders full scan: %s (%s)", job.status, job.detail)
    finally:
        db.close()


def run_open_orders_today_refresh() -> None:
    """Cheap refresh (one Toast call) of just today's open orders - covers
    the vast majority of real changes (an order opening or closing) without
    the cost of the full historical scan above.
    """
    db = SessionLocal()
    try:
        job = refresh_open_orders_cache(db, full=False)
        logger.info("Open orders today refresh: %s (%s)", job.status, job.detail)
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    settings = get_settings()
    tz = zoneinfo.ZoneInfo(settings.toast_timezone)

    scheduler = BackgroundScheduler(timezone=tz)
    scheduler.add_job(
        run_daily_sales_sync,
        trigger=CronTrigger(hour=settings.sales_sync_hour, minute=settings.sales_sync_minute, timezone=tz),
        id="daily_sales_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Also run the same (gap-aware) sync once shortly after the service starts up -
    # a restart (crash, reboot, Mac was asleep at 4am) is exactly when a day is
    # most likely to have been missed, and otherwise it'd sit missing until the
    # next scheduled run, up to ~24h later.
    scheduler.add_job(
        run_daily_sales_sync,
        trigger=DateTrigger(run_date=dt.datetime.now(tz) + dt.timedelta(seconds=10)),
        id="startup_catchup_sync",
        replace_existing=True,
    )

    # Open orders cache: one full history sweep a day, plus a frequent
    # cheap today-only refresh (see run_open_orders_*'s own docstrings for
    # why it's split this way).
    scheduler.add_job(
        run_open_orders_full_scan,
        trigger=CronTrigger(
            hour=settings.open_orders_full_scan_hour,
            minute=settings.open_orders_full_scan_minute,
            timezone=tz,
        ),
        id="open_orders_full_scan",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        run_open_orders_today_refresh,
        trigger=IntervalTrigger(minutes=settings.open_orders_today_refresh_minutes),
        id="open_orders_today_refresh",
        replace_existing=True,
        misfire_grace_time=300,
    )
    # Populate the cache shortly after startup too, same reasoning as the
    # sales-sync catchup above - otherwise a freshly restarted service shows
    # an empty "all-time" view until the next scheduled tick (up to 24h for
    # the full scan). Runs the cheap today-only refresh immediately (fast,
    # so the dashboard has *something* right away) and the full scan a bit
    # after that (slow, shouldn't block/compete with startup).
    scheduler.add_job(
        run_open_orders_today_refresh,
        trigger=DateTrigger(run_date=dt.datetime.now(tz) + dt.timedelta(seconds=15)),
        id="startup_open_orders_today",
        replace_existing=True,
    )
    scheduler.add_job(
        run_open_orders_full_scan,
        trigger=DateTrigger(run_date=dt.datetime.now(tz) + dt.timedelta(seconds=30)),
        id="startup_open_orders_full_scan",
        replace_existing=True,
    )

    scheduler.start()
    _scheduler = scheduler
    logger.info(
        "Scheduler started: daily_sales_sync at %02d:%02d, open_orders_full_scan at %02d:%02d, "
        "open_orders_today_refresh every %dmin (%s)",
        settings.sales_sync_hour,
        settings.sales_sync_minute,
        settings.open_orders_full_scan_hour,
        settings.open_orders_full_scan_minute,
        settings.open_orders_today_refresh_minutes,
        settings.toast_timezone,
    )
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
