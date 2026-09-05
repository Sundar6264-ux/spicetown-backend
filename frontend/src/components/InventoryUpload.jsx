import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSuppliers, uploadInventoryWithProgress } from "../api";
import InfoBlock from "./InfoBlock.jsx";

function VendorPicker({ suppliers, selected, onChange }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? suppliers.filter((s) => s.toLowerCase().includes(q)) : suppliers;
  }, [suppliers, query]);

  function toggle(vendor) {
    onChange(selected.includes(vendor) ? selected.filter((v) => v !== vendor) : [...selected, vendor]);
  }

  return (
    <div className="vendor-picker">
      {selected.length > 0 && (
        <div className="vendor-picker-chips">
          {selected.map((v) => (
            <button type="button" key={v} className="vendor-chip" onClick={() => toggle(v)}>
              {v} ×
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Search vendors…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="vendor-picker-list">
        {filtered.map((s) => (
          <label key={s} className="vendor-picker-item">
            <input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
        {filtered.length === 0 && <p className="muted item-picker-status">No vendors match "{query}".</p>}
      </div>
    </div>
  );
}

export default function InventoryUpload({ onUploaded }) {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [deliveryReceived, setDeliveryReceived] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [deliveryVendors, setDeliveryVendors] = useState([]);

  const [transferHappened, setTransferHappened] = useState(false);
  const [transferDirection, setTransferDirection] = useState("container_to_store");

  useEffect(() => {
    if (deliveryReceived && suppliers.length === 0) {
      getSuppliers()
        .then((res) => setSuppliers(res.suppliers))
        .catch(() => setSuppliers([]));
    }
  }, [deliveryReceived, suppliers.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setProgress(0);
    setProcessing(false);
    setResult(null);
    setError(null);
    try {
      const data = await uploadInventoryWithProgress(file, (pct) => {
        setProgress(pct);
        if (pct >= 100) setProcessing(true);
      });
      setResult(data);
      setFile(null);
      e.target.reset();
      onUploaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
      setProcessing(false);
    }
  }

  function handleReviewDelivery() {
    navigate("/delivery-review", { state: { vendors: deliveryVendors } });
  }

  function handleReviewTransfer() {
    navigate("/transfer-review", { state: { direction: transferDirection } });
  }

  return (
    <section className="card">
      <h2>Upload today's inventory</h2>
      <InfoBlock brief="Upload today's Toast Retail export (CSV or XLSX).">
        It's tagged with today's date automatically. Skipping a day is fine - reports just use
        whatever the latest upload says until the next one comes in, they don't error out or lose
        data for the gap, just report slightly stale numbers until you catch back up.
      </InfoBlock>
      <label className="delivery-checkbox">
        <input
          type="checkbox"
          checked={deliveryReceived}
          onChange={(e) => {
            setDeliveryReceived(e.target.checked);
            if (!e.target.checked) setDeliveryVendors([]);
          }}
        />
        We received a delivery today
      </label>
      {deliveryReceived && (
        <div className="delivery-vendor-select">
          <span className="delivery-vendor-select-label">Which vendor(s)?</span>
          <VendorPicker suppliers={suppliers} selected={deliveryVendors} onChange={setDeliveryVendors} />
        </div>
      )}
      <label className="delivery-checkbox">
        <input
          type="checkbox"
          checked={transferHappened}
          onChange={(e) => setTransferHappened(e.target.checked)}
        />
        Container movement happened today
      </label>
      {transferHappened && (
        <div className="delivery-vendor-select">
          <span className="delivery-vendor-select-label">Which direction?</span>
          <label className="transfer-direction-option">
            <input
              type="radio"
              name="transfer-direction"
              checked={transferDirection === "container_to_store"}
              onChange={() => setTransferDirection("container_to_store")}
            />
            Container → Store (restocking the shelf)
          </label>
          <label className="transfer-direction-option">
            <input
              type="radio"
              name="transfer-direction"
              checked={transferDirection === "store_to_container"}
              onChange={() => setTransferDirection("store_to_container")}
            />
            Store → Container (returning stock to storage)
          </label>
        </div>
      )}
      <form onSubmit={handleSubmit} className="upload-form">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={submitting}
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        <button type="submit" disabled={!file || submitting}>
          {submitting ? (processing ? "Processing…" : `Uploading… ${progress}%`) : "Upload"}
        </button>
      </form>
      {submitting && (
        <div className="progress-bar" style={{ marginTop: "0.75rem" }}>
          <div
            className={`progress-bar-fill${processing ? " progress-bar-fill-indeterminate" : ""}`}
            style={{ width: processing ? "100%" : `${progress}%` }}
          />
        </div>
      )}
      {submitting && processing && (
        <p className="muted" style={{ marginTop: "0.4rem", fontSize: "0.82rem" }}>
          File's fully uploaded - now parsing and saving rows, this can take a few seconds for a
          full catalog export.
        </p>
      )}
      {result && (
        <p className="success">
          {result.rows_loaded} items loaded for {result.snapshot_date}
          {result.rows_skipped > 0 && ` (${result.rows_skipped} rows skipped - missing item id)`}
        </p>
      )}
      {result && deliveryReceived && deliveryVendors.length > 0 && (
        <button type="button" onClick={handleReviewDelivery} style={{ marginTop: "0.5rem" }}>
          Review delivery ({deliveryVendors.length} vendor{deliveryVendors.length === 1 ? "" : "s"}) →
        </button>
      )}
      {result && transferHappened && (
        <button type="button" onClick={handleReviewTransfer} style={{ marginTop: "0.5rem" }}>
          Review transfer →
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
