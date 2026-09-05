import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { confirmTransfers, getTransferCandidates } from "../api";
import InfoBlock from "./InfoBlock.jsx";

const DIRECTION_LABELS = {
  container_to_store: "Container → Store",
  store_to_container: "Store → Container",
};

// Reached only by navigating here from the inventory upload's "Review
// transfer" button, with the chosen direction passed as router state.
export default function TransferReview() {
  const location = useLocation();
  const navigate = useNavigate();
  const direction = location.state?.direction;

  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qtyById, setQtyById] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [logged, setLogged] = useState(null);

  useEffect(() => {
    if (!direction) return;
    setLoading(true);
    setError(null);
    getTransferCandidates(direction)
      .then((res) => {
        setCandidates(res);
        const initialQty = {};
        res.items.forEach((item) => {
          initialQty[item.item_id] = String(item.suggested_qty);
        });
        setQtyById(initialQty);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [direction]);

  function setQty(itemId, value) {
    setQtyById((prev) => ({ ...prev, [itemId]: value }));
  }

  function mismatch(item) {
    const raw = qtyById[item.item_id];
    if (raw === "" || raw == null) return false;
    const entered = Number(raw);
    if (Number.isNaN(entered)) return false;
    return Math.abs(entered - item.suggested_qty) > 0.01;
  }

  const includeCount = candidates
    ? candidates.items.filter((i) => Number(qtyById[i.item_id]) > 0).length
    : 0;

  async function handleConfirm() {
    if (!candidates) return;
    const items = candidates.items
      .filter((i) => Number(qtyById[i.item_id]) > 0)
      .map((i) => ({
        item_id: i.item_id,
        item_name: i.name,
        quantity: Number(qtyById[i.item_id]),
      }));
    if (items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await confirmTransfers(direction, candidates.today_date, items);
      setLogged(res.logged);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!direction) {
    return (
      <section className="card">
        <p className="muted">
          No transfer to review. During your next inventory upload on Overview, check "Container
          movement happened today", pick a direction, then come back here.
        </p>
        <button onClick={() => navigate("/")}>Go to Overview</button>
      </section>
    );
  }

  if (logged != null) {
    return (
      <section className="card">
        <InfoBlock brief="Transfer review complete.">
          {logged} transfer log entr{logged === 1 ? "y" : "ies"} logged ({DIRECTION_LABELS[direction]}).
        </InfoBlock>
        <button onClick={() => navigate("/")}>Back to Overview</button>
      </section>
    );
  }

  return (
    <section className="card">
      <InfoBlock brief={`Review items that likely moved ${DIRECTION_LABELS[direction]}, edit if needed, then confirm.`}>
        Toast's own Container-location count almost never changes on its own, so these suggestions
        come from the sellable item's count change instead, netted against today's actual sales
        (count change + sold today = suggested qty) - the same signal Delivery Review uses. This
        can't tell a transfer apart from an unlogged delivery on its own, so double-check you're not
        logging the same restock as both a delivery and a transfer. Nothing is logged until you
        confirm - edit any quantity freely, or clear it to skip that item. If what you type doesn't
        match the suggested quantity, the field turns red so it's clear you're overriding it.
      </InfoBlock>

      {loading && <p className="muted">Comparing today's upload to the previous one…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && candidates && candidates.items.length === 0 && (
        <p className="muted">
          Nothing stood out between {candidates.prev_date} and {candidates.today_date} for{" "}
          {DIRECTION_LABELS[direction]} - no item's count change (net of today's sales) was more
          than 5 units in that direction.
        </p>
      )}

      {!loading && candidates && candidates.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Each: prev → today</th>
                <th style={{ textAlign: "right" }}>Container: prev → today</th>
                <th style={{ textAlign: "right" }}>Sold today</th>
                <th style={{ textAlign: "right" }}>Qty to log</th>
              </tr>
            </thead>
            <tbody>
              {candidates.items.map((item) => (
                <tr key={item.item_id}>
                  <td>{item.name || item.item_id}</td>
                  <td style={{ textAlign: "right" }}>
                    {item.each_prev_qty ?? "-"} → {item.each_today_qty}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {item.container_prev_qty ?? "-"} → {item.container_today_qty}
                  </td>
                  <td style={{ textAlign: "right" }}>{item.sold_today > 0 ? item.sold_today : "-"}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={`po-qty-input${mismatch(item) ? " qty-mismatch" : ""}`}
                      value={qtyById[item.item_id] ?? ""}
                      onChange={(e) => setQty(item.item_id, e.target.value)}
                    />
                    {mismatch(item) && (
                      <div className="qty-mismatch-warning">Doesn't match suggested qty ({item.suggested_qty})</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="review-actions">
        <button className="link-button" onClick={() => navigate("/")} disabled={submitting}>
          Back to Overview
        </button>
        <button disabled={submitting || loading || !candidates} onClick={handleConfirm}>
          {submitting ? "Logging…" : `Confirm & log (${includeCount})`}
        </button>
      </div>
    </section>
  );
}
