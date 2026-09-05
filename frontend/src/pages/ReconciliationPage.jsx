import Reconciliation from "../components/Reconciliation.jsx";

export default function ReconciliationPage() {
  return (
    <>
      <div className="page-header">
        <h1>Reconciliation</h1>
        <p className="muted">Purchased vs. sold vs. counted - the shrinkage/spoilage signal.</p>
      </div>
      <Reconciliation />
    </>
  );
}
