import { useEffect, useState, useCallback } from "react";
import { getJobStatus } from "../api";
import { formatRestaurantTime } from "../format";

const JOB_LABELS = {
  toast_sales_sync: "Sales sync (Toast)",
  inventory_upload: "Inventory upload",
};

function StatusPill({ status }) {
  const cls = status === "success" ? "pill pill-success" : status === "failed" ? "pill pill-failed" : "pill pill-running";
  return <span className={cls}>{status}</span>;
}

const IGNORED_COLUMNS_MARKER = "Columns ignored (not in COLUMN_MAP): ";

// The full ignored-columns list is only ever needed for one specific
// diagnostic (checking the real Toast header text for a column that isn't
// mapping correctly) - every other time it's just noise on a page meant for
// a quick glance. Collapse it behind a toggle instead of dropping it, since
// it's still the only place that real header text is visible.
function JobDetail({ detail }) {
  const [expanded, setExpanded] = useState(false);
  const markerIndex = detail.indexOf(IGNORED_COLUMNS_MARKER);

  if (markerIndex === -1) {
    return <span className="job-detail">{detail}</span>;
  }

  const summary = detail.slice(0, markerIndex).trim();
  const columnsText = detail.slice(markerIndex + IGNORED_COLUMNS_MARKER.length).trim();
  const columnCount = columnsText === "none" ? 0 : columnsText.split(",").length;

  return (
    <span className="job-detail">
      {summary}{" "}
      {columnCount > 0 ? (
        <button type="button" className="info-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide ignored columns ▲" : `${columnCount} columns ignored (as expected) ?`}
        </button>
      ) : (
        "No columns ignored."
      )}
      {expanded && <div className="job-detail-columns muted">{columnsText}</div>}
    </span>
  );
}

export default function JobStatusWidget({ refreshSignal }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getJobStatus();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal, load]);

  return (
    <section className="card">
      <div className="card-header">
        <h2>Job status</h2>
        <button className="link-button" onClick={load}>
          Refresh
        </button>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">Could not load job status: {error}</p>}
      {!loading && !error && jobs.length === 0 && (
        <p className="muted">No jobs have run yet.</p>
      )}
      <ul className="job-list">
        {jobs.map((job) => (
          <li key={job.job_name} className="job-row">
            <span className="job-name">{JOB_LABELS[job.job_name] || job.job_name}</span>
            <span className="job-time">
              {job.finished_at ? formatRestaurantTime(job.finished_at) : "in progress"}
            </span>
            <StatusPill status={job.status} />
            {job.detail && <JobDetail detail={job.detail} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
