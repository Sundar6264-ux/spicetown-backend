import { useEffect, useMemo, useState } from "react";
import { getCart, addToCart, updateCartItem, deleteCartItem, clearSupplierCart, exportPurchaseOrderPdf, searchItems } from "../api";
import InfoBlock from "./InfoBlock.jsx";

// A persistent, shared cart (see backend CartItem/po_cart.py): items checked
// on Supplier Projection land here, across as many visits and suppliers as
// needed, and stay until someone removes them or clears a supplier's
// section - unlike the old one-shot "check items -> build PO -> download"
// flow, there's no router state to lose on a refresh.
export default function PurchaseOrderCart() {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportingSupplier, setExportingSupplier] = useState(null);
  const [confirmClearSupplier, setConfirmClearSupplier] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await getCart();
      setCart(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFieldChange(item, field, value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return;
    // Optimistic update so typing feels immediate; refresh() would blow away
    // the input's current cursor/focus state on every keystroke. unit_cost
    // doesn't change with qty/case_of, so the estimate below can be
    // recomputed live from this without waiting on the server.
    setCart((prev) => ({
      ...prev,
      suppliers: prev.suppliers.map((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === item.id ? { ...i, [field]: num } : i)),
      })),
    }));
    try {
      await updateCartItem(item.id, { [field]: num });
    } catch (err) {
      setError(err.message);
      refresh();
    }
  }

  async function handleRemove(item) {
    try {
      await deleteCartItem(item.id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearSupplier(supplier) {
    try {
      await clearSupplierCart(supplier);
      setConfirmClearSupplier(null);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload(supplierRow) {
    // The PDF only ever gets name/SKU/qty (cases) - cost and the estimate
    // are a cart-side planning aid, not something to hand the vendor.
    const toOrder = supplierRow.items
      .filter((i) => Number(i.qty) > 0)
      .map((i) => ({ name: i.name, supplier_item_id: i.supplier_item_id || null, qty: Number(i.qty) }));
    if (toOrder.length === 0) return;
    setExportingSupplier(supplierRow.supplier);
    setError(null);
    try {
      await exportPurchaseOrderPdf(supplierRow.supplier, toOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingSupplier(null);
    }
  }

  const grandEstimate = useMemo(() => {
    if (!cart) return { total: 0, hasAny: false, missing: 0 };
    let total = 0;
    let hasAny = false;
    let missing = 0;
    for (const s of cart.suppliers) {
      for (const i of s.items) {
        if (i.unit_cost != null) {
          total += i.unit_cost * i.qty * i.case_of;
          hasAny = true;
        } else {
          missing += 1;
        }
      }
    }
    return { total, hasAny, missing };
  }, [cart]);

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Loading cart…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <InfoBlock brief="A shared, persistent cart across every supplier - add items from Supplier Projection over as many visits as you need, then review quantities and download a PO PDF per supplier.">
        Items you add to the cart from Supplier Projection show up here, grouped by supplier, and
        stay here until you remove them or clear a supplier's section - there's no need to build
        the whole order in one sitting, and you can have several suppliers' orders going at once.
        Adjust quantities directly here (they save automatically). The form below searches a
        supplier's existing inventory items first - only fall back to typing in a name/SKU by hand
        if the item genuinely isn't in inventory yet. Then download a PDF for whichever supplier
        you're ready to send. <strong>Qty</strong> is how many cases you're ordering; <strong>Case of</strong> is
        how many units are in one case, so the estimated cost is Qty × Case of × the item's cost on
        file. Cost and the PO estimate are shown here to help you plan, but never appear on the
        downloaded PDF - items left at 0 are skipped in the PDF but stay in the cart.
      </InfoBlock>

      {error && <p className="error">{error}</p>}

      <AddItemForm existingSuppliers={(cart?.suppliers || []).map((s) => s.supplier)} onAdded={refresh} />

      {(!cart || cart.suppliers.length === 0) && (
        <p className="muted">
          The cart is empty. Go to Supplier Projection, check some items, and click "Add to cart" -
          or add an item directly above.
        </p>
      )}

      {cart?.suppliers.map((supplierRow) => (
        <SupplierCartSection
          key={supplierRow.supplier}
          supplierRow={supplierRow}
          onFieldChange={handleFieldChange}
          onRemove={handleRemove}
          onDownload={() => handleDownload(supplierRow)}
          exporting={exportingSupplier === supplierRow.supplier}
          confirmingClear={confirmClearSupplier === supplierRow.supplier}
          onRequestClear={() => setConfirmClearSupplier(supplierRow.supplier)}
          onCancelClear={() => setConfirmClearSupplier(null)}
          onConfirmClear={() => handleClearSupplier(supplierRow.supplier)}
        />
      ))}

      {cart && cart.suppliers.length > 0 && (
        <div className="po-cart-grand-total">
          <strong>Total PO estimate across every supplier: ${grandEstimate.total.toFixed(2)}</strong>
          {grandEstimate.missing > 0 && (
            <span className="muted">
              {" "}
              ({grandEstimate.missing} item{grandEstimate.missing === 1 ? "" : "s"} without a known
              cost, not included)
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function SupplierCartSection({
  supplierRow,
  onFieldChange,
  onRemove,
  onDownload,
  exporting,
  confirmingClear,
  onRequestClear,
  onCancelClear,
  onConfirmClear,
}) {
  const orderCount = useMemo(
    () => supplierRow.items.filter((i) => Number(i.qty) > 0).length,
    [supplierRow.items]
  );

  const estimate = useMemo(() => {
    let total = 0;
    let missing = 0;
    for (const i of supplierRow.items) {
      if (i.unit_cost != null) total += i.unit_cost * i.qty * i.case_of;
      else missing += 1;
    }
    return { total, missing };
  }, [supplierRow.items]);

  return (
    <div className="po-cart-section">
      <div className="sp-toolbar">
        <h3 style={{ margin: 0 }}>
          {supplierRow.supplier} <span className="muted">({supplierRow.items.length} item(s))</span>
        </h3>
        <div className="sp-toolbar-actions">
          {confirmingClear ? (
            <>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                Remove all {supplierRow.items.length} item(s)?
              </span>
              <button className="link-button" onClick={onCancelClear}>
                Cancel
              </button>
              <button onClick={onConfirmClear}>Yes, clear</button>
            </>
          ) : (
            <button className="link-button" onClick={onRequestClear}>
              Clear this supplier's cart
            </button>
          )}
          <button disabled={orderCount === 0 || exporting} onClick={onDownload}>
            {exporting ? "Building PDF…" : `Download PDF (${orderCount})`}
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th style={{ textAlign: "right" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Case of</th>
              <th style={{ textAlign: "right" }}>Cost of</th>
              <th style={{ textAlign: "right" }}>Est. cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {supplierRow.items.map((item) => (
              <tr key={item.id}>
                <td>{item.supplier_item_id || "-"}</td>
                <td>{item.name}</td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="po-qty-input"
                    value={item.qty}
                    onChange={(e) => onFieldChange(item, "qty", e.target.value)}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="po-qty-input"
                    value={item.case_of}
                    onChange={(e) => onFieldChange(item, "case_of", e.target.value)}
                  />
                </td>
                <td style={{ textAlign: "right" }}>{item.unit_cost != null ? `$${item.unit_cost.toFixed(2)}` : "-"}</td>
                <td style={{ textAlign: "right" }}>
                  {item.unit_cost != null ? `$${(item.unit_cost * item.qty * item.case_of).toFixed(2)}` : "-"}
                </td>
                <td>
                  <button className="link-button" onClick={() => onRemove(item)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted po-cart-supplier-estimate">
        Estimated cost for {supplierRow.supplier}: <strong>${estimate.total.toFixed(2)}</strong>
        {estimate.missing > 0 &&
          ` (${estimate.missing} item${estimate.missing === 1 ? "" : "s"} without a known cost, not included)`}
      </p>
    </div>
  );
}

// Adds an item to a supplier's cart section. Default path: search that
// vendor's own inventory items (so the real item_id/SKU get attached, same
// as items added from Supplier Projection). Fallback: "we ordered a new
// item that isn't in inventory yet" - a small manual name/SKU box, only
// shown once a search for it comes up empty.
function AddItemForm({ existingSuppliers, onAdded }) {
  const [supplier, setSupplier] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [matchedItem, setMatchedItem] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualSku, setManualSku] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Changing supplier invalidates whatever was found/picked under the old one.
  useEffect(() => {
    setMatchedItem(null);
    setManualMode(false);
    setResults([]);
  }, [supplier]);

  useEffect(() => {
    if (matchedItem || manualMode || !supplier.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchItems(query.trim(), supplier.trim());
        setResults(res.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, supplier, matchedItem, manualMode]);

  const effectiveName = matchedItem ? matchedItem.name : manualName;
  const canAdd = supplier.trim() && effectiveName.trim() && Number(qty) > 0;

  function resetPickerState() {
    setQuery("");
    setResults([]);
    setMatchedItem(null);
    setManualMode(false);
    setManualName("");
    setManualSku("");
    setQty("1");
  }

  async function handleAdd() {
    if (!canAdd) return;
    setSaving(true);
    setError(null);
    try {
      await addToCart(supplier.trim(), [
        {
          item_id: matchedItem ? matchedItem.item_id : null,
          name: effectiveName.trim(),
          supplier_item_id: matchedItem ? matchedItem.supplier_item_id || null : manualSku.trim() || null,
          qty: Number(qty),
        },
      ]);
      resetPickerState();
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="po-add-item-form">
      <p className="muted" style={{ margin: "0 0 0.4rem 0", fontSize: "0.82rem" }}>
        Add an item to a supplier's cart - search their existing inventory items, or add a new one
        if it isn't in inventory:
      </p>
      <div className="date-range">
        <label>
          Supplier
          <input
            type="text"
            list="po-cart-supplier-options"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Supplier name"
          />
          <datalist id="po-cart-supplier-options">
            {existingSuppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      </div>

      {!supplier.trim() && (
        <p className="muted item-picker-status">Enter a supplier above to search their items.</p>
      )}

      {supplier.trim() && !matchedItem && !manualMode && (
        <div className="item-picker">
          <input
            type="text"
            placeholder={`Search ${supplier.trim()}'s items…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <p className="muted item-picker-status">Searching…</p>}
          {!searching && results.length > 0 && (
            <ul className="item-picker-results">
              {results.map((item) => (
                <li key={item.item_id}>
                  <button type="button" onClick={() => setMatchedItem(item)}>
                    <strong>{item.name}</strong>{" "}
                    <span className="muted">{item.supplier_item_id && `· SKU ${item.supplier_item_id}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="muted item-picker-status">
              No matches for "{query}" under {supplier.trim()}.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setManualMode(true);
                  setManualName(query.trim());
                }}
              >
                Add it as a new item →
              </button>
            </p>
          )}
        </div>
      )}

      {matchedItem && (
        <div className="item-picker-selected">
          <span>
            <strong>{matchedItem.name}</strong>{" "}
            {matchedItem.supplier_item_id && <span className="muted">· SKU {matchedItem.supplier_item_id}</span>}
          </span>
          <button type="button" className="link-button" onClick={() => { setMatchedItem(null); setQuery(""); }}>
            Change
          </button>
        </div>
      )}

      {supplier.trim() && !matchedItem && manualMode && (
        <div className="date-range">
          <label>
            Item name
            <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Item name" />
          </label>
          <label>
            SKU (optional)
            <input type="text" value={manualSku} onChange={(e) => setManualSku(e.target.value)} placeholder="Vendor SKU" />
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setManualMode(false);
              setManualName("");
              setManualSku("");
            }}
          >
            ← back to search
          </button>
        </div>
      )}

      {supplier.trim() && (matchedItem || manualMode) && (
        <div className="date-range" style={{ alignItems: "flex-end" }}>
          <label>
            Qty
            <input
              type="number"
              min="1"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ width: "5rem" }}
            />
          </label>
          <button disabled={!canAdd || saving} onClick={handleAdd}>
            {saving ? "Adding…" : "Add to cart"}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
