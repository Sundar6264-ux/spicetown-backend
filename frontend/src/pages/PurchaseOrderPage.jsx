import PurchaseOrderCart from "../components/PurchaseOrderCart.jsx";

export default function PurchaseOrderPage() {
  return (
    <>
      <div className="page-header">
        <h1>Purchase Order Cart</h1>
        <p className="muted">Review quantities across every supplier, add anything extra, and download the PO PDF.</p>
      </div>
      <PurchaseOrderCart />
    </>
  );
}
