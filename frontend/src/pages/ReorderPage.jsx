import ReorderCandidates from "../components/ReorderCandidates.jsx";

export default function ReorderPage() {
  return (
    <>
      <div className="page-header">
        <h1>Reorder Candidates (All Suppliers)</h1>
        <p className="muted">
          Items projected to run short of stock within a chosen vendor lead time, across every
          supplier at once - for one supplier at a time with a draft PO, use Supplier Projection
          instead.
        </p>
      </div>
      <ReorderCandidates />
    </>
  );
}
