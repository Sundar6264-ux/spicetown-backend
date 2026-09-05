import { useState } from "react";
import { getReorderCandidates } from "../api";
import InfoBlock from "./InfoBlock.jsx";
import SortableTh from "./SortableTh.jsx";
import { useTableControls } from "../useTableControls.js";

const SEARCH_KEYS = ["name", "category", "supplier"];

export default function ReorderCandidates() {
  const [lookbackDays, setLookbackDays] = useState(30);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { search, setSearch, sortKey, sortDir, toggleSort, rows } = useTableControls(
    data?.candidates,
    { searchKeys: SEARCH_KEYS, defaultSortKey: "shortfall", defaultSortDir: "desc" }
  );

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const result = await getReorderCandidates(lookbackDays, leadTimeDays);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function th(label, key, align) {
    return (
      <SortableTh sortKey={key} currentSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align={align}>
        {label}
      </SortableTh>
    );
  }

  return (
    <section className="card">
      <InfoBlock brief="Items projected to run short within your vendor lead time.">
        Forecasted demand (average daily sales over the lookback window) projected across the
        vendor lead time, compared against the latest inventory snapshot's on-hand count. Vendor
        lead time is a manual estimate below - Toast's Purchasing API isn't wired up yet, so this
        isn't pulled per-vendor automatically. Nothing here is sent anywhere; it's a read-only list
        for you to review.
      </InfoBlock>
      <div className="date-range">
        <label>
          Lookback (days)
          <input
            type="number"
            min="1"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
          />
        </label>
        <label>
          Vendor lead time (days)
          <input
            type="number"
            min="1"
            max="180"
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(Number(e.target.value))}
          />
        </label>
      </div>
      <button disabled={loading} onClick={handleRun}>
        {loading ? "Calculating…" : "Calculate"}
      </button>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {data.candidates.length} item(s) projected to run short within {data.lead_time_days}{" "}
            day(s), based on the last {data.lookback_days} day(s) of sales (as of {data.as_of}).
          </p>
          <input
            type="text"
            className="table-search"
            placeholder="Search item, category, or supplier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {th("Item", "name")}
                  {th("Category", "category")}
                  {th("Supplier", "supplier")}
                  {th("Avg/day", "avg_daily_demand", "right")}
                  {th("Forecast (lead time)", "forecast_over_lead_time", "right")}
                  {th("On hand", "on_hand_qty", "right")}
                  {th("Shortfall", "shortfall", "right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.item_id}>
                    <td>{c.name || c.item_id}</td>
                    <td>{c.category || "-"}</td>
                    <td>{c.supplier || "-"}</td>
                    <td>{c.avg_daily_demand}</td>
                    <td>{c.forecast_over_lead_time}</td>
                    <td className={c.on_hand_qty < 0 ? "flag" : ""}>{c.on_hand_qty}</td>
                    <td>{c.shortfall}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No items match "{search}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
