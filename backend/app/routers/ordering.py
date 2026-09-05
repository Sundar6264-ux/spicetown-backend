import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.features import require_any_feature, require_feature
from app.models import CartItem, User
from app.schemas import CartAddRequest, CartItemOut, CartItemUpdate, SimplePOExportRequest
from app.services.forecast import forecast_daily_demand
from app.services.po_cart import add_items, clear_supplier, delete_item, list_cart, update_item
from app.services.po_export import export_simple_po_pdf
from app.services.reorder import compute_reorder_candidates, latest_inventory_by_item
from app.services.supplier_projection import compute_supplier_projection, list_suppliers
from app.services.weekly_sales import weekly_sales_for_item

router = APIRouter(prefix="/api/ordering", tags=["ordering"], dependencies=[Depends(get_current_user)])

DEFAULT_HORIZONS_DAYS = [7, 14, 21, 30]


@router.get("/forecast")
def get_forecast(
    lookback_days: int = Query(30, ge=1, le=365),
    as_of: Optional[dt.date] = None,
    db: Session = Depends(get_db),
):
    as_of_date = as_of or dt.date.today()
    demand = forecast_daily_demand(db, lookback_days, as_of_date)
    items = [
        {"item_id": item_id, **data}
        for item_id, data in demand.items()
    ]
    items.sort(key=lambda i: i["avg_daily_demand"], reverse=True)
    return {
        "lookback_days": lookback_days,
        "as_of": as_of_date.isoformat(),
        "window_start": (as_of_date - dt.timedelta(days=lookback_days)).isoformat(),
        "items": items,
    }


@router.get("/reorder-candidates", dependencies=[Depends(require_feature("reorder_candidates"))])
def get_reorder_candidates(
    lookback_days: int = Query(30, ge=1, le=365),
    lead_time_days: int = Query(7, ge=1, le=180),
    as_of: Optional[dt.date] = None,
    db: Session = Depends(get_db),
):
    as_of_date = as_of or dt.date.today()
    candidates = compute_reorder_candidates(db, lookback_days, lead_time_days, as_of_date)
    return {
        "lookback_days": lookback_days,
        "lead_time_days": lead_time_days,
        "as_of": as_of_date.isoformat(),
        "note": (
            "lead_time_days is a manual estimate, not pulled from vendors_reference - "
            "Toast's Purchasing API isn't accessible with the current credentials (403, "
            "missing scope). No PO draft yet for the same reason."
        ),
        "candidates": candidates,
    }


# Deliberately not feature-gated beyond plain login - the plain vendor-name
# list is used by both Supplier Projection and the Overview upload page's
# Delivery/Transfer Review vendor picker, and carries no report data itself.
@router.get("/suppliers")
def get_suppliers(db: Session = Depends(get_db)):
    return {"suppliers": list_suppliers(db)}


@router.get("/supplier-projection", dependencies=[Depends(require_feature("supplier_projection"))])
def get_supplier_projection(
    supplier: str = Query(..., min_length=1),
    start: Optional[dt.date] = Query(
        None, description="Start of the sales history window used to compute demand. Defaults to 30 days before `end`."
    ),
    end: Optional[dt.date] = Query(None, description="End of the sales history window (exclusive). Defaults to today."),
    lookback_days: Optional[int] = Query(
        None, ge=1, le=365, description="Deprecated - use start/end instead. Still honored if start/end aren't given."
    ),
    horizons: Optional[str] = Query(
        None, description="Comma-separated day counts, e.g. '7,14,21,30'. Defaults to 7/14/21/30."
    ),
    db: Session = Depends(get_db),
):
    as_of_date = end or dt.date.today()
    if start is not None:
        effective_lookback_days = max(1, (as_of_date - start).days)
    elif lookback_days is not None:
        effective_lookback_days = lookback_days
    else:
        effective_lookback_days = 30
    horizons_days = (
        [int(h.strip()) for h in horizons.split(",") if h.strip()]
        if horizons
        else DEFAULT_HORIZONS_DAYS
    )
    items = compute_supplier_projection(db, supplier, effective_lookback_days, horizons_days, as_of_date)
    return {
        "supplier": supplier,
        "lookback_days": effective_lookback_days,
        "window_start": (as_of_date - dt.timedelta(days=effective_lookback_days)).isoformat(),
        "horizons_days": horizons_days,
        "as_of": as_of_date.isoformat(),
        "items": items,
    }


