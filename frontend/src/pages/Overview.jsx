import { useState } from "react";
import JobStatusWidget from "../components/JobStatusWidget.jsx";
import InventoryUpload from "../components/InventoryUpload.jsx";
import SalesDownload from "../components/SalesDownload.jsx";
import WeeklyDigest from "../components/WeeklyDigest.jsx";
import LabelPrinting from "../components/LabelPrinting.jsx";

export default function Overview() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p className="muted">Daily operations: sync status, inventory upload, sales export.</p>
      </div>
      <div className="grid">
        <JobStatusWidget refreshSignal={refreshSignal} />
        <InventoryUpload onUploaded={() => setRefreshSignal((n) => n + 1)} />
        <SalesDownload />
        <WeeklyDigest />
        <LabelPrinting />
      </div>
    </>
  );
}
