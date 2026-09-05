import { useState } from "react";
import { generateWeeklyDigest } from "../api";
import InfoBlock from "./InfoBlock.jsx";

const SECTIONS = [
  { key: "sales", label: "Sales" },
  { key: "reorder", label: "Reorder needs" },
  { key: "money_at_risk", label: "Money at risk" },
  { key: "vendor_savings", label: "Vendor savings" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "housekeeping", label: "Data housekeeping" },
];

function fmtMoney(n) {
  return n == null ? "-" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function WeeklyDigest() {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await generateWeeklyDigest();
      setDigest(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const sales = digest?.data?.sales;
  const salesDelta =
    sales && sales.prior_week.revenue > 0
      ? Math.round(((sales.this_week.revenue - sales.prior_week.revenue) / sales.prior_week.revenue) * 1000) / 10
      : null;

  return (
    <section className="card">
      <div className="card-header">
        <h2>Weekly Digest</h2>
        <button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : digest ? "Regenerate" : "Generate this week's digest"}
        </button>
      </div>
      <InfoBlock brief="An auto-generated summary pulling from every report already in this dashboard - sales, reorder needs, dead stock/margin, vendor savings, reconciliation, and barcode data quality.">
        Every number is computed the normal way by the same report functions used elsewhere in the
        app - nothing here is estimated. Claude (Anthropic's AI) only turns those real numbers into
        a short written summary per section; it never invents a figure. Generated on demand (not on
        a schedule), so it only costs an API call when you actually want one.
      </InfoBlock>

      {error && <p className="error">{error}</p>}

      {!digest && !loading && !error && (
        <p className="muted">Click "Generate this week's digest" to see a summary of the trailing 7 days.</p>
      )}

      {digest && (
        <div className="digest">
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            {digest.week_start} to {digest.week_end}
          </p>
          <p className="digest-headline">{digest.narrative.headline}</p>

          {sales && (
            <div className="digest-stat-row">
              <span>
                This week: <strong>{fmtMoney(sales.this_week.revenue)}</strong> ({sales.this_week.checks} checks)
              </span>
              <span>
                Last week: <strong>{fmtMoney(sales.prior_week.revenue)}</strong> ({sales.prior_week.checks} checks)
              </span>
              {salesDelta != null && (
                <span className={salesDelta < 0 ? "text-negative" : "text-positive"}>
                  {salesDelta > 0 ? "+" : ""}
                  {salesDelta}%
                </span>
              )}
            </div>
          )}

          {SECTIONS.map((s) => (
            <div className="digest-section" key={s.key}>
              <h4>{s.label}</h4>
              <p>{digest.narrative[s.key]}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
