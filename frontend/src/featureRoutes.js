// Single source of truth for which route maps to which admin-grantable
// feature key (see backend/app/features.py - keep these in sync). Order
// matters: it's also the fallback order used to pick a landing page for a
// user who can't access "/" (Overview).
export const FEATURE_ROUTES = [
  { path: "/", label: "Overview", feature: "overview", end: true },
  { path: "/open-orders", label: "Open Orders", feature: "open_orders" },
  { path: "/items-sold", label: "Items Sold Today", feature: "items_sold" },
  { path: "/reorder", label: "Reorder Candidates (All Suppliers)", feature: "reorder_candidates" },
  { path: "/supplier-projection", label: "Supplier Projection", feature: "supplier_projection" },
  { path: "/delivery-review", label: "Delivery Review", feature: "delivery_review" },
  { path: "/transfer-review", label: "Transfer Review", feature: "transfer_review" },
  { path: "/inventory-reports", label: "Inventory Reports", feature: "inventory_reports" },
  { path: "/reconciliation", label: "Reconciliation", feature: "reconciliation" },
  { path: "/purchase-order", label: "Purchase Order Cart", feature: "purchase_order_cart" },
];

export function firstAccessiblePath(hasFeature) {
  const match = FEATURE_ROUTES.find((r) => hasFeature(r.feature));
  return match ? match.path : "/no-access";
}

// Purely presentational grouping for the sidebar - doesn't affect routing or
// feature-gating (FEATURE_ROUTES above stays the single source of truth for
// that; each entry here is just a lookup key into it). A group renders
// nothing if this user has none of its features, same "never show what
// isn't granted" rule the old flat list already followed.
export const NAV_GROUPS = [
  { type: "item", feature: "overview" },
  { type: "group", key: "sales", label: "Sales", features: ["open_orders", "items_sold"] },
  { type: "group", key: "ordering", label: "Ordering", features: ["reorder_candidates", "supplier_projection"] },
  { type: "group", key: "stock", label: "Stock Movement", features: ["delivery_review", "transfer_review"] },
  { type: "group", key: "reports", label: "Reports", features: ["inventory_reports", "reconciliation"] },
];
