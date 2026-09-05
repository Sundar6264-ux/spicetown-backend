// Explicit VITE_API_BASE always wins. Otherwise: in `npm run dev` (separate
// frontend/backend processes) default to localhost:8000. In a production
// build served *by* the backend itself (single process, e.g. behind Tailscale),
// default to "" (relative) so requests follow whatever host/origin the page
// was actually loaded from, rather than hardcoding "localhost".
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8000" : "");

async function request(path, options = {}) {
  // credentials: "include" is required in both dev (cross-origin, :5173 -> :8000)
  // and prod (same-origin) for the session cookie to actually be sent/accepted.
  const res = await fetch(`${API_BASE}${path}`, { ...options, credentials: "include" });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // response wasn't JSON; fall back to statusText
    }
    // A 401 on any call other than the login attempt itself means the session
    // expired or was revoked (e.g. an admin reset this user's password) -
    // bounce back to the login screen instead of leaving stale/broken pages up.
    if (res.status === 401 && path !== "/api/auth/login") {
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }
  return res;
}

async function postJSON(path, body) {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function patchJSON(path, body) {
  const res = await request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function login(username, password) {
  return postJSON("/api/auth/login", { username, password });
}

export async function logout() {
  return postJSON("/api/auth/logout", {});
}

export async function getMe() {
  const res = await request("/api/auth/me");
  return res.json();
}

export async function changePassword(currentPassword, newPassword) {
  return postJSON("/api/auth/change-password", { current_password: currentPassword, new_password: newPassword });
}

export async function listUsers() {
  const res = await request("/api/auth/users");
  return res.json();
}

export async function createUser(username, password, isAdmin, allowedFeatures = []) {
  return postJSON("/api/auth/users", {
    username,
    password,
    is_admin: isAdmin,
    allowed_features: allowedFeatures,
  });
}

export async function setUserPassword(userId, newPassword) {
  return postJSON(`/api/auth/users/${userId}/set-password`, { new_password: newPassword });
}

export async function listFeatures() {
  const res = await request("/api/auth/features");
  return res.json();
}

export async function setUserFeatures(userId, allowedFeatures) {
  return patchJSON(`/api/auth/users/${userId}/features`, { allowed_features: allowedFeatures });
}

export async function getJobStatus() {
  const res = await request("/api/jobs/status");
  return res.json();
}

export async function uploadInventory(file) {
  return uploadInventoryWithProgress(file);
}

export function uploadInventoryWithProgress(file, onProgress) {
  const formData = new FormData();
  formData.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/inventory/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // response wasn't JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      if (xhr.status === 401) {
        window.dispatchEvent(new Event("auth:unauthorized"));
      }
      const detail = (body && (body.detail || JSON.stringify(body))) || xhr.statusText;
      const error = new Error(detail);
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

export async function getReorderCandidates(lookbackDays, leadTimeDays) {
  const params = new URLSearchParams({ lookback_days: lookbackDays, lead_time_days: leadTimeDays });
  const res = await request(`/api/ordering/reorder-candidates?${params.toString()}`);
  return res.json();
}

export async function getSuppliers() {
  const res = await request("/api/ordering/suppliers");
  return res.json();
}

export async function getSupplierProjection(supplier, startDate, endDate, horizonDays) {
  const params = new URLSearchParams({ supplier, start: startDate, end: endDate });
  if (horizonDays) params.set("horizons", String(horizonDays));
  const res = await request(`/api/ordering/supplier-projection?${params.toString()}`);
  return res.json();
}

export async function getItemWeeklySales(itemId, startDate, endDate) {
  const params = new URLSearchParams({ item_id: itemId, start: startDate, end: endDate });
  const res = await request(`/api/ordering/item-weekly-sales?${params.toString()}`);
  return res.json();
}

export async function exportPurchaseOrderPdf(supplier, items) {
  const res = await request("/api/ordering/purchase-order/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplier, items }),
  });
  const blob = await res.blob();
  const match = (res.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `purchase-order-${supplier}.pdf`;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function getCart() {
  const res = await request("/api/ordering/cart");
  return res.json();
}

export async function addToCart(supplier, items) {
  const result = await postJSON("/api/ordering/cart/items", { supplier, items });
  window.dispatchEvent(new Event("cart:updated"));
  return result;
}

export async function updateCartItem(cartItemId, fields) {
  const res = await request(`/api/ordering/cart/items/${cartItemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return res.json();
}

export async function deleteCartItem(cartItemId) {
  const res = await request(`/api/ordering/cart/items/${cartItemId}`, { method: "DELETE" });
  const result = await res.json();
  window.dispatchEvent(new Event("cart:updated"));
  return result;
}

export async function clearSupplierCart(supplier) {
  const params = new URLSearchParams({ supplier });
  const res = await request(`/api/ordering/cart?${params.toString()}`, { method: "DELETE" });
  const result = await res.json();
  window.dispatchEvent(new Event("cart:updated"));
  return result;
}

export async function getItemsSold(date) {
  const suffix = date ? `?date=${date}` : "";
  const res = await request(`/api/sales/items-sold${suffix}`);
  return res.json();
}


export async function getPriceChanges() {
  const res = await request("/api/inventory/price-changes");
  return res.json();
}

export async function searchPriceHistory(query) {
  const params = new URLSearchParams({ search: query });
  const res = await request(`/api/inventory/price-history?${params.toString()}`);
  return res.json();
}

async function downloadFile(path, fallbackFilename) {
  const res = await request(path);
  const blob = await res.blob();
  const match = (res.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadSales(start, end, format) {
  const params = new URLSearchParams({ start, end, format });
  await downloadFile(`/api/sales/export?${params.toString()}`, `spicetown-sales.${format}`);
}

export async function getMissingBarcodes() {
  const res = await request("/api/reports/missing-barcodes");
  return res.json();
}

export async function getInvalidBarcodes() {
  const res = await request("/api/reports/invalid-barcodes");
  return res.json();
}

export async function downloadMissingBarcodes() {
  await downloadFile("/api/reports/missing-barcodes/export", "missing-barcodes.csv");
}

export async function downloadInvalidBarcodes() {
  await downloadFile("/api/reports/invalid-barcodes/export", "invalid-barcodes.csv");
}

export async function downloadPriceChanges() {
  await downloadFile("/api/inventory/price-changes/export", "price-change-log.csv");
}

export async function getDeadStock() {
  const res = await request("/api/reports/dead-stock");
  return res.json();
}

export async function downloadDeadStock() {
  await downloadFile("/api/reports/dead-stock/export", "dead-stock.csv");
}

export async function getMarginReport() {
  const res = await request("/api/reports/margin");
  return res.json();
}

export async function downloadMarginReport() {
  await downloadFile("/api/reports/margin/export", "margin-report.csv");
}

export async function getVendorPriceComparison() {
  const res = await request("/api/reports/vendor-price-comparison");
  return res.json();
}

export async function downloadVendorPriceComparison() {
  await downloadFile("/api/reports/vendor-price-comparison/export", "vendor-price-comparison.csv");
}

export async function searchItems(query, supplier) {
  const params = new URLSearchParams({ q: query });
  if (supplier) params.set("supplier", supplier);
  const res = await request(`/api/inventory/items/search?${params.toString()}`);
  return res.json();
}

export function downloadPurchaseLogSampleCsv() {
  const rows = [
    "item name,supplier,quantity,unit cost,received date,notes",
    "Nanak Rasmalai 12 Pcs/1kg,ABC Distributors,12,18.50,2026-08-20,Invoice #4521",
    "Haldiram's Gulab Jamun (Can) 1Kg,ABC Distributors,6,9.75,2026-08-20,Invoice #4521",
  ].join("\n");
  const blob = new Blob([rows], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "purchase-log-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function logPurchase(entry) {
  return postJSON("/api/reconciliation/purchases", entry);
}

export function uploadPurchaseLogWithProgress(file, defaultReceivedDate, onProgress) {
  const formData = new FormData();
  formData.append("file", file);
  if (defaultReceivedDate) formData.append("default_received_date", defaultReceivedDate);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/reconciliation/purchases/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // response wasn't JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      if (xhr.status === 401) {
        window.dispatchEvent(new Event("auth:unauthorized"));
      }
      const detail = (body && (body.detail || JSON.stringify(body))) || xhr.statusText;
      const error = new Error(detail);
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

export async function getPurchases(startDate, endDate) {
  const params = new URLSearchParams();
  const res = await request(`/api/reconciliation/purchases?${params.toString()}`);
  return res.json();
}

export async function deletePurchase(id) {
  const res = await request(`/api/reconciliation/purchases/${id}`, { method: "DELETE" });
  return res.json();
}

export async function getDeliveryCandidates(vendor) {
  const params = new URLSearchParams({ vendor });
  const res = await request(`/api/reconciliation/delivery-candidates?${params.toString()}`);
  return res.json();
}

export async function confirmDelivery(vendor, receivedDate, items) {
  return postJSON("/api/reconciliation/delivery-confirm", { vendor, received_date: receivedDate, items });
}

export async function getReconciliationDemo() {
  const res = await request("/api/reconciliation/demo");
  return res.json();
}

export async function getReconciliationReport(startDate, endDate) {
  const params = new URLSearchParams({ start: startDate, end: endDate });
  const res = await request(`/api/reconciliation/report?${params.toString()}`);
  return res.json();
}

export async function downloadReconciliationReport(startDate, endDate) {
  const params = new URLSearchParams({ start: startDate, end: endDate });
  await downloadFile(
    `/api/reconciliation/report/export?${params.toString()}`,
    `reconciliation-${startDate}-${endDate}.csv`
  );
}

export async function askQuestion(question, history) {
  return postJSON("/api/ask", { question, history });
}

export async function generateWeeklyDigest() {
  return postJSON("/api/weekly-digest/generate", {});
}

export async function getTransferCandidates(direction) {
  const params = new URLSearchParams({ direction });
  const res = await request(`/api/transfers/candidates?${params.toString()}`);
  return res.json();
}

export async function confirmTransfers(direction, transferDate, items) {
  return postJSON("/api/transfers/confirm", { direction, transfer_date: transferDate, items });
}

export async function getOpenOrders(date, employeeGuid) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (employeeGuid) params.set("employee_guid", employeeGuid);
  const qs = params.toString();
  const res = await request(`/api/orders/open${qs ? `?${qs}` : ""}`);
  return res.json();
}

export async function getOrderEmployees() {
  const res = await request("/api/orders/employees");
  return res.json();
}

export async function getAllTimeOpenOrders(employeeGuid) {
  const params = new URLSearchParams();
  if (employeeGuid) params.set("employee_guid", employeeGuid);
  const qs = params.toString();
  // Instant - reads the background-refreshed cache, never hits Toast live.
  const res = await request(`/api/orders/open/all-time${qs ? `?${qs}` : ""}`);
  return res.json();
}

export async function rescanAllTimeOpenOrders() {
  // Slow (minutes) - forces a real full re-scan instead of waiting for the
  // next scheduled background refresh. Only call this from an explicit user
  // action, never automatically.
  return postJSON("/api/orders/open/all-time/rescan", {});
}
