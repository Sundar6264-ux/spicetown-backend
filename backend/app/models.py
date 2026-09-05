import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime
from app.timeutil import utcnow


class Order(Base):
    """One row per sales line item, pulled from the Toast Orders API."""

    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("toast_selection_guid", name="uq_orders_selection_guid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Toast identifiers — selection_guid is the line item, unique per menu selection.
    toast_order_guid: Mapped[str] = mapped_column(String, index=True)
    toast_check_guid: Mapped[str] = mapped_column(String, index=True)
    toast_selection_guid: Mapped[str] = mapped_column(String, index=True)
    # Set only for modifier line items (e.g. "extra cheese") - the selection guid
    # of the item they modify. NULL for a normal top-level sold item.
    parent_selection_guid: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)

    # The Toast "business date" this order belongs to (YYYYMMDD -> date), not the
    # wall-clock date, since a late-night order can roll into the next calendar day.
    business_date: Mapped[dt.date] = mapped_column(Date, index=True)
    opened_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True)
    # When the guest actually paid (Toast's checks[].paidDate, falling back to the
    # order-level paidDate/createdDate) - NOT the same as business_date, which can
    # reflect a scheduled future pickup date instead (see skill gotcha #12). NULL
    # for rows synced before this column existed; only new/re-synced rows have it.
    paid_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True, index=True)

    item_guid: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    item_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    net_price: Mapped[float] = mapped_column(Float, default=0)
    tax_amount: Mapped[float] = mapped_column(Float, default=0)
    voided: Mapped[bool] = mapped_column(Boolean, default=False)

    dining_option: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime(), default=utcnow, onupdate=utcnow
    )


