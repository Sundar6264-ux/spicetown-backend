import { useEffect, useState, useCallback } from "react";
import { getOpenOrders, getAllTimeOpenOrders, rescanAllTimeOpenOrders, getOrderEmployees } from "../api";
import InfoBlock from "./InfoBlock.jsx";
import SortableTh from "./SortableTh.jsx";
import { useTableControls } from "../useTableControls.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatElapsed(minutes) {
  if (minutes == null) return "-";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h ${minutes % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatWhen(iso, allTime) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", {
    month: allTime ? "short" : undefined,
    day: allTime ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

// A "paid" order still being open is expected for an online/pickup order
// (Toast charges on placement, closes on fulfillment) rather than a stuck
// dine-in tab - and a guest can pay tonight for a pickup scheduled tomorrow
// (see the project skill's "future order" gotcha), which isn't a problem at
// all. Split those out from the rest so the main list isn't cluttered with
// orders that aren't actually anything to worry about right now.
function isScheduledForLater(o) {
  return Boolean(o.paid_at && o.promised_at && new Date(o.promised_at) > new Date());
}

function OrdersTable({ list, allTime, search, columns, th }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {allTime && th("Business date", "business_date")}
            {th("Order #", "display_number")}
            {th("Opened", "opened_at")}
            {th(columns.durationLabel, columns.durationKey, "right")}
            {th("Opened by", "server_name")}
            {th("Guests", "num_guests", "right")}
            {th("Total", "total_amount", "right")}
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.guid}>
              {allTime && <td>{o.business_date}</td>}
              <td>{o.display_number || o.guid.slice(0, 8)}</td>
              <td>{formatWhen(o.opened_at, allTime)}</td>
              <td>{columns.durationKey === "promised_at" ? formatWhen(o.promised_at, allTime) : formatElapsed(o.elapsed_minutes)}</td>
              <td>{o.server_name}</td>
              <td>{o.num_guests ?? "-"}</td>
              <td>${o.total_amount.toFixed(2)}</td>
              <td style={{ minWidth: "16rem" }}>
                {!o.line_items || o.line_items.length === 0
                  ? "-"
                  : o.line_items.map((item, idx) => (
                      <div key={idx}>
                        {item.quantity}x {item.name}
                        {idx < o.line_items.length - 1 ? "," : ""}
                      </div>
                    ))}
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={allTime ? 8 : 7} className="muted">
                No orders match "{search}".
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function OpenOrders() {
  const [allTime, setAllTime] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [employeeGuid, setEmployeeGuid] = useState("");
  const [employees, setEmployees] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rescanning, setRescanning] = useState(false);

  const { search, setSearch, sortKey, sortDir, toggleSort, rows } = useTableControls(data?.orders, {
    searchKeys: ["display_number", "server_name"],
    defaultSortKey: "opened_at",
    defaultSortDir: "asc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = allTime ? await getAllTimeOpenOrders(employeeGuid || undefined) : await getOpenOrders(date, employeeGuid || undefined);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [allTime, date, employeeGuid]);

  useEffect(() => {
    getOrderEmployees()
      .then((r) => setEmployees(r.employees))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRescan() {
    setRescanning(true);
    setError(null);
    try {
      await rescanAllTimeOpenOrders();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRescanning(false);
    }
  }

  function th(label, key, align) {
    return (
      <SortableTh sortKey={key} currentSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align={align}>
        {label}
      </SortableTh>
    );
  }

  const scheduledForLater = rows.filter(isScheduledForLater);
  const needsAttention = rows.filter((o) => !isScheduledForLater(o));

  return (
    <section className="card">
      <div className="card-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
          <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
          All-time
        </label>
        {!allTime && (
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", gap: "0.3rem" }}>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", gap: "0.3rem" }}>
          Opened by
          <select value={employeeGuid} onChange={(e) => setEmployeeGuid(e.target.value)}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.guid} value={e.guid}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <button className="link-button" onClick={load}>
          Refresh
        </button>
        {allTime && (
          <button className="link-button" onClick={handleRescan} disabled={rescanning}>
            {rescanning ? "Rescanning… (can take a minute or more)" : "Rescan now (slow)"}
          </button>
        )}
      </div>

      <InfoBlock brief="Orders Toast has recorded that haven't been closed on the POS yet.">
        <p style={{ marginTop: 0 }}>
          With <strong>All-time off</strong>, this is a live pull straight from Toast for one date
          (normally today) - fast, one request. Picking a past date will normally show zero results,
          since by then that day's orders have already been closed.
        </p>
        <p>
          <strong>All-time</strong> shows every open order regardless of date, straight from a
          background cache kept fresh automatically - today's orders refresh every 15 minutes, and
          the full history (catching an order stuck open for days or weeks) is re-swept once a day.
          It's instant to load. <strong>Rescan now</strong> forces a real, immediate full re-scan
          instead of waiting for the next automatic one.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Scheduled for later</strong> is its own section below: an order that's fully paid
          AND promised for a time that hasn't arrived yet (a guest can pay tonight for a pickup
          scheduled tomorrow) isn't a problem - it's just not due. Everything else, including a paid
          order that's already past its promised time, stays in the main list since that one
          actually needs a look.
        </p>
      </InfoBlock>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data && !loading && (
        <>
          <div className="grid" style={{ marginTop: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <div className="muted">Open orders</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{data.count}</div>
            </div>
            {data.mode === "all_time" && (
              <div>
                <div className="muted">Cache last refreshed</div>
                <div style={{ fontSize: "0.95rem" }}>
                  {data.last_refreshed_at
                    ? new Date(data.last_refreshed_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "never yet - waiting on the first background scan"}
                </div>
              </div>
            )}
            {data.mode === "all_time" && data.scanned_from && (
              <div>
                <div className="muted">Covers</div>
                <div style={{ fontSize: "0.95rem" }}>
                  {data.scanned_from} to {data.scanned_to}
                </div>
              </div>
            )}
          </div>

          {data.orders.length === 0 && <p className="muted">No open orders found.</p>}
          {data.orders.length > 0 && (
            <>
              <input
                type="text"
                className="table-search"
                placeholder="Search order # or employee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <h3 style={{ fontSize: "0.95rem", marginBottom: "0.4rem" }}>
                Needs a look ({needsAttention.length})
              </h3>
              <OrdersTable
                list={needsAttention}
                allTime={allTime}
                search={search}
                th={th}
                columns={{ durationLabel: "Open for", durationKey: "elapsed_minutes" }}
              />

              {scheduledForLater.length > 0 && (
                <>
                  <h3 style={{ fontSize: "0.95rem", margin: "1.25rem 0 0.4rem" }}>
                    Scheduled for later - paid, not yet due ({scheduledForLater.length})
                  </h3>
                  <OrdersTable
                    list={scheduledForLater}
                    allTime={allTime}
                    search={search}
                    th={th}
                    columns={{ durationLabel: "Due at", durationKey: "promised_at" }}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
