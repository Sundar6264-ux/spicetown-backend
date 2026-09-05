import SupplierProjection from "../components/SupplierProjection.jsx";

export default function SupplierProjectionPage() {
  return (
    <>
      <div className="page-header">
        <h1>Supplier Projection</h1>
        <p className="muted">
          Projected demand and need-to-order quantities, broken down by supplier.
        </p>
      </div>
      <SupplierProjection />
    </>
  );
}
