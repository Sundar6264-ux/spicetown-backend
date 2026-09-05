"""Per-item weekly sales breakdown - the actual numbers behind a demand average,
for the "click the avg/day or avg/week figure to see what it's made of" view in
Supplier Projection. Computed on demand per item (not upfront for a whole
supplier's item list), since it's only needed when a user expands one row.
"""

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order


def weekly_sales_for_item(
    db: Session, item_guid: str, start_date: dt.date, end_date: dt.date
) -> list[dict]:
    """Weeks (Monday-start) between start_date and end_date (exclusive), with
    actual quantity/revenue sold in each - real top-level sales only (no
    modifier lines, matching forecast.py's definition of "sold item").
    """
    stmt = select(Order.business_date, Order.quantity, Order.net_price).where(
        Order.item_guid == item_guid,
        Order.voided.is_(False),
        Order.parent_selection_guid.is_(None),
        Order.business_date >= start_date,
        Order.business_date < end_date,
    )

    weeks: dict[dt.date, dict] = defaultdict(lambda: {"quantity": 0.0, "revenue": 0.0})
    for business_date, quantity, net_price in db.execute(stmt):
        week_start = business_date - dt.timedelta(days=business_date.weekday())
        weeks[week_start]["quantity"] += quantity
        weeks[week_start]["revenue"] += net_price

    return [
        {
            "week_start": week_start.isoformat(),
            "week_end": (week_start + dt.timedelta(days=6)).isoformat(),
            "quantity": round(v["quantity"], 2),
            "revenue": round(v["revenue"], 2),
        }
        for week_start, v in sorted(weeks.items())
    ]
