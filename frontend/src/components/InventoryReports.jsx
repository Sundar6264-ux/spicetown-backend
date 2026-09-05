import { useEffect, useState } from "react";
import {
  getMissingBarcodes,
  getInvalidBarcodes,
  downloadMissingBarcodes,
  downloadInvalidBarcodes,
  getPriceChanges,
  downloadPriceChanges,
  searchPriceHistory,
  getDeadStock,
  downloadDeadStock,
  getMarginReport,
  downloadMarginReport,
  getVendorPriceComparison,
  downloadVendorPriceComparison,
} from "../api";
import InfoBlock from "./InfoBlock.jsx";
import SortableTh from "./SortableTh.jsx";
import { useTableControls } from "../useTableControls.js";

const money = (v) => (v != null ? `$${v.toFixed(2)}` : "-");
const percent = (v) => (v != null ? `${v.toFixed(1)}%` : "-");
const wholeNumber = (v) => (v != null ? Math.round(v).toLocaleString() : "-");

// Matches inventory_intelligence.py's SLOW_MOVING_DAYS_THRESHOLD - keep in sync if that changes.
const SLOW_MOVING_LABEL = "90+ days";

const REPORTS = {
  missing: {
    label: "Missing barcodes",
    description: "Items in the latest inventory snapshot with no barcode on file at all.",
    loadFn: getMissingBarcodes,
    downloadFn: downloadMissingBarcodes,
    searchKeys: ["name", "category", "supplier"],
    defaultSortKey: "name",
    columns: [
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "supplier", label: "Supplier" },
    ],
  },
  invalid: {
    label: "Invalid barcodes",
    description: "Items with a barcode on file that fails validation.",
    loadFn: getInvalidBarcodes,
    downloadFn: downloadInvalidBarcodes,
    searchKeys: ["name", "barcode", "reason", "supplier"],
    defaultSortKey: "name",
    columns: [
      { key: "name", label: "Item" },
      { key: "barcode", label: "Barcode" },
      { key: "reason", label: "Reason" },
      { key: "supplier", label: "Supplier" },
    ],
  },
  price_changes: {
    label: "Price change log",
    description: "Items whose price actually changed between two inventory uploads.",
    loadFn: getPriceChanges,
    downloadFn: downloadPriceChanges,
    searchKeys: ["name", "category"],
    defaultSortKey: "last_change_date",
    defaultSortDir: "desc",
    columns: [
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "previous_price", label: "Previous price", format: money, align: "right" },
      { key: "current_price", label: "Current price", format: money, align: "right" },
      { key: "last_change_date", label: "Last changed" },
      { key: "change_count", label: "# changes", align: "right" },
    ],
  },
  dead_stock: {
    label: "Dead stock / slow-moving",
    description:
      "Items with stock on hand that either haven't sold at all in 90 days (Dead) or would take " +
      `${SLOW_MOVING_LABEL} to sell through at the current pace (Slow), sorted by dollars tied up.`,
    loadFn: getDeadStock,
    downloadFn: downloadDeadStock,
    searchKeys: ["name", "category", "supplier", "status"],
    defaultSortKey: "inventory_value",
    defaultSortDir: "desc",
    columns: [
      { key: "name", label: "Item" },
      { key: "status", label: "Status" },
      { key: "category", label: "Category" },
      { key: "supplier", label: "Supplier" },
      { key: "on_hand_qty", label: "On Hand", align: "right" },
      { key: "days_on_hand", label: "Days On Hand", format: wholeNumber, align: "right" },
      { key: "last_90_day_sales", label: "90d Sales", format: money, align: "right" },
      { key: "inventory_value", label: "Value Tied Up", format: money, align: "right" },
    ],
  },
  margin: {
    label: "Margin report",
    description:
      "Items that sell regularly (90-day sales > 0) with the worst gross margin, using Toast's own " +
      "margin figures - worst first.",
    loadFn: getMarginReport,
    downloadFn: downloadMarginReport,
    searchKeys: ["name", "category", "supplier"],
    defaultSortKey: "gross_margin",
    columns: [
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "supplier", label: "Supplier" },
      { key: "price", label: "Price", format: money, align: "right" },
      { key: "cost", label: "Cost", format: money, align: "right" },
      { key: "gross_margin", label: "Gross Margin", format: percent, align: "right" },
      { key: "gross_profit", label: "Gross Profit/unit", format: money, align: "right" },
      { key: "last_90_day_sales", label: "90d Sales", format: money, align: "right" },
    ],
  },
  vendor_price: {
    label: "Vendor price comparison",
    description:
      "Items you've bought from more than one vendor (via Delivery Review or a manually logged " +
      "purchase with a cost entered), where the vendor you bought from most recently costs more " +
      "than another vendor already on file for that same item - worst savings first.",
    loadFn: getVendorPriceComparison,
    downloadFn: downloadVendorPriceComparison,
    emptyIsGood: false,
    emptyMessage:
      "Nothing to compare yet - this builds up as you confirm deliveries (Delivery Review) or log " +
      "purchases with a cost for the same item from more than one vendor.",
    searchKeys: ["name", "category", "current_vendor", "cheaper_vendor"],
    defaultSortKey: "potential_savings",
    defaultSortDir: "desc",
    columns: [
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "current_vendor", label: "Current Vendor" },
      { key: "current_cost", label: "Current Cost", format: money, align: "right" },
      { key: "current_date", label: "As Of" },
      { key: "cheaper_vendor", label: "Cheaper Vendor" },
      { key: "cheaper_cost", label: "Cheaper Cost", format: money, align: "right" },
      { key: "cheaper_date", label: "As Of" },
      { key: "potential_savings", label: "Savings/unit", format: money, align: "right" },
    ],
  },
};