class InventorySnapshot(Base):
    """One row per item per day, loaded from the manually uploaded Toast Retail export."""

    __tablename__ = "inventory_snapshots"
    __table_args__ = (
        UniqueConstraint("snapshot_date", "item_id", name="uq_inventory_snapshot_date_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    snapshot_date: Mapped[dt.date] = mapped_column(Date, index=True)
    item_id: Mapped[str] = mapped_column(String, index=True)

    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category_group: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    subcategory: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    inventory_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    inventory_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inventory_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inventory_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inventory_days_on_hand: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    last_7_day_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_30_day_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_90_day_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_7_day_orders: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_30_day_orders: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_90_day_orders: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    supplier: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_received_from: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    inventory_last_received: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Vendor's own SKU/item number for this item - semicolon-separated in the
    # same order as `supplier` when an item has multiple vendors (mirrors that
    # field's quirk). Used on PO exports since our own item_id means nothing
    # to a vendor. See inventory_parser.py's SUPPLIER_ITEM_ID_HEADERS for the
    # source column name(s) this is matched against.
    supplier_item_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    barcode: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    source_filename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class VendorReference(Base):
    """Read-only cache of vendor cost/lead-time data from Toast's Purchasing & Receiving API.

    Scaffolded now for step 5 (ordering); not populated or read by anything in this phase.
    """

    __tablename__ = "vendors_reference"
    __table_args__ = (
        UniqueConstraint("vendor_id", "item_id", name="uq_vendor_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    vendor_id: Mapped[str] = mapped_column(String, index=True)
    vendor_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    item_id: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)

    cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lead_time_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    synced_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class User(Base):
    """A dashboard login. There is no self-service signup or password reset -
    accounts are created and passwords set only by an admin (see routers/auth.py).
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # JSON-encoded list of feature keys (see app/features.py) an admin has
    # granted this user - ignored entirely for an admin, who always has full
    # access. New users default to "[]" (no access) until an admin grants some.
    allowed_features: Mapped[str] = mapped_column(String, default="[]")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class UserSession(Base):
    """Server-side session, looked up by the opaque token in the session cookie.
    Deleting a row here immediately revokes that session (used by logout and by
    an admin resetting a user's password).
    """

    __tablename__ = "user_sessions"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(UTCDateTime())


class JobRun(Base):
    """Execution log for background/manual jobs, so the dashboard can show last run + status."""

    __tablename__ = "job_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    job_name: Mapped[str] = mapped_column(String, index=True)
    started_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True)
    status: Mapped[str] = mapped_column(String, default="running")  # running|success|failed
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    business_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)


class PurchaseLogEntry(Base):
    """A manually-logged receiving record - what you actually got from a
    vendor, entered by hand. Exists because Toast's Purchasing & Receiving
    API is confirmed inaccessible with the current OAuth credentials (see
    skill gotcha #15) - `vendors_reference` is scaffolded for real Toast
    purchase data but stays empty until that scope is granted. This table is
    the manual substitute: the "purchased" leg of purchased vs. sold vs.
    counted reconciliation (Phase 3), only as complete as what gets logged.
    """

    __tablename__ = "purchase_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    item_id: Mapped[str] = mapped_column(String, index=True)
    item_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    supplier: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    quantity_received: Mapped[float] = mapped_column(Float)
    unit_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    received_date: Mapped[dt.date] = mapped_column(Date, index=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    logged_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class LocationTransferLogEntry(Base):
    """A manually-confirmed record of stock physically moved between an item's
    two inventory_snapshots rows - the priced/sellable "Each" row and its bare
    "Container" storage-location duplicate (see supplier_projection.py's
    `_container_qty_by_name`). Exists because real upload history shows the
    Container row's on-hand count essentially never changes on its own - real
    transfers, if they happen, aren't reliably reflected as a detectable count
    delta the way a delivery is - so like purchase_log, this is a human-
    confirmed record, not something derived purely from diffing snapshots.
    """

    __tablename__ = "location_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    item_id: Mapped[str] = mapped_column(String, index=True)
    item_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # "container_to_store": moved from back storage onto the retail floor (the
    # normal restocking direction). "store_to_container": the reverse (e.g.
    # returning excess stock to storage).
    direction: Mapped[str] = mapped_column(String)
    quantity: Mapped[float] = mapped_column(Float)
    transfer_date: Mapped[dt.date] = mapped_column(Date, index=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    logged_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class CartItem(Base):
    """A persistent, shared purchase-order cart row - one item, for one
    supplier, at a quantity a staff member intends to order. Exists so a
    Supplier Projection review doesn't have to end in one immediate PDF
    download: items can be added over multiple visits/days, across several
    suppliers at once, and only turned into a PDF (via the existing
    `export_simple_po_pdf`) when someone's actually ready to send the order.

    `item_id` is null for a hand-added item that isn't in Toast's inventory
    export at all (a genuinely new item being ordered for the first time) -
    `name` is always what actually prints on the PO either way.
    """

    __tablename__ = "po_cart_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    supplier: Mapped[str] = mapped_column(String, index=True)
    item_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String)
    supplier_item_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    qty: Mapped[float] = mapped_column(Float)
    # Units per case - qty is a case count (matches the PO PDF's "Qty to
    # order (in Cases)" label), so total units ordered = qty * case_of. Only
    # used for the on-screen cost estimate (see ordering.py's cart routes);
    # never printed on the PDF itself. Defaults to 1 so a plain "1 unit per
    # case" item needs no extra input.
    case_of: Mapped[float] = mapped_column(Float, default=1.0, server_default="1")

    added_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    added_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)


class OpenOrderCache(Base):
    """Background-refreshed snapshot of currently-open Toast orders, one row
    per open order, fully replaced on every scan (see
    services/open_orders.py::refresh_open_orders_cache) - not an append-only
    log. Exists so the "all-time open orders" dashboard view reads instantly
    from this table instead of live-scanning ~100+ historical Toast business
    dates (which takes minutes) on every page load.
    """

    __tablename__ = "open_order_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    toast_order_guid: Mapped[str] = mapped_column(String, index=True)
    business_date: Mapped[dt.date] = mapped_column(Date, index=True)
    display_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    opened_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True)
    server_guid: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    server_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    num_guests: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    approval_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    total_amount: Mapped[float] = mapped_column(Float, default=0)
    num_checks: Mapped[int] = mapped_column(Integer, default=0)
    # JSON-encoded [{"name": ..., "quantity": ...}, ...] of top-level
    # (non-modifier, non-voided) line items.
    line_items_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # NULL unless every check on the order is paid (see open_orders.py::_paid_at) -
    # a paid order that's still open is normal for an online/pickup order (Toast
    # charges on placement, closes on fulfillment) rather than a stuck dine-in tab.
    paid_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True)
    # Guest-facing promised time (or Toast's own estimate) - lets a "paid,
    # still open" order be told apart from a genuine future order (paid
    # tonight for tomorrow's pickup, see skill gotcha #12) vs one that's
    # simply overdue.
    promised_at: Mapped[Optional[dt.datetime]] = mapped_column(UTCDateTime(), nullable=True)
    scanned_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)
