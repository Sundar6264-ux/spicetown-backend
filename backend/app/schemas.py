import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class JobStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_name: str
    started_at: dt.datetime
    finished_at: Optional[dt.datetime]
    status: str
    detail: Optional[str]
    business_date: Optional[dt.date]


class InventoryUploadResult(BaseModel):
    snapshot_date: str
    rows_loaded: int
    rows_skipped: int
    columns_used: list[str]
    columns_ignored: list[str]


class SimplePOExportItem(BaseModel):
    name: str
    supplier_item_id: Optional[str] = None
    qty: float


class SimplePOExportRequest(BaseModel):
    supplier: str
    items: list[SimplePOExportItem]


class CartItemIn(BaseModel):
    item_id: Optional[str] = None
    name: str
    supplier_item_id: Optional[str] = None
    qty: float
    case_of: float = 1.0


class CartAddRequest(BaseModel):
    supplier: str
    items: list[CartItemIn]


class CartItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier: str
    item_id: Optional[str]
    name: str
    supplier_item_id: Optional[str]
    qty: float
    case_of: float
    added_at: dt.datetime
    # Not stored on CartItem itself - filled in by the /cart routes from the
    # latest inventory snapshot at read time, so it always reflects Toast's
    # current cost rather than a stale value from when the item was added.
    # None for a hand-added item with no Toast item_id to look cost up from.
    unit_cost: Optional[float] = None
    total_units: float
    line_cost: Optional[float] = None


class CartItemUpdate(BaseModel):
    qty: Optional[float] = None
    case_of: Optional[float] = None


class PurchaseLogCreate(BaseModel):
    item_id: str
    item_name: Optional[str] = None
    supplier: Optional[str] = None
    quantity_received: float
    unit_cost: Optional[float] = None
    received_date: dt.date
    notes: Optional[str] = None


class PurchaseLogImportResult(BaseModel):
    rows_loaded: int
    rows_skipped: int
    errors: list[str]
    total_errors: int


class DeliveryConfirmItem(BaseModel):
    item_id: str
    item_name: Optional[str] = None
    quantity_received: float


class DeliveryConfirmRequest(BaseModel):
    vendor: str
    received_date: dt.date
    items: list[DeliveryConfirmItem]


class TransferConfirmItem(BaseModel):
    item_id: str
    item_name: Optional[str] = None
    quantity: float


class TransferConfirmRequest(BaseModel):
    direction: Literal["container_to_store", "store_to_container"]
    transfer_date: dt.date
    items: list[TransferConfirmItem]


class AskTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[AskTurn] = []


class PurchaseLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: str
    item_name: Optional[str]
    supplier: Optional[str]
    quantity_received: float
    unit_cost: Optional[float]
    received_date: dt.date
    notes: Optional[str]
    created_at: dt.datetime
