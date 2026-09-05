import OpenOrders from "../components/OpenOrders.jsx";

export default function OpenOrdersPage() {
  return (
    <>
      <div className="page-header">
        <h1>Open Orders</h1>
        <p className="muted">Orders currently open on the POS, live from Toast.</p>
      </div>
      <OpenOrders />
    </>
  );
}
