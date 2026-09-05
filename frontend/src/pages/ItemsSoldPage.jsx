import ItemsSold from "../components/ItemsSold.jsx";

export default function ItemsSoldPage() {
  return (
    <>
      <div className="page-header">
        <h1>Items Sold Today</h1>
        <p className="muted">Quantity and revenue per item for a selected day.</p>
      </div>
      <ItemsSold />
    </>
  );
}