@router.get("/item-weekly-sales", dependencies=[Depends(require_feature("supplier_projection"))])
def get_item_weekly_sales(
    item_id: str = Query(..., min_length=1),
    start: dt.date = Query(...),
    end: dt.date = Query(...),
    db: Session = Depends(get_db),
):
    return {"item_id": item_id, "weeks": weekly_sales_for_item(db, item_id, start, end)}


@router.post("/purchase-order/export-pdf", dependencies=[Depends(require_feature("purchase_order_cart"))])
def export_purchase_order_pdf(payload: SimplePOExportRequest):
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items to include in the order.")
    pdf_bytes = export_simple_po_pdf(payload.supplier, [item.model_dump() for item in payload.items])
    safe_supplier = "".join(c if c.isalnum() else "-" for c in payload.supplier.lower()).strip("-")
    filename = f"purchase-order-{safe_supplier}-{dt.date.today().isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Purchase order cart --------------------------------------------------
# A persistent, shared cart (see CartItem/po_cart.py) so a Supplier Projection
# review doesn't have to end in one immediate PDF: items can be added across
# multiple visits and multiple suppliers, then reviewed/edited/exported later
# from the Purchase Order Cart page.


def _cart_item_out(row: CartItem, unit_cost: Optional[float] = None) -> CartItemOut:
    total_units = row.qty * row.case_of
    line_cost = unit_cost * total_units if unit_cost is not None else None
    return CartItemOut(
        id=row.id,
        supplier=row.supplier,
        item_id=row.item_id,
        name=row.name,
        supplier_item_id=row.supplier_item_id,
        qty=row.qty,
        case_of=row.case_of,
        added_at=row.added_at,
        unit_cost=unit_cost,
        total_units=total_units,
        line_cost=line_cost,
    )


_cart_access = Depends(require_any_feature("supplier_projection", "purchase_order_cart"))


@router.get("/cart", dependencies=[_cart_access])
def get_cart(db: Session = Depends(get_db)):
    rows = list_cart(db)
    # Cost is looked up fresh from the latest inventory upload every time,
    # not stored on the cart row - it should always reflect Toast's current
    # cost, and a hand-added item (no item_id) simply has none to look up.
    latest_inventory = latest_inventory_by_item(db)

    by_supplier: dict[str, list] = {}
    for row in rows:
        snap = latest_inventory.get(row.item_id) if row.item_id else None
        unit_cost = snap.cost if snap is not None else None
        by_supplier.setdefault(row.supplier, []).append(_cart_item_out(row, unit_cost))

    suppliers = []
    grand_estimate_total = 0.0
    grand_has_estimate = False
    for supplier, items in sorted(by_supplier.items()):
        known_costs = [i.line_cost for i in items if i.line_cost is not None]
        estimate_total = round(sum(known_costs), 2) if known_costs else None
        if estimate_total is not None:
            grand_estimate_total += estimate_total
            grand_has_estimate = True
        suppliers.append(
            {
                "supplier": supplier,
                "items": items,
                "estimate_total": estimate_total,
                "items_missing_cost": sum(1 for i in items if i.unit_cost is None),
            }
        )

    return {
        "suppliers": suppliers,
        "total_items": len(rows),
        "grand_estimate_total": round(grand_estimate_total, 2) if grand_has_estimate else None,
    }


@router.post("/cart/items", response_model=list[CartItemOut], dependencies=[_cart_access])
def post_cart_items(
    payload: CartAddRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items to add.")
    rows = add_items(db, payload.supplier, [item.model_dump() for item in payload.items], user.id)
    return [_cart_item_out(row) for row in rows]


@router.patch("/cart/items/{cart_item_id}", response_model=CartItemOut, dependencies=[_cart_access])
def patch_cart_item(cart_item_id: int, payload: CartItemUpdate, db: Session = Depends(get_db)):
    row = update_item(db, cart_item_id, qty=payload.qty, case_of=payload.case_of)
    if row is None:
        raise HTTPException(status_code=404, detail="Cart item not found.")
    return _cart_item_out(row)


@router.delete("/cart/items/{cart_item_id}", dependencies=[_cart_access])
def delete_cart_item(cart_item_id: int, db: Session = Depends(get_db)):
    if not delete_item(db, cart_item_id):
        raise HTTPException(status_code=404, detail="Cart item not found.")
    return {"deleted": True}


@router.delete("/cart", dependencies=[_cart_access])
def delete_cart_supplier(supplier: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    count = clear_supplier(db, supplier)
    return {"deleted": count}
