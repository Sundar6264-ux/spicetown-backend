"""Parses a manually-uploaded Toast Retail "retail items" export (CSV or XLSX)
into `inventory_snapshots` rows, matching columns by header name (not position)
so the parser survives column reordering or Toast tweaking the export.

Only the subset of columns the app actually uses is kept; everything else in
the 74-column export (barcode config, tare weight, image url, prep stations,
par min/max, etc.) is ignored on purpose.
"""

import datetime as dt
import io

import pandas as pd
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import InventorySnapshot

# normalized (lowercase, single-spaced) source header -> model field name
COLUMN_MAP = {
    "item id": "item_id",
    "name": "name",
    "category group": "category_group",
    "category": "category",
    "subcategory": "subcategory",
    "inventory status": "inventory_status",
    "inventory quantity": "inventory_quantity",
    "inventory cost": "inventory_cost",
    "inventory value": "inventory_value",
    "inventory days on hand": "inventory_days_on_hand",
    "cost": "cost",
    "price": "price",
    "gross margin": "gross_margin",
    "gross profit": "gross_profit",
    "last 7 day sales": "last_7_day_sales",
    "last 30 day sales": "last_30_day_sales",
    "last 90 day sales": "last_90_day_sales",
    "last 7 day orders": "last_7_day_orders",
    "last 30 day orders": "last_30_day_orders",
    "last 90 day orders": "last_90_day_orders",
    "supplier": "supplier",
    "last received from": "last_received_from",
    "inventory last received": "inventory_last_received",
    "barcode": "barcode",
    # The exact header Toast uses for this hasn't been confirmed against a real
    # export yet - every plausible variant is mapped here so whichever one
    # actually appears gets picked up automatically. If none of these match,
    # it'll show up in `columns_ignored` (also logged to job_runs.detail) on
    # the next upload - check there for the real header text and add it above.
    "supplier item id": "supplier_item_id",
    "supplier item #": "supplier_item_id",
    "supplier sku": "supplier_item_id",
    "vendor item id": "supplier_item_id",
    "vendor item #": "supplier_item_id",
    "vendor sku": "supplier_item_id",
    "vendor item number": "supplier_item_id",
    "supplier item number": "supplier_item_id",
}

REQUIRED_SOURCE_COLUMNS = {"item id"}

NUMERIC_FIELDS = {
    "inventory_quantity",
    "inventory_cost",
    "inventory_value",
    "inventory_days_on_hand",
    "cost",
    "price",
    "gross_margin",
    "gross_profit",
    "last_7_day_sales",
    "last_30_day_sales",
    "last_90_day_sales",
    "last_7_day_orders",
    "last_30_day_orders",
    "last_90_day_orders",
}


class InventoryParseError(ValueError):
    pass


def _normalize_header(col: str) -> str:
    return " ".join(str(col).strip().lower().split())


def _load_dataframe(filename: str, content: bytes) -> pd.DataFrame:
    lower = filename.lower()
    try:
        if lower.endswith(".csv"):
            return pd.read_csv(io.BytesIO(content), dtype=str)
        if lower.endswith(".xlsx") or lower.endswith(".xls"):
            return pd.read_excel(io.BytesIO(content), dtype=str)
    except Exception as exc:  # noqa: BLE001
        raise InventoryParseError(f"Could not read {filename} as a table: {exc}") from exc
    raise InventoryParseError(
        f"Unsupported file type for {filename!r}: expected .csv, .xlsx, or .xls"
    )


def parse_and_store(
    db: Session, filename: str, content: bytes, snapshot_date: dt.date
) -> dict:
    df = _load_dataframe(filename, content)
    if df.empty:
        raise InventoryParseError("File has a header row but no data rows.")

    df.columns = [_normalize_header(c) for c in df.columns]
    found_columns = set(df.columns)

    missing_required = REQUIRED_SOURCE_COLUMNS - found_columns
    if missing_required:
        raise InventoryParseError(
            f"Missing required column(s): {sorted(missing_required)}. "
            f"Found columns: {sorted(found_columns)}"
        )

    usable_columns = {src: dest for src, dest in COLUMN_MAP.items() if src in found_columns}

    rows_loaded = 0
    skipped = 0
    for _, row in df.iterrows():
        item_id = row.get("item id")
        if pd.isna(item_id) or not str(item_id).strip():
            skipped += 1
            continue

        values: dict = {"item_id": str(item_id).strip()}
        for src_col, field in usable_columns.items():
            if field == "item_id":
                continue
            raw = row.get(src_col)
            if pd.isna(raw):
                values[field] = None
                continue
            if field in NUMERIC_FIELDS:
                cleaned = str(raw).replace("$", "").replace(",", "").replace("%", "").strip()
                try:
                    values[field] = float(cleaned) if cleaned else None
                except ValueError:
                    values[field] = None
            else:
                values[field] = str(raw).strip()

        values["snapshot_date"] = snapshot_date
        values["source_filename"] = filename

        stmt = sqlite_insert(InventorySnapshot).values(**values)
        update_cols = {k: getattr(stmt.excluded, k) for k in values if k not in ("snapshot_date", "item_id")}
        stmt = stmt.on_conflict_do_update(
            index_elements=[InventorySnapshot.snapshot_date, InventorySnapshot.item_id],
            set_=update_cols,
        )
        db.execute(stmt)
        rows_loaded += 1

    db.commit()

    ignored_columns = sorted(found_columns - set(COLUMN_MAP.keys()))
    return {
        "snapshot_date": snapshot_date.isoformat(),
        "rows_loaded": rows_loaded,
        "rows_skipped": skipped,
        "columns_used": sorted(usable_columns.keys()),
        "columns_ignored": ignored_columns,
    }
