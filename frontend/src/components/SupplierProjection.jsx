import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSuppliers, getSupplierProjection, getItemWeeklySales, addToCart, getCart } from "../api";
import InfoBlock from "./InfoBlock.jsx";
import SortableTh from "./SortableTh.jsx";
import { useTableControls } from "../useTableControls.js";

const DURATIONS = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "21", label: "3 weeks" },
  { value: "30", label: "1 month" },
  { value: "60", label: "2 months" },
  { value: "90", label: "3 months" },
];

const LOOKBACK_PRESETS = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "1 month" },
  { value: "90", label: "3 months" },
];

// Both dropdowns share the same shape: fixed presets plus a "Custom" option
// that reveals a native date input (calendar view) instead of a preset.
const LOOKBACK_OPTIONS = [...LOOKBACK_PRESETS, { value: "custom", label: "Custom range…" }];
const PROJECTION_OPTIONS = [...DURATIONS, { value: "custom", label: "Custom…" }];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysFromNowStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function durationLabel(value) {
  return DURATIONS.find((d) => d.value === String(value))?.label || `${value} days`;
}

export default function SupplierProjection() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [supplier, setSupplier] = useState("");

  // Default to a 3-month lookback - the store's real ordering rhythm makes a
  // wider sales history a more useful default starting point than 1 month.
  const [lookbackPreset, setLookbackPreset] = useState("90");
  const [startDate, setStartDate] = useState(daysAgoStr(90));
  const [endDate, setEndDate] = useState(todayStr());

  const [durationPreset, setDurationPreset] = useState("30");
  const [customProjectionDate, setCustomProjectionDate] = useState(daysFromNowStr(30));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(() => new Set());
  // item_ids already sitting in this supplier's cart section - pre-ticked on
  // a fresh projection so it's obvious at a glance what's already queued up,
  // and excluded from what actually gets (re-)submitted on "Add to cart" so
  // re-running a projection can't silently stomp a qty someone already
  // edited on the Purchase Order Cart page.
  const [cartItemIds, setCartItemIds] = useState(() => new Set());
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [weeklyCache, setWeeklyCache] = useState({});
  const [weeklyLoading, setWeeklyLoading] = useState(null);

  useEffect(() => {
    getSuppliers()
      .then((res) => setSuppliers(res.suppliers))
      .catch((err) => setError(err.message));
  }, []);

  const refreshCartMembership = useCallback(async (supplierName) => {
    if (!supplierName) return new Set();
    try {
      const cart = await getCart();
      const supplierRow = cart.suppliers.find((s) => s.supplier === supplierName);
      const ids = new Set((supplierRow?.items || []).map((i) => i.item_id).filter(Boolean));
      setCartItemIds(ids);
      return ids;
    } catch {
      return new Set();
    }
  }, []);

  // Someone can add/remove cart items elsewhere (the cart page, another
  // projection run) - keep the "already in cart" ticks honest if that
  // happens while this view is open.
  useEffect(() => {
    function handleCartUpdated() {
      if (supplier) refreshCartMembership(supplier);
    }
    window.addEventListener("cart:updated", handleCartUpdated);
    return () => window.removeEventListener("cart:updated", handleCartUpdated);
  }, [supplier, refreshCartMembership]);

  function handleLookbackPresetChange(value) {
    setLookbackPreset(value);
    if (value !== "custom") {
      setStartDate(daysAgoStr(Number(value)));
      setEndDate(todayStr());
    }
  }

  // The projection duration is a single day count, but "Custom" lets the
  // user pick a target end date from a calendar instead of a fixed preset -
  // this converts that date back into a day count.
  const effectiveDuration = useMemo(() => {
    if (durationPreset !== "custom") return Number(durationPreset);
    if (!customProjectionDate) return null;
    const diffDays = Math.round((new Date(customProjectionDate) - new Date(todayStr())) / 86400000);
    return diffDays > 0 ? diffDays : null;
  }, [durationPreset, customProjectionDate]);

  const canRun =
    !!supplier &&
    !!effectiveDuration &&
    (lookbackPreset !== "custom" || (!!startDate && !!endDate));

  async function handleRun() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setExpandedItemId(null);
    setWeeklyCache({});
    try {
      const [result, cartIds] = await Promise.all([
        getSupplierProjection(supplier, startDate, endDate, effectiveDuration),
        refreshCartMembership(supplier),
      ]);
      setData(result);
      // Pre-tick whatever's already in this supplier's cart, so it's obvious
      // at a glance which items are already queued up.
      setSelected(new Set(cartIds));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // The projection duration picked at generate-time is what's actually in
  // `data` (the request), not necessarily the current dropdown/custom-date
  // state if the user changed it without re-running - use the response's
  // own horizon so the table/PDF never say one thing while showing another.
  const activeHorizon = data?.horizons_days?.[0];

  const itemsById = useMemo(() => {
    const map = {};
    (data?.items || []).forEach((item) => {
      map[item.item_id] = item;
    });
    return map;
  }, [data]);

  const flatItems = useMemo(() => {
    if (!activeHorizon) return [];
    return (data?.items || []).map((item) => {
      const p = item.projections[activeHorizon];
      return {
        item_id: item.item_id,
        name: item.name,
        category: item.category,
        avg_daily_demand: item.avg_daily_demand,
        avg_weekly_demand: item.avg_weekly_demand,
        on_hand_qty: item.on_hand_qty,
        need: p.need_to_order ?? p.projected_demand ?? null,
      };
    });
  }, [data, activeHorizon]);

  // Default sort: most-needed items on top, so the items most worth ordering
  // don't require an extra click to surface out of whatever order the API
  // happened to return.
  const { search, setSearch, sortKey, sortDir, toggleSort, rows: sortedFlatRows } = useTableControls(
    flatItems,
    { searchKeys: ["name", "category"], defaultSortKey: "need", defaultSortDir: "desc" }
  );
  const rows = sortedFlatRows.map((flat) => itemsById[flat.item_id]);

  function th(label, key, align) {
    return (
      <SortableTh sortKey={key} currentSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align={align}>
        {label}
      </SortableTh>
    );
  }

  function toggleSelected(itemId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (rows.length === 0) return;
    const visibleIds = rows.map((i) => i.item_id);
    const allVisibleSelected = visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function toggleExpand(itemId) {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(itemId);
    if (weeklyCache[itemId]) return;
    setWeeklyLoading(itemId);
    try {
      const result = await getItemWeeklySales(itemId, startDate, endDate);
      setWeeklyCache((prev) => ({ ...prev, [itemId]: result.weeks }));
    } catch (err) {
      setWeeklyCache((prev) => ({ ...prev, [itemId]: { error: err.message } }));
    } finally {
      setWeeklyLoading(null);
    }
  }

  const [addingToCart, setAddingToCart] = useState(false);
  const [cartMessage, setCartMessage] = useState(null);

  async function handleAddSelectedToCart() {
    if (!data || !activeHorizon || selected.size === 0) return;
    // Items already in the cart are pre-ticked purely as an indicator - skip
    // them here rather than re-submitting, since that would reset back to
    // qty 1 anything someone already adjusted on the Purchase Order Cart
    // page. Only genuinely new ticks actually get added.
    const newIds = [...selected].filter((id) => !cartItemIds.has(id));
    if (newIds.length === 0) {
      setCartMessage("Those item(s) are already in the cart - adjust quantities on the Purchase Order Cart page.");
      return;
    }
    const newIdSet = new Set(newIds);
    const items = data.items
      .filter((i) => newIdSet.has(i.item_id))
      .map((i) => ({
        item_id: i.item_id,
        name: i.name,
        supplier_item_id: i.supplier_item_id || null,
        // Quantity always starts at 1, not a projected "need" figure that's
        // easy to mistake for something auto-calculated - adjust it directly
        // in the cart once it's there.
        qty: 1,
      }));
    setAddingToCart(true);
    setCartMessage(null);
    try {
      await addToCart(supplier, items);
      setCartMessage(`Added ${items.length} item(s) to the cart for ${supplier}.`);
      setCartItemIds((prev) => new Set([...prev, ...newIds]));
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingToCart(false);
    }
  }

  return (
    <section className="card">
      <InfoBlock brief="Projected demand vs. on-hand for a chosen supplier and duration - pick items and add them to the purchase order cart, sorted by what's needed most.">
        For a chosen supplier and projection duration: how much of each item you're projected to
        sell, based on sales in the lookback window, and how much of that isn't covered by what's
        currently on hand ("need to order"). Rows are sorted with the most-needed items on top by
        default. Items with no known on-hand count show projected demand only (marked *), since it
        isn't netted against stock. Click an item's Avg/Day or Avg/Week figure to see the actual
        week-by-week sales it's built from. Items already sitting in this supplier's cart are
        pre-ticked and marked "in cart" so you can see what's already queued up at a glance -
        re-running the projection won't touch their quantity. Check the items you want to order
        and click "Add to cart" (new ticks always start at quantity 1); the cart is shared and
        persists across visits, so you can come back and add more (from this or another supplier)
        before adjusting quantities and downloading a PO PDF. See the Help page for the full
        walkthrough.
      </InfoBlock>
      <div className="date-range">
        <label>
          Supplier
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Select a supplier…</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lookback
          <select value={lookbackPreset} onChange={(e) => handleLookbackPresetChange(e.target.value)}>
            {LOOKBACK_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {lookbackPreset === "custom" && (
          <div className="date-range-group">
            <span className="date-range-group-label">Custom lookback range</span>
            <div className="date-range-group-inputs">
              <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
              <span className="date-range-separator">to</span>
              <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        )}
        <label>
          Projection duration
          <select value={durationPreset} onChange={(e) => setDurationPreset(e.target.value)}>
            {PROJECTION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {durationPreset === "custom" && (
          <label>
            Project through
            <input
              type="date"
              value={customProjectionDate}
              min={daysFromNowStr(1)}
              onChange={(e) => setCustomProjectionDate(e.target.value)}
            />
          </label>
        )}
      </div>
      <button disabled={!canRun || loading} onClick={handleRun}>
        {loading ? "Calculating…" : "Generate projection"}
      </button>
      {error && <p className="error">{error}</p>}

      {data && activeHorizon && (
        <>
          <div className="sp-toolbar">
            <p className="muted" style={{ margin: 0 }}>
              {rows.length} of {data.items.length} item(s) from {data.supplier}, projected over{" "}
              {durationLabel(activeHorizon)}, as of {data.as_of} (sales window {data.window_start} →{" "}
              {data.as_of}).
            </p>
            <div className="sp-toolbar-actions">
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                {selected.size} selected
              </span>
              <button disabled={selected.size === 0 || addingToCart} onClick={handleAddSelectedToCart}>
                {addingToCart ? "Adding…" : `Add to cart (${selected.size})`}
              </button>
              <button className="link-button" onClick={() => navigate("/purchase-order")}>
                View purchase order cart →
              </button>
            </div>
          </div>
          {cartMessage && <p className="muted">{cartMessage}</p>}

          <input
            type="text"
            className="table-search"
            placeholder="Search item or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((i) => selected.has(i.item_id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  {th("Item", "name")}
                  {th("Category", "category")}
                  {th("Avg/day", "avg_daily_demand", "right")}
                  {th("Avg/week", "avg_weekly_demand", "right")}
                  {th("On hand", "on_hand_qty", "right")}
                  {th(`Need (${durationLabel(activeHorizon)})`, "need", "right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <SupplierProjectionRow
                    key={item.item_id}
                    item={item}
                    activeHorizon={activeHorizon}
                    isSelected={selected.has(item.item_id)}
                    onToggleSelected={() => toggleSelected(item.item_id)}
                    inCart={cartItemIds.has(item.item_id)}
                    isExpanded={expandedItemId === item.item_id}
                    onToggleExpand={() => toggleExpand(item.item_id)}
                    weeklyData={weeklyCache[item.item_id]}
                    weeklyLoading={weeklyLoading === item.item_id}
                  />
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

function SupplierProjectionRow({
  item,
  activeHorizon,
  isSelected,
  onToggleSelected,
  inCart,
  isExpanded,
  onToggleExpand,
  weeklyData,
  weeklyLoading,
}) {
  const p = item.projections[activeHorizon];
  const known = p.need_to_order !== null;
  return (
    <>
      <tr className={isSelected ? "sp-row-selected" : ""}>
        <td>
          <input type="checkbox" checked={isSelected} onChange={onToggleSelected} />
        </td>
        <td>
          {item.name || item.item_id}
          {inCart && (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {" "}
              (in cart)
            </span>
          )}
        </td>
        <td>{item.category || "-"}</td>
        <td>
          <button className="sp-value-link" onClick={onToggleExpand} title="Show weekly sales">
            {item.avg_daily_demand}
            <span className="sp-caret">{isExpanded ? "▲" : "▼"}</span>
          </button>
        </td>
        <td>
          <button className="sp-value-link" onClick={onToggleExpand} title="Show weekly sales">
            {item.avg_weekly_demand}
            <span className="sp-caret">{isExpanded ? "▲" : "▼"}</span>
          </button>
        </td>
        <td className={item.on_hand_qty < 0 ? "flag" : ""}>
          {item.on_hand_qty ?? "-"}
          {item.container_qty != null && (
            <span className="muted sp-container-hint" title={`Includes ${item.container_qty} from a Container storage location`}>
              {" "}
              (+{item.container_qty} container)
            </span>
          )}
        </td>
        <td className={known && p.need_to_order > 0 ? "flag" : ""}>
          {known ? p.need_to_order : `${p.projected_demand}*`}
        </td>
      </tr>
      {isExpanded && (
        <tr className="sp-weekly-row">
          <td colSpan={7}>
            {weeklyLoading && <span className="muted">Loading weekly sales…</span>}
            {!weeklyLoading && weeklyData?.error && <span className="error">{weeklyData.error}</span>}
            {!weeklyLoading && Array.isArray(weeklyData) && weeklyData.length === 0 && (
              <span className="muted">No sales recorded for this item in the selected window.</span>
            )}
            {!weeklyLoading && Array.isArray(weeklyData) && weeklyData.length > 0 && (
              <table className="sp-weekly-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Qty sold</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyData.map((w) => (
                    <tr key={w.week_start}>
                      <td>
                        {w.week_start} → {w.week_end}
                      </td>
                      <td>{w.quantity}</td>
                      <td>${w.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
