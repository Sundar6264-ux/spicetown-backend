import TransferReview from "../components/TransferReview.jsx";

export default function TransferReviewPage() {
  return (
    <>
      <div className="page-header">
        <h1>Review Transfer</h1>
        <p className="muted">Confirm what actually moved before it's logged as a location transfer.</p>
      </div>
      <TransferReview />
    </>
  );
}
