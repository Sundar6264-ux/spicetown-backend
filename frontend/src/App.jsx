import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext.jsx";
import { firstAccessiblePath } from "./featureRoutes.js";
import Sidebar from "./components/Sidebar.jsx";
import ChatWidget from "./components/ChatWidget.jsx";
import CartButton from "./components/CartButton.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import Overview from "./pages/Overview.jsx";
import OpenOrdersPage from "./pages/OpenOrdersPage.jsx";
import ItemsSoldPage from "./pages/ItemsSoldPage.jsx";
import ReorderPage from "./pages/ReorderPage.jsx";
import SupplierProjectionPage from "./pages/SupplierProjectionPage.jsx";
import PurchaseOrderPage from "./pages/PurchaseOrderPage.jsx";
import DeliveryReviewPage from "./pages/DeliveryReviewPage.jsx";
import TransferReviewPage from "./pages/TransferReviewPage.jsx";
import InventoryReportsPage from "./pages/InventoryReportsPage.jsx";
import ReconciliationPage from "./pages/ReconciliationPage.jsx";
import HelpPage from "./pages/HelpPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import ChangePasswordPage from "./pages/ChangePasswordPage.jsx";
import NoAccessPage from "./pages/NoAccessPage.jsx";

// Wraps a page element: 403-equivalent redirect (to the user's first
// accessible tab, or the no-access page) if they haven't been granted this
// feature - mirrors the backend's own per-feature 403s (app/features.py),
// just resolved client-side so it doesn't even flash the wrong page.
function Protected({ feature, children }) {
  const { hasFeature } = useAuth();
  if (!hasFeature(feature)) {
    return <Navigate to={firstAccessiblePath(hasFeature)} replace />;
  }
  return children;
}

function AppShell() {
  const { user, loading, hasFeature } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route
            path="/"
            element={
              <Protected feature="overview">
                <Overview />
              </Protected>
            }
          />
          <Route
            path="/open-orders"
            element={
              <Protected feature="open_orders">
                <OpenOrdersPage />
              </Protected>
            }
          />
          <Route
            path="/items-sold"
            element={
              <Protected feature="items_sold">
                <ItemsSoldPage />
              </Protected>
            }
          />
          <Route
            path="/reorder"
            element={
              <Protected feature="reorder_candidates">
                <ReorderPage />
              </Protected>
            }
          />
          <Route
            path="/supplier-projection"
            element={
              <Protected feature="supplier_projection">
                <SupplierProjectionPage />
              </Protected>
            }
          />
          <Route
            path="/purchase-order"
            element={
              <Protected feature="purchase_order_cart">
                <PurchaseOrderPage />
              </Protected>
            }
          />
          <Route
            path="/delivery-review"
            element={
              <Protected feature="delivery_review">
                <DeliveryReviewPage />
              </Protected>
            }
          />
          <Route
            path="/transfer-review"
            element={
              <Protected feature="transfer_review">
                <TransferReviewPage />
              </Protected>
            }
          />
          <Route
            path="/inventory-reports"
            element={
              <Protected feature="inventory_reports">
                <InventoryReportsPage />
              </Protected>
            }
          />
          <Route
            path="/reconciliation"
            element={
              <Protected feature="reconciliation">
                <ReconciliationPage />
              </Protected>
            }
          />
          {/* old paths, kept as redirects so a bookmark/old link doesn't just 404 */}
          <Route path="/price-changes" element={<Navigate to="/inventory-reports" replace />} />
          <Route path="/barcode-reports" element={<Navigate to="/inventory-reports" replace />} />
          <Route
            path="/help"
            element={
              <Protected feature="help">
                <HelpPage />
              </Protected>
            }
          />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/no-access" element={<NoAccessPage />} />
          <Route path="/users" element={user.is_admin ? <UsersPage /> : <Navigate to="/" replace />} />
        </Routes>
      </main>
      {hasFeature("purchase_order_cart") && <CartButton />}
      {hasFeature("ask_bot") && <ChatWidget />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </AuthProvider>
  );
}
