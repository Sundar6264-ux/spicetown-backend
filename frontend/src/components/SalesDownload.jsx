import { useState } from "react";
import { downloadSales } from "../api";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function SalesDownload() {
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleDownload(format) {
    if (!start || !end) return;
    setBusy(true);
    setError(null);
    try {
      await downloadSales(start, end, format);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Download sales data</h2>
      <div className="date-range">
        <label>
          Start
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          End
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className="download-buttons">
        <button disabled={busy} onClick={() => handleDownload("csv")}>
          Download CSV
        </button>
        <button disabled={busy} onClick={() => handleDownload("pdf")}>
          Download PDF
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
