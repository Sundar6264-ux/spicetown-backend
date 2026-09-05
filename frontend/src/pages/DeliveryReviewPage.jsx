import DeliveryReview from "../components/DeliveryReview.jsx";

export default function DeliveryReviewPage() {
  return (
    <>
      <div className="page-header">
        <h1>Review Delivery</h1>
        <p className="muted">Confirm what actually arrived before it's logged as purchased.</p>
      </div>
      <DeliveryReview />
    </>
  );
}
