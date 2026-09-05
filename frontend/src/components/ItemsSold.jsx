import { useEffect, useState, useCallback } from "react";
import { getItemsSold } from "../api";
import InfoBlock from "./InfoBlock.jsx";
import SortableTh from "./SortableTh.jsx";
import { useTableControls } from "../useTableControls.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ItemsSold() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { search, setSearch, sortKey, sortDir, toggleSort, rows } = useTableControls(data?.items, {
    searchKeys: ["name"],
    defaultSortKey: "revenue",
    defaultSortDir: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getItemsSold(date);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  function th(label, key, align) {
    return (
      <SortableTh sortKey={key} currentSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align={align}>
        {label}
      </SortableTh>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", gap: "0.3rem" }}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="link-button" onClick={load}>
          Refresh
        </button>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <InfoBlock brief="Revenue actually paid on this date - see exactly how it's computed below.">
            <p style={{ marginTop: 0 }}>
              <strong>This counts what was actually paid for on this date</strong> - not whichever
              date Toast internally files the order under. If a guest pays today for a pickup
              scheduled tomorrow, that sale counts as <strong>today's</strong>, since that's when
              the money actually came in, even though Toast files the whole order under tomorrow.
              An order that hasn't been paid yet doesn't count anywhere until it actually is.
            </p>
            <p>
              <strong>Revenue is the sum of each sold item's own price</strong> (after any per-item
              discount, before tax) for every item whose payment resolves to this date. This is a
              deliberate choice, not Toast's own dashboard figure - Toast's daily total instead
              groups by the day it filed the order under and uses each check's official total
              (which nets out a check-level discount that isn't reflected in the sum of individual
              item prices). The two numbers can differ by a small amount for that reason - that's
              expected, not a sync error.
            </p>
            <p style={{ marginBottom: 0 }}>
              {data.source === "live"
                ? "This date hasn't been through the nightly sync yet, so this was just pulled live from Toast."
                : "From the already-synced sales data."}
            </p>
          </InfoBlock>
          <div className="grid" style={{ marginTop: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <div className="muted">Items sold</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{data.total_quantity}</div>
            </div>
            <div>
              <div className="muted">Revenue</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>${data.total_revenue.toFixed(2)}</div>
            </div>
          </div>

          {data.items.length === 0 && <p className="muted">No sales recorded for this date.</p>}
          {data.items.length > 0 && (
            <>
              <input
                type="text"
                className="table-search"
                placeholder="Search item…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {th("Item", "name")}
                      {th("Qty sold", "quantity", "right")}
                      {th("Revenue", "revenue", "right")}
                      {th("Avg price", "avg_price", "right")}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.item_id}>
                        <td>{item.name || item.item_id}</td>
                        <td>{item.quantity}</td>
                        <td>${item.revenue.toFixed(2)}</td>
                        <td>${item.avg_price.toFixed(2)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No items match "{search}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