function ReportTable({ report }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    report
      .loadFn()
      .then(setData)
      .catch((err) => setError(err.message));
  }, [report]);

  const { search, setSearch, sortKey, sortDir, toggleSort, rows } = useTableControls(data?.items, {
    searchKeys: report.searchKeys,
    defaultSortKey: report.defaultSortKey,
    defaultSortDir: report.defaultSortDir || "asc",
  });

  async function handleDownload() {
    setDownloading(true);
    try {
      await report.downloadFn();
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <div className="card-header">
        <h3 style={{ margin: 0 }}>
          {report.label}
          {data && <span className="muted"> ({data.count})</span>}
        </h3>
        <button disabled={downloading || !data?.count} onClick={handleDownload}>
          {downloading ? "Downloading…" : "Download CSV"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        {report.description}
      </p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && (
        <p className={report.emptyIsGood === false ? "muted" : "success"}>
          {report.emptyMessage || "None found - clean."}
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <input
            type="text"
            className="table-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <SortableTh
                      key={c.key}
                      sortKey={c.key}
                      currentSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={toggleSort}
                      align={c.align}
                    >
                      {c.label}
                    </SortableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.item_id}>
                    {report.columns.map((c) => (
                      <td key={c.key}>{c.format ? c.format(item[c.key]) : item[c.key] || "-"}</td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={report.columns.length} className="muted">
                      No items match "{search}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PriceHistorySearch() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await searchPriceHistory(query.trim());
      setSearchResults(result.items);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
      <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Look up one item's full price history</h3>
      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        Type an item name or barcode to see every price it's had on file, not just recent changes.
      </p>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.75rem" }}>
        <input
          type="text"
          placeholder="Item name or barcode…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, maxWidth: "320px" }}
        />
        <button type="submit" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {searchError && <p className="error">{searchError}</p>}

      {searchResults && searchResults.length === 0 && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          No items matched "{query}".
        </p>
      )}

      {searchResults && searchResults.length > 0 && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {searchResults.map((item) => (
            <div key={item.item_id}>
              <strong>{item.name}</strong>{" "}
              <span className="muted">
                {item.barcode && `· ${item.barcode}`} {item.category && `· ${item.category}`}
              </span>
              <div className="table-wrap" style={{ marginTop: "0.4rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Price</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...item.history].reverse().map((h) => (
                      <tr key={h.date}>
                        <td>{h.date}</td>
                        <td>{money(h.price)}</td>
                        <td>{money(h.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InventoryReports() {
  const [selected, setSelected] = useState(null);

  return (
    <section className="card">
      <InfoBlock brief="Six reports checked against the latest inventory upload: barcodes, price changes, dead stock, margin, and vendor price comparison.">
        Checked against the latest inventory snapshot. For barcodes, "invalid" means structurally
        malformed (wrong length, or fails the UPC-A/EAN-8/EAN-13/GTIN-14 check-digit formula) -
        this can't confirm a code is actually registered to that product, only that it's
        well-formed. An item listing several barcodes (different pack sizes) only shows up here if
        at least one of them is malformed. The price change log compares consecutive inventory
        uploads per item - only as complete as your upload history, and it also lets you look up
        one item's full price/cost timeline. Dead stock / slow-moving and the margin report both
        use fields Toast already computes for you (days on hand, gross margin) - no new
        calculations, just surfaced and sorted. Vendor price comparison is different from the
        rest - it isn't built from the inventory file's own `cost` field (that's one blended number
        per item, and an item can list several possible suppliers with no way to tell which one it
        belongs to); it's built from real vendor-attributed costs captured through Delivery Review
        or a manually logged purchase, so it only has something to show once that data exists.
      </InfoBlock>

      {!selected && (
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
          {Object.entries(REPORTS).map(([key, report]) => (
            <button key={key} onClick={() => setSelected(key)}>
              View {report.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <button className="link-button" onClick={() => setSelected(null)}>
            ← Choose a different report
          </button>
          {selected === "price_changes" && <PriceHistorySearch />}
          <ReportTable report={REPORTS[selected]} />
        </>
      )}
    </section>
  );
}
