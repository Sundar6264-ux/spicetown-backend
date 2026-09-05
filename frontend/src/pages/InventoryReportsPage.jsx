import InventoryReports from "../components/InventoryReports.jsx";

export default function InventoryReportsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Inventory Reports</h1>
        <p className="muted">Barcode issues and the price change log, from the latest inventory upload.</p>
      </div>
      <InventoryReports />
    </>
  );
}
