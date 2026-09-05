---
name: spicetown
description: Context and operating manual for the Spice Town dashboard project (Toast POS integration, sales/inventory tracking, reorder forecasting). Load this before making any change to /Users/sundar/spicetown-backend so you don't repeat mistakes already found and fixed once.
---

# Spice Town dashboard — project skill

Spice Town is a real South Asian grocery + halal meat + prepared-food store in Vernon, CT, using
Toast POS/Retail. This project is an internal ops dashboard for it — NOT a demo. All data referenced
below (orders, suppliers, item names) is real production data pulled from the live Toast account.

Read this whole file before touching the codebase. It exists because several of the mistakes below
were made once already this project and are easy to make again.

## What's built (Phase 1 of a build spec)

1. **Database**: SQLite (`backend/spicetown.db`), via SQLAlchemy + Alembic migrations.
2. **Daily sales sync**: pulls the prior day's orders from Toast's Orders API automatically.
3. **Manual inventory upload**: dashboard upload of Toast's daily "retail items" CSV/XLSX export.
4. **Sales CSV/PDF export** by date range.
5. **Ordering — partially built**: forecast engine + reorder trigger + per-supplier projection are
   done and running against real data. PO draft generation and real vendor lead-time/cost are
   **blocked**: Toast's Purchasing API (`/purchasing/v1/vendors`) exists but returns 403 - the
   current OAuth credentials don't have that scope (confirmed granted scopes: `cashmgmt:read
   config:read delivery_info.address:read digital_schedule:read guest.pi:read kitchen:read
   labor.employees:read labor:read menus:read orders:read packaging:read stock:read
   restaurants:read` - no `purchasing`). Don't build PO drafting against fabricated vendor data;
   `vendors_reference` stays empty until that scope is granted.
6. **React dashboard**: sidebar-navigated multi-page app (Overview / Items Sold / Reorder Candidates /
   Supplier Projection / Price Changes / Barcode Reports / Users / Change Password), served by the
   backend itself in production.
7. **Barcode reports**: missing-barcode and invalid-barcode (GS1 checksum) reports.
8. **Items Sold**: qty/revenue per item for a chosen date. "Today" is pulled live from Toast on
   demand (the nightly cron only ever syncs *yesterday and earlier* - see gotcha #8); any past date
   is served from the already-synced `orders` table. See `app/services/items_sold.py`.
9. **Price Changes**: diffs consecutive `inventory_snapshots` rows per item to find price changes,
   plus a name/barcode search showing one item's full price/cost timeline. Only as useful as the
   upload history - a single snapshot date correctly reports zero changes. See
   `app/services/price_history.py`.
10. **Authentication**: cookie-based sessions (not JWT), bcrypt-hashed passwords, admin/non-admin
    roles. Every API router requires login. No self-service signup and **no forgot-password flow
    anywhere, by design** - only an admin can create a user or set/reset a password; any user can
    change their own password by providing the current one. See "Authentication" section below.
11. **DB CSV dump**: `backend/scripts/dump_db_to_csv.sh` dumps every table to its own CSV (default
    output: `~/spicetown-db-dumps/<timestamp>/`). `users.csv` includes the bcrypt `password_hash`
    column - not plaintext, but still worth deleting dumps after use rather than sharing them.

## Architecture

- **Backend**: FastAPI (Python), chosen for pandas (header-name CSV/XLSX parsing) and APScheduler
  (in-process cron, no OS crontab needed).
- **DB**: SQLite + Alembic. WAL mode + 5s busy_timeout are set in `app/db.py` - required for a GUI
  tool (DB Browser for SQLite) or the `sqlite3` CLI to read concurrently without blocking the app's
  writes.
- **Frontend**: React + Vite + react-router-dom (`HashRouter` - deliberately NOT `BrowserRouter`,
  because the backend's static-file serving isn't set up with a SPA catch-all, so a hard refresh on
  e.g. `/reorder` would 404 with real client-side routing).
- **Production deployment**: the frontend is built to static files (`npm run build` → `frontend/dist`)
  and served *by the backend itself* (`app/main.py` mounts `StaticFiles` at `/` if `dist/` exists) -
  one process, one port, so there's only one thing to keep running. That process runs as a **macOS
  launchd LaunchDaemon** (`backend/scripts/com.spicetown.backend.plist`, installed to
  `/Library/LaunchDaemons/`), NOT a LaunchAgent - this machine (`spicetown-server` on Tailscale) is
  meant to run headless/always-on, and LaunchAgents only run in a logged-in GUI session.
  `backend/scripts/setup_persistent.sh` does the one-time install.
- **Network exposure**: `tailscale serve --bg 8000`, private to the owner's tailnet only (deliberate
  choice, reaffirmed explicitly when directly asked to Funnel it - never make this public without
  the user overriding that decision again, explicitly, in so many words).
- **Authentication**: `app/auth.py` (hashing, session create/validate, the `get_current_user` /
  `require_admin` FastAPI dependencies) + `app/routers/auth.py` (login/logout/me/change-password/
  admin user management). Every other router is protected via `APIRouter(..., dependencies=[Depends(
  get_current_user)])` at construction - a new router needs that same dependencies= arg from the
  start, not per-endpoint. Sessions are an opaque token in an HttpOnly+Secure+SameSite=Lax cookie,
  looked up against `user_sessions` (not a JWT) - this makes instant server-side revocation trivial
  (delete the row), used when an admin resets someone's password so a stolen/stale session can't
  keep working. `session_cookie_secure` (config.py) must stay `True` in the real deployment (HTTPS
  via Tailscale serve) - only flip it for local plain-http testing, never in `.env`.
- **Ask Inventory Bot** (`app/services/ask_bot.py`, `app/routers/ask.py`): the app's one external
  paid API dependency - the Claude API (`anthropic` package), via `client.beta.messages.tool_runner`
  with `@beta_tool`-decorated functions wrapping every existing read-only report as a tool. Its API
  key is `ANTHROPIC_API_KEY`, read through `app/config.py`'s `Settings` (NOT bare `os.environ`,
  since this app never calls `load_dotenv()` - see the Phase 5 session note below for why that
  distinction mattered when building it).

## Critical gotchas - read before changing code

1. **The dev machine only has Python 3.9.** `backend/.venv` is built against it. This means `X |
   None` union syntax in type hints is a hard `TypeError` at import time - use
   `typing.Optional[X]` everywhere, not PEP 604 syntax. This bit every single new file early in the
   project until it became a habit.

2. **This session's own Bash tool cannot reach, or be reached by, the real production service.**
   Processes started via Bash here (even bound to `0.0.0.0`, even with sandbox-disable flags) are
   not reachable from the user's actual browser or Tailscale devices, and `sudo` here always fails
   non-interactively (`sudo: a password is required`). Concretely:
   - You CAN read/write the real files (shared filesystem) and run the real `sqlite3` file directly
     - self-testing with a throwaway `uvicorn ... --port 8000` process in the sandbox to hit
     `curl 127.0.0.1:8000` works fine for verifying logic before handing off.
   - You CANNOT restart the live launchd service yourself. After any backend code change, the fix
     is deployed but not live until the user runs, in their own real terminal:
     `sudo launchctl kickstart -k system/com.spicetown.backend`
   - Frontend-only changes (`npm run build`) DON'T need a restart - `StaticFiles` reads from disk
     per-request, so a fresh `dist/` is picked up on next page load automatically. Only Python
     changes need the kickstart.
   - Always verify your own sandboxed test process is killed afterward (`pkill -f "uvicorn
     app.main:app --port 8000"` — note this pattern does NOT match the real service, which runs
     with `--host 0.0.0.0` in its args) so it can't collide with the real one on the same port.

3. **SQLite silently drops timezone info on every read**, even for columns written as UTC-aware
   datetimes. `app/db.py`'s `UTCDateTime` custom type re-attaches UTC on read - **every new
   timestamp column must use `UTCDateTime()` instead of `DateTime(timezone=True)`**, or the
   value will come back naive, get serialized without a `Z`/offset, and browsers will silently
   misinterpret it as local time (this was a real, shipped bug - dashboard times were off by 4-5
   hours until fixed). Frontend timestamps are displayed via `src/format.js`'s
   `formatRestaurantTime()`, explicitly in `America/New_York` regardless of viewer's device
   timezone - don't use bare `.toLocaleString()`.

4. **Toast's Orders API timestamp format** (`"2026-08-23T18:28:45.000+0000"` - no colon in the UTC
   offset) is NOT parseable by `datetime.fromisoformat` on Python 3.9 (or even 3.11 in some cases).
   `app/services/sales_sync.py::_parse_opened_at` uses `strptime(..., "%Y-%m-%dT%H:%M:%S.%f%z")`
   instead. This was a real bug found by testing against live data - `opened_at` was silently
   `None` for every single order until fixed.

5. **Toast's order payload only inlines a `diningOption` GUID, not a name.** Resolving to a human
   name needs a separate Restaurant Config API call - not done, `orders.dining_option` stores the
   raw GUID.

6. **The Toast Retail inventory export has semicolon-separated multi-value fields**: `supplier` and
   `barcode` can each list multiple values for one item (e.g. `"KP Produce;Raja Foods;Sai Florals"`,
   or several valid GTINs for different pack sizes). Any code that filters/validates by supplier or
   barcode must split on `;` first - treating the whole field as one value produces false positives
   (this happened once already: an early barcode-invalid report flagged 324 items, ~220 of which
   were actually fine multi-barcode fields; fixed by splitting first).

7. **The inventory parser only stores an explicit allowlisted column subset** (see `COLUMN_MAP` in
   `app/services/inventory_parser.py`), matched by lowercased header name, not position. Adding a
   new Toast export column to the dashboard means adding it to `COLUMN_MAP` (and a migration if it
   needs a new `inventory_snapshots` column) - it will NOT retroactively backfill into
   already-uploaded snapshots; only the next upload picks it up.

8. **The daily sales cron is in-process** (`app/scheduler.py`, APScheduler inside the FastAPI
   process), not OS cron. It scans a rolling window (`SALES_SYNC_BACKFILL_DAYS`, default 14) for
   any date without a *successful* sync and re-syncs it - this also runs once ~10s after every
   service start/restart, so a missed night self-heals on the next scheduled run or the next
   restart, whichever comes first. Sync is idempotent (upsert keyed on Toast's per-selection GUID)
   - safe to re-run/backfill freely.

9. **Real Toast API rate limits exist** (429s were hit during the initial ~4-month historical
   backfill, roughly one per ~25-30 sequential day-requests). Any bulk backfill script should check
   `job_runs` for `status='failed'` afterward and retry those specific dates rather than assuming a
   clean run.

10. **Restaurant identity** (don't re-derive, don't guess): timezone `America/New_York`,
    `firstBusinessDate` 2026-04-01 (per Toast config). Real order volume with actual line items
    doesn't start until **2026-05-26** - a couple of "orders" Toast returns for dates before that
    (e.g. 5-19, 5-24) are empty/voided test orders from onboarding with zero real selections. Don't
    conflate "first date Toast returns an order object for" with "first date something sold" -
    check `parent_selection_guid IS NULL AND voided = 0` line-item rows exist, not just order count.

11. **Selections can nest `modifiers`** (e.g. a spice-level choice, "extra cheese") - each modifier
    is a full selection object with its own guid/price/tax, one level deeper than
    `check.selections[]`. This was silently dropped entirely for months of real history until
    caught by a live reconciliation against Toast (see gotcha #14) - fixed via
    `sales_sync.py::_flatten_selection`, which recurses into `modifiers` and tags each one with
    `parent_selection_guid` pointing at the item it modifies. A modifier row often has `net_price =
    0` (e.g. a free spice-level choice) but not always - some carry real revenue. Any query that
    means "real top-level sold items" needs `WHERE parent_selection_guid IS NULL`; omitting that
    filter double-counts modifiers as if they were separate dishes.

12. **A Toast order's `openedDate`/`businessDate` can reflect a *scheduled fulfillment* time, not
    when the order was actually placed.** A customer can pay in full one evening for pickup the next
    day; Toast files the whole order under the pickup date's `businessDate`, and `openedDate` /
    `promisedDate` / `estimatedFulfillmentDate` all point at the scheduled time - the real
    placement/payment time is in `createdDate`/`paidDate` instead. This means "Items Sold Today" via
    a live pull can legitimately show a sale before the store has even opened that day. Don't assume
    a timestamp on an order means "this is when it happened" without checking which field it is.

13. **`/stock/v1/inventory` is real, live current-stock data** - confirmed by cross-checking it
    against a same-day manual inventory upload: 4,019/4,447 overlapping items matched exactly (the
    rest were float-precision display noise, not real differences), down to matching fractional-pound
    produce weights. It is NOT used anywhere in this app (manual upload is the deliberate design per
    spec) but if that's ever revisited, the data source itself is already validated as trustworthy.
    Only unproven: whether it updates continuously through the day vs. only on recount/receiving
    events (same trigger as the CSV export) - not tested.

14. **A day's stored revenue can differ slightly (sub-1%) from Toast's own check-level totals, and
    that's not a bug.** Reconciled real data once (Aug 23: stored $6,081.01 vs. Toast's own
    check-total sum $6,121.77, a $40.76/0.67% gap) and traced the entire gap to two understood
    causes: an still-`OPEN` (unfinalized) tab with zero itemized selections at sync time, and
    check-level discounts that reduce Toast's official total below the sum of gross per-item prices.
    Per-selection revenue matched Toast's live data exactly when compared the same way (selections +
    modifiers, non-voided) - only the check-level headline number can drift slightly, for
    understood, non-bug reasons. If asked to validate data again, reconcile at the selection level
    first; a small check-level gap alone isn't evidence of a sync problem.

15. **The Purchasing module is confirmed entirely inaccessible, not just `vendors`.** `/purchasing/
    v1/vendors` returns 403 (exists, scope-blocked - confirmed real, not a wrong URL). Guessed
    paths for purchase orders/invoices/receiving under the same `/purchasing/v1/` namespace all
    returned 404. That's inconclusive on its own (could be wrong path names), but combined with the
    confirmed-blocked scope, treat the entire Purchasing & Receiving surface as unreachable with
    current credentials - don't re-guess endpoint names hoping one slips through.

16. **When testing auth from the sandbox, use `curl`, not Python's `httpx`, if the request is plain
    `http://` (no TLS).** The session cookie is marked `Secure` (correct - required in the real
    HTTPS deployment). `curl -b`/`-c` cookie-jar testing does not enforce the `Secure` attribute and
    will send the cookie back over plain http anyway, which is what makes sandboxed multi-request
    auth testing possible at all; `httpx`'s cookie jar correctly refuses to send a `Secure` cookie
    over plain http, so a second request in the same `httpx.Client()` session will silently 401 even
    right after a successful login. That's httpx being correct, not a bug in the app - just don't
    mistake it for one.

17. **`forecast.py`/`reorder.py`/`supplier_projection.py` all build on `Order.item_guid` grouping,
    and none of them originally excluded modifier lines** (gotcha #11) - when the modifier fix
    shipped, this file wasn't touched, so for a while ~4% of "items" in the demand forecast were
    actually modifier selections (spice levels, sauces, add-ons) double-counted as if they were
    independently reorderable menu items. Fixed by adding `Order.parent_selection_guid.is_(None)`
    to `forecast_daily_demand`'s query. The visible UI impact was near-zero (`reorder.py` and
    `supplier_projection.py` both join against `inventory_snapshots`, which modifiers mostly don't
    have a row in, so they were filtered out downstream anyway) - but the underlying forecast data
    was still wrong before the fix, just not wrong in a way that happened to show up in those two
    call sites. **The general lesson**: when a shared field's meaning changes (here: `orders` rows
    stopped meaning "one row = one sold item" once modifiers became their own rows), grep every
    consumer of that table/field, not just the one you were actively working on - "it looks fine
    downstream" isn't the same as "it's actually correct."

18. **Any custom-styled `<button>` needs `:not(:disabled)` in its own `:hover` selector, always -
    `index.css`'s global `button:hover:not(:disabled) { background: var(--accent-hover); }` (solid
    red) has HIGHER specificity than a bare `.classname:hover` override, so without matching it the
    button silently flashes red on hover no matter what color the override declares.** First found
    and explained in depth in "Session: the red-hover fix wasn't actually a fix" below - then
    reintroduced three more times in the very next feature built (Phase 5's `.ask-bot-example`,
    `.chat-widget-toggle`, `.chat-widget-close`, all shipped without `:not(:disabled)` and caught
    only when the user spotted the same red flash again). That recurrence is exactly why this is
    promoted to the numbered list instead of staying a narrative session note - a lesson that isn't
    part of the checklist actually consulted before writing new CSS doesn't reliably get applied.
    **Before shipping any new custom button hover style in this app, add `:not(:disabled)` to the
    selector as a reflex, not an afterthought.**

19. **`GET /menus/v2/menus` fills most of the gap that gotcha #13 left open for replacing the daily
    manual inventory upload with a live API pull** - live-tested directly against the real Toast
    account (not guessed from docs). Findings, per item in the menu tree:
    - `sku` = the UPC/barcode (99%+ populated across ~5,193 retail/produce/fish/halal items).
    - `salesCategory.name` = the category (this store's real per-item category, matches the CSV's
      `category` column in spirit).
    - `price`, `unitOfMeasure` (`LB` vs `NONE`, i.e. weighed vs. each) are both present and correct.
    - `plu` is being **repurposed by this store to store supplier name(s)**, semicolon-separated for
      multi-supplier items (e.g. `"Raja Foods;RBest"`) - 91% populated (4,726/5,193), same messy
      real-world data the CSV's own `supplier` column already has (a few junk values like
      `"ACT_SUP_UPDT"`, `"2234"` exist in both). It is NOT Toast's real PLU concept, don't treat it
      as one.
    - Item `guid` matches `/stock/v1/inventory`'s `guid` directly - cross-checked live: 4,425/4,435
      stock rows (99.8%) have a matching menu item, so quantity (gotcha #13) can be joined to
      name/category/sku/price/supplier from this endpoint with no separate mapping table needed.
    - **Confirmed absent from the full item JSON** (dumped one item's complete key set): no `cost`,
      no margin/profit, no `supplier_item_id`/vendor-SKU, no last-received timestamp. Combined with
      gotcha #15 (Purchasing API fully blocked), **cost and everything derived from it
      (gross_margin, gross_profit, inventory_value) has no confirmed Toast API source at all** - the
      manual CSV would remain the only source for those fields even if quantity/name/category/
      barcode/price/supplier all moved to a live API pull.
    - `last_7/30/90_day_sales/orders` (CSV columns) don't need a Toast source either way - this app
      already ingests full order/line-item history itself (`sales_sync.py`), so those would be
      *computed* internally rather than read from Toast, and would actually be more current than the
      CSV's own report-time snapshot of them.
    - Still unresolved from gotcha #13: whether `/stock/v1/inventory` updates continuously through
      the day or only on discrete events (recount/receiving) - matters for whether a live pull can
      cleanly replace the CSV's role in `reconciliation.py` (opening vs. closing counts) and
      `delivery_review.py` (day-over-day delta), which currently rely on the upload having captured
      a specific point-in-time state. Would need a same-day polling test (e.g. sample quantity for a
      few known-fast-moving items every 15 min) to confirm before relying on it for those two flows.

20. **Toast's separate "Analytics API" (confirmed real via its actual public docs at
    doc.toasttab.com, not guessed) does NOT close the cost/margin gap from gotcha #19 - don't
    re-suggest it as a fix.** It's a distinct product from the Orders/Menus/Stock API this app
    already uses: base URL `ws-api.toasttab.com/analytics/v1`, requires its own separate credentials
    issued directly by Toast's integrations team (this app's existing client ID/secret can't be
    reused), and requires a "Restaurant Management Suite Pro or higher" subscription tier. Its data
    domains are sales/orders, checks, labor, menus, payouts, and guest payment data only - explicitly
    no inventory, stock, cost, or margin fields. Blindly probing guessed `/analytics/v1/...` paths
    with this app's normal credentials returns `500 {"code":10000,"message":"Unknown error"}` for
    everything (vs. the `404 code:10003` shape real-but-wrong Config paths return) - that 500 shape
    is NOT evidence the endpoint exists or is reachable, it's just what an unrecognized top-level
    path segment happens to return; don't over-read it either way without checking real docs first.

## How to add a new dashboard feature (established pattern)

1. Backend: a function in `app/services/`, a route in `app/routers/` - construct its `APIRouter`
   with `dependencies=[Depends(get_current_user)]` (or `require_admin` for admin-only) from the
   start, matching every existing router; a route without it is silently unauthenticated - then
   register the router in `app/main.py`.
2. Test it directly against the real DB/API from a sandboxed Python shell or throwaway `uvicorn`
   process *before* touching the frontend - this project has repeatedly caught real bugs
   (timestamp parsing, dining option, multi-value fields, modifiers, first-sale-date, revenue
   reconciliation) exactly this way, against real data, not synthetic test fixtures. When testing
   auth-protected endpoints this way, see gotcha #16.
3. Frontend: an `api.js` helper, a component in `src/components/`, wired into a page in `src/pages/`
   (and `src/components/Sidebar.jsx` if it's a new page). Every `api.js` call already sends
   `credentials: "include"` (required for the session cookie) - don't add a fetch call that bypasses
   the shared `request()` helper, or it'll silently lose auth.
4. `npm run build` in `frontend/`, then verify via a throwaway `uvicorn` process that the built
   bundle actually serves and the new endpoint responds correctly through it (not just via `npm run
   dev`, which is a different code path — the relative-vs-absolute `API_BASE` logic in `api.js`
   differs between dev and prod builds).
5. Tell the user the exact command if a backend restart is needed (see gotcha #2) - never claim
   something is "live" without them actually running the restart, since you cannot do it yourself.

## Session: Items Sold payment-date fix, Supplier Projection overhaul, PO export, mobile nav

Shipped together (2026-08-26), all needing a backend restart to go live (frontend-only pieces are
live immediately per gotcha #2's `dist/` note):

- **`orders.paid_at`** (migration 0005): captures Toast's check-level `paidDate` (falling back to
  order-level `paidDate`, then `createdDate`) alongside the existing `business_date`/`opened_at`.
  This directly fixes gotcha #12 - `Items Sold` now buckets by the date a guest actually paid, not
  the scheduled pickup/delivery date Toast files the order under. **Scoped "going forward only" per
  explicit user choice** - already-synced historical rows keep `paid_at = NULL` and fall back to
  `business_date`; only re-synced or newly-synced dates get the real value. Both the live pull
  (`items_sold.py::_items_sold_live`) and the stored-data path fetch/query a 1-day-wider window than
  the target date and then filter precisely by `to_restaurant_date(paid_at)` in Python (not SQL -
  SQLite has no clean timezone conversion), since a payment can land on `business_date - 1` or
  `business_date + 1` relative to its actual paid date.
- **`inventory_snapshots.supplier_item_id`** (migration 0006): the vendor's own SKU, for PO exports
  - our own `item_id` means nothing to a vendor. **The real Toast export column name for this was
    never confirmed** (no raw export file was available to inspect - only already-parsed DB dumps).
    `inventory_parser.py::COLUMN_MAP` maps every plausible header text guessed (`"supplier item id"`,
    `"vendor sku"`, `"vendor item #"`, etc.) to this field, and the upload router now writes
    `columns_ignored` into `job_runs.detail` on every upload - **check that after the next real
    upload** to see the actual ignored header text if none of the guesses matched, then add the real
    one to `COLUMN_MAP`. Like `supplier`, this can be semicolon-separated in parallel order across
    multiple vendors for one item - `supplier_projection.py::_supplier_item_id_for` picks the entry
    at the matching index.
- **Supplier Projection** (`SupplierProjection.jsx` + `ordering.py`): the lookback-days number input
  became a From/To calendar range (`GET .../supplier-projection?start=&end=` - `lookback_days` is
  still accepted for back-compat but deprecated). Added an `avg_weekly_demand` field alongside
  `avg_daily_demand`; clicking either in the UI expands a per-item weekly sales breakdown fetched
  on-demand from a new endpoint (`GET .../item-weekly-sales`, backed by
  `services/weekly_sales.py`) - not precomputed for the whole list, only for the row you expand.
  Row checkboxes + a column picker feed a new **PO draft PDF export**
  (`POST .../supplier-projection/export-pdf`, `services/po_export.py`, reportlab - already a
  dependency via `export.py`) with a professionally styled landscape table, wrapped/right-aligned
  cells (plain strings in a reportlab `Table` do NOT wrap and will overflow their column - use
  `Paragraph` cells for anything that might be long, as done here), and an always-blank "Qty to
  Order" column for hand-filling before sending to the vendor. This is **not a real Toast PO** -
  still no Purchasing API access (gotcha #15) - just a document for a human to review and send.
- **Inventory upload progress**: `fetch()` has no reliable cross-browser upload-progress event, so
  `api.js::uploadInventoryWithProgress` uses `XMLHttpRequest` instead of the shared `request()`
  helper (mirrors its cookie/401/error-shape handling by hand). The UI shows real byte-progress
  while uploading, then an indeterminate "Processing…" bar between 100% upload and the response
  actually coming back, since parsing/upserting thousands of inventory rows server-side takes a
  few real seconds after the bytes are already fully sent.
- **Missed upload days are harmless, confirmed by re-reading the actual code** (not just asserted):
  `latest_inventory_by_item` always takes `MAX(snapshot_date)` per item, so a gap (e.g. uploaded
  June 1, then not again until June 5) just means every on-hand/reorder/projection figure quietly
  uses the June 1 snapshot until June 5's upload lands - no error, no crash, no data loss, just
  staleness for the gap days. `price_history.py` compares *consecutive uploads*, not consecutive
  calendar days, so the June 1 -> June 5 price diff (if any) is correctly attributed as one change,
  just without knowing which of the 4 gap days it happened on.
- **Mobile nav**: the sidebar was a fixed 220px column with no collapse - unusable on a phone
  (idle it alone ate ~60% of a typical phone viewport). `Sidebar.jsx` now renders a hamburger toggle
  (CSS-hidden above 768px) that slides the nav in as a fixed-position overlay drawer with a
  click-to-close backdrop; `index.css` has a `@media (max-width: 768px)` block covering the drawer,
  card/table padding, and stacking form controls to full width. **Not visually verified in an actual
  browser** - Claude in Chrome was declined this session - only confirmed via `npm run build`
  succeeding and the built bundle serving real 200s through a throwaway `uvicorn`. Worth an actual
  phone/responsive-mode check before assuming it's polished.

## Session: InfoBlock + Help page, supplier_item_id backfill

- **`supplier_item_id` confirmed and backfilled** (2026-08-26): the real Toast export header is
  exactly `"supplier item id"` (was already covered by the candidate-header guess list, so no
  parser change was needed - it just needed the backend restart to actually pick it up). Once a
  real upload captured it (2,446 items, including correct multi-vendor semicolon-index alignment,
  e.g. "Cilantro Bunch" with 3 suppliers -> 3 separate vendor SKUs in the same order), the two
  prior snapshot dates (Aug 24/25, which predate the column existing) were backfilled by copying
  each item's real captured value backward onto its own earlier rows where `supplier_item_id` was
  NULL - not fabricated, since a vendor SKU is a stable per-item attribute, not something that
  varies snapshot to snapshot the way price/quantity does. 4,889 rows updated, nothing else touched.
  This is the general pattern to reuse if a similarly-stable field ever needs the same treatment.
- **`InfoBlock.jsx`** (`components/InfoBlock.jsx`): every tab's long descriptive paragraph became a
  one-line summary + a "? More" toggle that expands the full explanation inline - use this for any
  new tab's intro text instead of a bare `<p className="muted">` paragraph, to keep pages from
  reading as a wall of text by default.
- **Help page** (`pages/HelpPage.jsx`, route `/help`, sidebar nav item added): one page with a
  `<details>` accordion section per tab, written for the store owner, not a developer - what each
  tab does, how its numbers are calculated, and current limitations. Update this whenever a tab's
  behavior changes materially, same as the README - it's the one place meant to have the *complete*
  plain-language explanation, since in-page `InfoBlock`s stay intentionally shorter.

## Session: tab renames, Inventory Reports merge, dash cleanup

- **Sidebar/page renames** (2026-08-26): "Items Sold" -> "Items Sold Today" (still supports any
  past date via its date picker - the name just reflects the default/primary use); "Reorder
  Candidates" -> "Reorder Candidates (All Suppliers)" (to distinguish it from Supplier Projection,
  which is the per-vendor version); "Price Changes" and "Barcode Reports" were merged into one tab,
  **Inventory Reports** (`components/InventoryReports.jsx`, `pages/InventoryReportsPage.jsx`,
  route `/inventory-reports`), with three report options to pick from (missing barcodes, invalid
  barcodes, price change log incl. the per-item search). The old `BarcodeReports.jsx`/
  `PriceChanges.jsx` components and their page wrappers were deleted, not kept around - `App.jsx`
  keeps `/price-changes` and `/barcode-reports` as `<Navigate>` redirects to `/inventory-reports`
  so a stale bookmark doesn't just 404. A new `services/csv_util.py::rows_to_csv` replaced the
  duplicated private `_to_csv` helpers that used to live separately in `routers/reports.py`, and
  backs a new `/api/inventory/price-changes/export` endpoint so the price change log has a CSV
  download too, matching the other two reports.
- **No em dashes anywhere in the app, by explicit user preference** - this applies to frontend copy
  AND backend-generated user-facing text (a PDF export title used `&mdash;`, which a plain grep for
  the unicode character won't catch since it's an HTML entity - check for that too, not just the
  literal `—`/`–` characters, when auditing user-facing strings). Use a plain hyphen (`-`) instead,
  keeping whatever spacing already surrounds it. Internal code comments/docstrings are fine either
  way since they're not user-facing.
- **`HashRouter` breaks plain `<a href="#id">` same-page anchors** - the hash IS the route, so
  clicking one tries to navigate to a route matching that id instead of scrolling. The Help page's
  "jump to a section" links use a JS `onClick` + `element.scrollIntoView()` instead (see
  `HelpPage.jsx::jumpTo`) - use the same pattern for any future same-page anchor link.

## Session: table search/sort, gridlines, hover-contrast fix

Every data table across the app (Reorder Candidates, Supplier Projection, all three Inventory
Reports, Items Sold) now shares one pattern - reuse it for any new table instead of building
another one-off:

- **`src/useTableControls.js`**: a hook taking a plain row array + `{ searchKeys, defaultSortKey,
  defaultSortDir }`, returning `{ search, setSearch, sortKey, sortDir, toggleSort, rows }` (filtered
  + sorted). Search is a case-insensitive substring match across whichever field names are passed.
- **`components/SortableTh.jsx`**: a clickable `<th>` with a sort-direction indicator - pass the
  hook's `sortKey`/`sortDir`/`toggleSort` straight through per column.
- Supplier Projection's horizons are dynamic (7/14/21/30 by choice, not fixed columns), so its
  per-horizon `need_to_order` values get flattened onto synthetic `need_<horizon>` fields just for
  the hook's `row[key]` lookup - the original nested `item.projections[h]` object is still what
  actually renders each row (see `SupplierProjection.jsx`'s `flatItems`/`itemsById`). Do this
  flatten-for-sort-only trick for any future table with dynamic/nested columns rather than teaching
  the hook to understand nested paths.
- A table's "select all" checkbox operates on the currently-**visible** (searched/sorted) rows, not
  the full unfiltered set - checking it while a search is active shouldn't silently select
  off-screen items the user can't see.
- **Column gridlines** (`border-right` on every `th`/`td` in `index.css`, last column excluded) and
  an **explicit-contrast row hover** (`tbody tr:hover td { background: #eef4fb; color: var(--text);
  }`, with a separate slightly-deeper-pink variant for `.sp-row-selected:hover`) are both global,
  one shared rule apiece - don't re-add per-component hover/border overrides, every table already
  gets these automatically.

## Session: Supplier Projection - one duration, not four at once

Redesigned per direct user feedback that the old layout was confusing (all 4 horizons shown as
separate columns, AND a *second*, independent horizon picker buried in the PDF column picker for
"suggested quantity" - two different horizon controls that could disagree with each other and with
what the table showed). Now there's exactly one **Projection duration** selector (1wk/2wk/3wk/1mo)
next to a relabeled **Lookback date range** fieldset (the old unlabeled From/To), and it drives
everything - the table's single "Need" column and the PDF's "Suggested Qty" column always match
whatever duration was picked at Generate-projection time. The API already supported this via
`horizons=<csv>` (`GET /api/ordering/supplier-projection`) - the frontend just needed to actually
pass a single value instead of always taking the default all-four. `po_export.py`'s PDF footer was
also trimmed at the user's request down to a two-word line ("Built in-house.") instead of a full
sentence - if asked to change footer/branding copy again, show the exact proposed wording before
touching the file, per their explicit instruction this round.

**Reminder to self**: after any frontend-only edit, `cd frontend && npm run build` before
considering it done - once this session skipped that step and the user reported a "still not
fixed" bug that was actually just a stale `dist/` bundle, not a real code bug. Verifying an API
change with `curl` alone (bypassing the actual frontend) doesn't catch that gap.

## Session: Phase 2 - dead stock/slow-moving + margin report

Two new reports added to the existing Inventory Reports tab (`services/inventory_intelligence.py`,
`GET /api/reports/dead-stock` and `/margin`, plus `/export` CSV variants) - true to the user's own
framing, both are pure queries over fields Toast already computes and hands back in the daily
export (`inventory_days_on_hand`, `gross_margin`, `gross_profit`, `last_90_day_sales`,
`inventory_value`), reusing `reorder.py::latest_inventory_by_item` - no new forecasting, no new
data collection.

- **Dead stock** = on-hand qty > 0 AND zero 90-day sales. **Slow-moving** = on-hand qty > 0, some
  sales, but `inventory_days_on_hand >= 90` (`SLOW_MOVING_DAYS_THRESHOLD`, arbitrary retail rule of
  thumb, not a Toast-defined number - adjust freely). Sorted by `inventory_value` (dollars tied up)
  descending, since that's the actionable number.
- **Margin report** = items with a known `gross_margin` AND `last_90_day_sales > 0` (a low-margin
  item nobody buys isn't costing real money and would already show up in dead stock instead) -
  sorted by `gross_margin` ascending, worst first. Confirmed against real data immediately useful:
  e.g. "Coconut Whole Dry" sells at $1.00, costs $2.36 (-136% margin), with real recurring 90-day
  sales - a genuine, actionable loss-maker, not a hypothetical.
- **Real data anomaly found and left as-is, not silently filtered**: dead stock surfaced two "Fresh
  Roti" items with implausible on-hand quantities (10,000 and 9,993 units) and one with
  `inventory_days_on_hand = 149895` (~410 years) - almost certainly a Toast-side data/unit issue for
  those specific fresh-kitchen items (possibly counting individual pieces vs. packs), not a real
  dashboard bug. Didn't try to detect/suppress this client-side since that would mean silently
  second-guessing Toast's own numbers with no reliable way to tell a genuine outlier from a real
  one - flagged it to the user instead and left the report showing Toast's actual figures as-is.
  If asked to "fix" implausible dead-stock numbers, check with the user whether it's a real Toast
  data problem (fix at the source / exclude that item) before adding filtering logic here.

## Session: the red-hover fix wasn't actually a fix - a real CSS specificity bug

Earlier this session, `.sp-value-link:hover`, `.info-toggle:hover`, and `.help-toc button:hover`
were all "fixed" to a light background instead of red - but they're all real `<button>` elements,
and the generic `button:hover:not(:disabled) { background: var(--accent-hover); }` rule
(`index.css`) has HIGHER specificity than a bare `.classname:hover` rule (the `:not(:disabled)`
pseudo-class adds weight the plain override didn't have) - so the generic red-fill rule kept
winning regardless, and the user kept seeing red hovers that looked "fixed" in the diff but weren't
actually fixed in the browser. `.link-button` (used almost everywhere - Refresh, "choose a
different report", PDF columns toggle, etc.) had never been touched at all and had the exact same
problem, which is why it looked like "red hover, everywhere."

**The fix**: any custom button hover override needs `:not(:disabled)` in its own selector too
(e.g. `.link-button:hover:not(:disabled) { ... }`) to actually outrank the generic rule, not just
declare a color and assume it'll apply. **The lesson**: a CSS "fix" that only changes the value of
a property, without checking whether a higher-specificity rule elsewhere already sets that same
property, can silently do nothing - verify computed styles (or at least re-derive specificity by
hand) instead of assuming a plausible-looking rule took effect. This one shipped "fixed" twice
before actually being fixed.

## Session: Phase 3 - Reconciliation (manual purchase log)

New tab, **Reconciliation** (`components/Reconciliation.jsx`, `pages/ReconciliationPage.jsx`,
route `/reconciliation`). This is the purchased-vs-sold-vs-counted shrinkage/spoilage signal the
original build spec always intended - but gotcha #15 confirms Toast's Purchasing & Receiving API
is inaccessible with current credentials, so there's no automatic "purchased" data source.
User's explicit choice when this was flagged as blocked: **build a manual purchase-log workaround
now** rather than wait for Toast API access.

- **`purchase_log` table** (migration 0007, `PurchaseLogEntry` in models.py): item_id, supplier,
  quantity_received, unit_cost, received_date, notes, logged_by_user_id - a hand-entered receiving
  record. `services/purchase_log.py` is plain CRUD; `POST/GET/DELETE /api/reconciliation/purchases`.
- **`services/reconciliation.py::get_reconciliation`**: `expected_closing = opening_count +
  purchased - sold`, `variance = actual_closing - expected_closing`. Reuses
  `forecast_daily_demand`'s `total_quantity` field directly for "sold" (not the average) instead of
  writing a second sales query, specifically to avoid risking a repeat of the gotcha #17 modifier
  double-counting bug with a slightly-different hand-rolled query. "Opening"/"closing" counts use
  `reorder.py::latest_inventory_by_item`, extended with a new optional `as_of_date` param (backward
  compatible - every existing caller keeps working unchanged) so it can answer "on-hand as of a
  past date" instead of only "on-hand right now".
- **New lightweight endpoint** `GET /api/inventory/items/search?q=` (`reorder.py`'s
  `latest_inventory_by_item`, filtered by name substring, capped at 25) backs the item-picker
  autocomplete in the "log a purchase" form - there was no existing general-purpose item search
  endpoint before this, only report-specific ones.
- **Verified against real data immediately, including a real gotcha caught before it confused the
  user**: reconciling against a date range with no inventory snapshot before it (`start` earlier
  than the earliest upload on file) silently returns 0 results, because `opening_qty` is `None`
  for every item and rows with an unknown opening count are skipped by design (can't reconcile
  without a real count on both ends) - not a bug, but worth remembering given this app's inventory
  history is still shallow (uploads only go back to 2026-08-24 as of this session).
- **Important, load-bearing caveat baked into the UI copy itself** (`InfoBlock` + Help section, not
  just this skill file): with an empty/new purchase log, *every* item that sold anything will show
  as a "variance" simply because nothing's been logged as purchased for it yet - that's expected,
  not a shrinkage finding. The report only becomes a meaningful signal once purchase logging is
  routine. Don't let a user (or a future session) mistake early results for real loss numbers.

## Session: PO Builder two-step flow, projection Custom dates, Reconciliation Demo

Three changes shipped together (2026-08-27), all needing a backend restart:

- **Supplier Projection lookback/duration are now dropdowns with a Custom… option** instead of
  raw date inputs / a fixed 4-option duration dropdown - picking Custom on either reveals a native
  `<input type="date">` (lookback: a start/end pair; projection: a single target date, converted
  to a day count client-side via `Math.round((target - today) / 86400000)`). Duration presets grew
  from 7/14/21/30 to also include 60 and 90 (2/3 months) - `SupplierProjection.jsx::DURATIONS` is
  the single source of truth for both the dropdown options and the `durationLabel()` fallback text.
- **The old "check items -> pick PDF columns -> export" flow on Supplier Projection was fully
  replaced**, not extended, with a two-step flow: checking items and clicking "Build purchase
  order" now navigates (via react-router `state`, not a persisted draft) to a new page,
  `PurchaseOrderBuilder.jsx` (route `/purchase-order`, not in the sidebar - only reachable by
  navigating from Supplier Projection, with a graceful "go back" fallback if state is missing e.g.
  from a direct visit or refresh). That page shows on-hand/SKU/name/projected-need for just the
  selected items with a quantity input per row, and "Download PDF" produces a much simpler
  document than before: only a serial number, supplier code (blank if Toast has none on file),
  item name, and the quantity actually entered - items left blank or at 0 are excluded. The old
  `POExportItem`/`POExportRequest` schemas, `export_po_pdf()`, and the
  `/supplier-projection/export-pdf` route were deleted outright (replaced by
  `SimplePOExportItem`/`SimplePOExportRequest`, `export_simple_po_pdf()`, and
  `/purchase-order/export-pdf`) rather than left as unused dead code alongside the new ones.
- **Reconciliation Demo** (`ReconciliationDemo` component in `Reconciliation.jsx`, `GET
  /api/reconciliation/demo`, `services/reconciliation.py::get_reconciliation_demo`): a real-data
  walkthrough of the reconciliation formula, added because with an empty (or still-thin)
  `purchase_log` the real report tab isn't self-explanatory to a first-time user - every item just
  shows a scary-looking variance. The demo endpoint queries `MIN(snapshot_date)`/
  `MAX(snapshot_date)` on `inventory_snapshots` itself and runs the real `get_reconciliation()`
  over `[earliest + 1 day, latest]` - the *widest window the current upload history actually
  supports* - rather than a hardcoded date range, so it keeps working correctly as more snapshots
  accumulate instead of going stale. It highlights one real item, preferring the largest **positive**
  variance if one exists (physically more on hand than expected - the clearest illustration of "an
  unlogged purchase," e.g. a produce delivery) over the largest-magnitude negative one, since a
  huge negative variance this early is just as likely a miscount/Toast data quirk (see the dead-stock
  anomaly note above) and would be a confusing thing to hold up as the canonical example. The
  frontend then lets the user type a hypothetical "purchased" quantity for that one real item and
  recomputes expected-closing/variance live with plain arithmetic (no extra backend round trip) -
  defaults to whatever value would exactly zero out the real variance, so the payoff is visible
  immediately on load. **General pattern worth reusing**: when a report's usefulness depends on
  data that's genuinely still thin (here, purchase logging habit), prefer a real-data walkthrough
  over a canned/fabricated example - it's more trustworthy and it's just as easy to build once the
  underlying report function already exists, since the demo is really just "call the real function
  with a well-chosen window and annotate one row."

## Session: Phase 4 rejected as spec'd (no real vendor cost data), Delivery Review built instead

The user asked for "Phase 4 - Vendor price comparison" (surfacing when the same item costs more
from the default vendor than an alternative), described as "a light add-on" once vendor cost data
existed from the PO-draft work. **Checked before building anything and the premise didn't hold**:
`inventory_snapshots` has exactly one blended `cost` field per item, not per-vendor; the real
Toast export's full ignored-column list (`job_runs.detail` on the last uploads) has no per-vendor
cost field anywhere; and the PO Builder (Supplier Projection -> build order) never pulled cost at
all, only quantities and SKU. Per-vendor cost only exists via Toast's Purchasing API, confirmed
blocked (gotcha #15). Flagged this to the user with the specific evidence instead of either
building against fabricated numbers or silently building unasked-for manual-entry infrastructure -
**this is the right move whenever a request's stated dependency turns out not to actually exist in
the data; say so with evidence and ask, don't guess or quietly substitute your own scope.** The
user pivoted to a different, real idea instead (see below) rather than pursuing vendor cost.

**Delivery Review** (`services/delivery_review.py`, `GET/POST /api/reconciliation/delivery-
candidates` and `/delivery-confirm`, `DeliveryReview.jsx` + `DeliveryReviewPage.jsx`, route
`/delivery-review`) - built from the user's own proposal to reduce manual purchase-log typing:
check "we received a delivery today" on the inventory upload, pick vendor(s), and let the app
suggest what arrived by diffing today's upload against the previous one.

**A real mathematical trap in the user's original phrasing, caught before building it**: their
first framing was to log the raw day-over-day inventory delta directly as "purchased". Since
`closing = opening + purchased - sold` already, substituting `purchased := closing - opening`
algebraically forces `variance = sold` for every flagged item - a fixed artifact of the formula,
not a real signal, and one that can never catch a genuine delivery-vs-count mismatch (the entire
point of Reconciliation) because "purchased" would be defined FROM the same count it's supposed to
be checked against. Explained this with the algebra before writing any code, and the user's
follow-up answer confirmed the fix: **suggest, don't auto-log** - candidates are shown with an
editable, human-confirmed quantity (`create_purchase_entry` is only ever called from the confirm
endpoint, never from the candidates endpoint), so the report can still catch a real discrepancy if
one exists between what got confirmed and what the count actually says.

- **Candidate criteria**, per the user's explicit boundary conditions: an item counts as a
  candidate for a chosen vendor if (a) it lists that vendor in its `supplier` field (reusing
  `supplier_projection.py::_split_suppliers`/`_supplier_item_id_for` rather than re-deriving the
  semicolon-split logic - see gotcha #6), AND (b) either it's brand new (present in today's
  snapshot, absent from the previous one) or its quantity moved by more than 5 units **in either
  direction** (`QTY_SWING_THRESHOLD = 5`, arbitrary, adjust freely) - a big drop is surfaced too,
  since it's worth a human's attention, but its suggested quantity is clamped to `max(delta, 0)`
  since a negative "purchased" amount makes no sense to pre-fill.
- **"Previous upload" means the second-most-recent DISTINCT `snapshot_date`, not "yesterday"** -
  same self-adjusting pattern as the Reconciliation Demo (gotcha: uploads can skip days), so a gap
  doesn't break the diff, it just diffs against whatever the last real upload actually was.
- **Multi-vendor days**: per the user's explicit choice, the UI is a sequential wizard - pick
  multiple vendors up front on the upload page, then review/confirm one vendor's candidate list at
  a time (`DeliveryReview.jsx`'s `vendorIndex` state), not a single merged list or a per-item
  vendor picker (that was the alternative offered and explicitly not chosen).
- **`.po-builder-actions` renamed to `.review-actions`** (`index.css`) since the exact same
  "space-between action row" pattern is now shared by both `PurchaseOrderBuilder.jsx` and
  `DeliveryReview.jsx` - reuse this class for any future review/wizard-style page's button row
  instead of inventing a new one.
- **Follow-up, same session**: the user explicitly wanted quantity edits to stay unrestricted
  (not capped or blocked) but visibly flagged when they diverge from the file. `DeliveryReview.jsx`
  compares the entered value against `item.suggested_qty` (`Math.abs(entered - suggested) > 0.01`)
  and, on a mismatch, adds a `.qty-mismatch` red border/background to that row's input plus a small
  red caption naming the real `item.delta` from the file - a live "you're overriding the real
  count" indicator, not a hard block. This is the general pattern for "let them do it, but not
  silently" requests: don't validate-and-reject, annotate-and-allow.

## Session: Phase 4 built for real - Vendor Price Comparison, via Delivery Review's captured cost

After the earlier rejection (see "Phase 4 rejected as spec'd" above), the user proposed the actual
fix to the ambiguity problem: instead of trying to attribute `inventory_snapshots.cost` (one
blended number per item) to one of an item's several listed suppliers, capture cost at the moment
a human explicitly confirms which vendor delivered - i.e. piggyback on Delivery Review, which
already asks "which vendor?" **This closes the exact gap that blocked Phase 4 the first time**:
`purchase_log` entries name one specific vendor, so their `unit_cost` is unambiguous in a way
`inventory_snapshots.cost` alone never could be.

- **`delivery_review.py::confirm_delivery`** now looks up each item's real `cost` from that day's
  `inventory_snapshots` row (server-side, by `item_id` + `received_date` - never trusted from the
  client, same pattern as the suggested quantity) and stores it as `purchase_log.unit_cost`,
  tagged to the vendor just confirmed. `get_delivery_candidates` also now returns `cost` per
  candidate so the reviewer can see what's about to be captured before confirming (`DeliveryReview.
  jsx` shows it as a new "Cost" column). Verified end-to-end against real data: confirmed a real
  item/vendor, the written `purchase_log.unit_cost` matched that day's real snapshot cost exactly.
- **`services/vendor_cost.py::get_vendor_price_comparison`**: groups `purchase_log` entries
  (`unit_cost IS NOT NULL AND supplier IS NOT NULL`) by `item_id`; for any item with entries from
  2+ distinct vendors, compares the *most recent* entry (by `received_date`, tie-broken by `id`)
  against the *cheapest* entry from a *different* vendor - flags it only if the current vendor
  costs strictly more. Also picks up manually-logged purchases with a hand-entered cost, not just
  Delivery Review confirmations - any real vendor-tagged cost counts. New report,
  **Vendor Price Comparison**, added as a 6th option in Inventory Reports (`GET/export
  /api/reports/vendor-price-comparison`) - same `REPORTS` object pattern as the other five in
  `InventoryReports.jsx`.
- **This starts genuinely empty** (`purchase_log` had 0 rows with a cost as of this session) and
  the UI says so explicitly rather than showing the normal "None found - clean" success message -
  added an `emptyIsGood`/`emptyMessage` override per report in `InventoryReports.jsx`'s
  `ReportTable` for this, since an empty *this* report means "no data yet," not "nothing wrong,"
  and conflating the two would be actively misleading this early. **General lesson reinforced
  again**: when a report is genuinely data-thin at launch, say so in the UI rather than let a
  generic "all clear" message imply more confidence than the data supports (same principle as the
  Reconciliation Demo and Phase 3's launch caveat).

## Session: Supplier Projection merges in each item's Container-location duplicate

The user explained a real store pattern: Toast's Retail export sometimes lists an item as two
rows sharing one name - one regular sellable/priced row, and a second row tracking the same
physical item's on-hand count sitting in a different storage location (the user called this a
"CONTAINER menu group"). Supplier Projection's on-hand figure was only ever reading the priced
row, silently ignoring stock the container row already accounts for - understating true on-hand
and overstating "need to order."

- **No column we capture is literally labeled "CONTAINER"** - `category_group` only ever has
  `HALAL MEAT`, `STREET KITCHEN`, `RETAIL`, `PRODUCE`, `FRESH FLOWERS`, `CATERING MENU`,
  `FISH MARKET` in real data. The real Toast column that would name this grouping directly is one
  of the ones still ignored by `inventory_parser.py` (candidates: "storage locations", "item multi
  location id", "output/source inventory group id(s)") - never confirmed against a real file
  since raw uploads aren't retained on disk, only `source_filename`.
- **What was confirmed against real data instead**, before writing any merge logic: of 29 retail
  items sharing an exact name with another row (as of 2026-08-28's snapshot), 26 fit "one priced
  row + one bare row" exactly - the bare row always has `price IS NULL` and an empty `supplier`
  (and, incidentally, all-zero sales, since you can't ring up sales without a price). The other 3
  (Banana Leaves, JH Energy Kick Mushroom Coffee, Farmvilla Atta) have **two real priced rows**
  under the same name - genuinely different products/sizes, not an Each/Container split - and are
  correctly left unmerged by this heuristic.
- **`supplier_projection.py::_container_qty_by_name`**: for every item in the latest snapshot with
  `price IS NULL` and no `supplier`, groups its `inventory_quantity` by `name`; only names with
  exactly one such bare candidate are used (an ambiguous 2+ case isn't a pattern seen in real data,
  so it's left un-merged rather than guessed at). `compute_supplier_projection` adds that qty into
  `on_hand_qty` for the matching priced item and also returns it separately as `container_qty` (
  `None` when nothing merged) so the UI can show its provenance rather than hiding it.
  `SupplierProjection.jsx` renders a small "(+N container)" note next to On hand when
  `container_qty` is present. Verified against real data: Amma Sona Masoori Rice 20lb correctly
  combines 16 (priced row) + 68 (bare row) = 84; Farmvilla Atta (a genuinely-different-product
  false positive risk) correctly stays unmerged at 55 since its second row has a real price.
- **Scope is deliberately narrow**: this only affects Supplier Projection's on-hand number (what
  the user asked for). Other reports (Reorder Candidates, Inventory Reports, Reconciliation) still
  read each row's own `inventory_quantity` unmerged - revisit only if the user asks for the same
  treatment there.

## Session: Delivery Review's suggested qty was undercounting on same-day-sales items

The user caught a real bug by working through a concrete example: cilantro at 100 on hand
yesterday, 400 delivered and 50 sold today. The suggested quantity at the time was just the raw
count diff (`today_qty - prev_qty` = 450-100 = 350), silently 50 short of the real 400 delivered,
because sold quantity was never netted back in.

- **Fix**: `delivery_review.py::get_delivery_candidates` now pulls that item's real sold quantity
  for the snapshot date via `items_sold.py::get_items_sold` (same live-vs-stored dispatch it
  already uses for "today" vs. a past date) and computes `net_change = delta + sold_today`, using
  that (not raw `delta`) both for the >5 swing threshold and for `suggested_qty`. This is just the
  reconciliation formula rearranged (`closing = opening + purchased - sold` → `purchased = delta +
  sold`), so it's the mathematically correct received quantity, not a new assumption.
- **Does this reintroduce the earlier "logging the diff makes variance always equal sold"
  tautology problem?** No - that flaw was specifically from *not* netting sold back in (double-
  counting it, since reconciliation later subtracts sold again). Netting it in here just makes the
  suggestion match reality; it's still purely a *suggestion* a human reviews/edits before
  anything is written (unchanged from the original design), and reconciliation's real signal comes
  from variance accumulating over longer/imperfect windows, not this one suggestion being exact.
- **Verified against real data**: Cilantro Bunch, 2026-08-27 → 2026-08-28, `Raja Foods`: prev_qty
  407, today_qty 653 (delta +246), 67 sold that day per the synced `orders` table → suggested_qty
  313 (246+67), confirmed by direct computation.
- `sold_by_item` keys off `item_guid`/`item_id` matching `InventorySnapshot.item_id` - already an
  established assumption elsewhere in this codebase (`forecast.py` groups demand by
  `Order.item_guid` and `supplier_projection.py` looks it up via inventory `item_id` directly), not
  new territory.
- Frontend (`DeliveryReview.jsx`) now shows a "Sold today" column and the mismatch warning
  references the suggested quantity instead of the raw count change, since suggested_qty is no
  longer just the count diff.

## Session: Phase 5 - Ask Inventory Bot (Claude API, read-only, Haiku/Sonnet routing)

The user's own roadmap defines Phase 5 as "the natural-language query layer... sitting on top of
everything above... deliberately last, since it's most useful once there's real data and real
features to ask questions about." (This corrected an earlier assistant mistake in this same
session - the assistant had wrongly called "Phase 5" the blocked real-PO-drafting work; that's
actually a separate open item within Ordering, not a numbered phase at all.)

**Scope decision, asked explicitly before writing code**: read-only vs. allow-actions. The user
picked read-only. Every tool in `ask_bot.py` wraps an existing report function - none of them
write to the database. This was treated as a hard design constraint, not a suggestion: a
misunderstood or ambiguous question can at worst return a wrong answer, never corrupt real
inventory/purchase data. If the bot is ever allowed to take actions, that's a deliberate,
separate future decision.

- **Model routing** ("Haiku-default/Sonnet-escalation" as the user specified it): rather than
  running the real tool-use loop once on Haiku and re-running the whole thing on Sonnet if it
  struggles (wasteful - the loop would run twice for any escalated question), a cheap Haiku
  classifier call runs first (`_classify_complexity`, `max_tokens=10`) to decide SIMPLE vs COMPLEX,
  then the real tool-use loop runs exactly once, on whichever model was chosen. Defaults to COMPLEX
  (Sonnet) on any classifier failure/ambiguity - costs more but never under-serves a hard question.
  Model IDs: `claude-haiku-4-5` / `claude-sonnet-5` (no date suffix - see the `claude-api` skill's
  current model table, which is authoritative over any date-suffixed ID recalled from training).
- **Fourteen tools**, each a thin wrapper around an existing service function, all closed over one
  request's `db: Session` via a `_build_tools(db)` factory (so `@beta_tool` functions - which the
  SDK inspects for type hints/docstrings to build the JSON schema - don't need `db` as a visible
  parameter): `list_vendors`, `reorder_candidates`, `supplier_projection`, `items_sold`,
  `reconciliation`, `reconciliation_demo`, `dead_stock`, `margin_report`, `missing_barcodes`,
  `invalid_barcodes`, `price_changed_items`, `price_history`, `vendor_price_comparison`,
  `delivery_candidates` (the last one is read-only preview only - it calls
  `get_delivery_candidates`, never `confirm_delivery`). Every tool that can return many rows takes
  optional `search` (substring on name) and `limit` (default 20, max 100 via `_limit()`) so a big
  report doesn't blow the model's context on one call.
- **`ANTHROPIC_API_KEY` goes through `app/config.py`'s `Settings`, not bare `os.environ`** - this
  app never calls `load_dotenv()` anywhere (confirmed via grep before assuming otherwise), so
  pydantic-settings' own `.env` loading only populates the `Settings` object, not the process
  environment the Anthropic SDK's automatic credential resolution reads from. Passing
  `anthropic.Anthropic(api_key=get_settings().anthropic_api_key)` explicitly, matching how every
  other secret in this app already flows (`toast_client_id`, etc.) - a real gap that would have
  silently produced "not configured" errors even with a real key sitting in `.env` if missed.
- **A dedicated `AskBotNotConfigured` exception** (raised in `ask()` when the key is blank) is
  checked *before* calling the Anthropic SDK at all, rather than relying on `anthropic.
  AuthenticationError` from a failed round-trip - faster failure, and a clearer error message
  telling the admin exactly what to do (`app/routers/ask.py` maps it to a 500 with that message).
- **Verified against real data without a real API key**: every tool's underlying function (`.func`
  on the `BetaFunctionTool` the `@beta_tool` decorator produces) was called directly against the
  real database and produced correct real-data output (e.g. `supplier_projection(supplier='Raja
  Foods', search='cilantro')` correctly returned Cilantro Bunch with on_hand 653, matching earlier
  sessions' work on that exact item). The full HTTP path was verified up to the auth gate (401
  confirmed for an unauthenticated request, consistent with every other router) and the
  `AskBotNotConfigured` path (confirmed via direct call). The actual live Claude API call itself
  was never exercised - no real key is available in this environment, and the user was directed to
  add one to `backend/.env` themselves rather than asked to paste a secret into chat.
- **New frontend**: `components/AskBot.jsx` is the actual chat UI (thread + input, sticky-bottom
  input via `position: sticky` within its own bounded-height box). It was first shipped as its own
  sidebar tab/page (`pages/AskBotPage.jsx`, route `/ask`), then the user corrected that in the same
  session - real chat products (their words: "like all other big companies do") put a floating
  bubble in the bottom-right corner of *every* page, not a page you have to navigate to. Rebuilt as
  `components/ChatWidget.jsx`: a fixed-position toggle button + popover panel, rendered once in
  `App.jsx`'s `AppShell` *outside* `<Routes>` (alongside `<Sidebar />`) so it persists across
  navigation - same mount-once pattern the sidebar itself already uses, just newly applied to a
  floating widget. Because it doesn't unmount on route changes, the conversation survives moving
  between tabs. `pages/AskBotPage.jsx` and the `/ask` route were deleted outright (confirmed via
  AskUserQuestion: keep both vs. bubble-only - user chose bubble-only) - `AskBot.jsx` itself needed
  no logic changes, only a CSS adjustment (`height: 100%` filling its container instead of
  `min-height: calc(100vh - 8rem)` assuming a full page) so the same component drops cleanly into
  the widget's fixed-size panel instead. Conversation history sent back to the API on each turn is
  plain `{role, content}` text pairs only (no tool-use blocks replayed) - simpler, and sufficient
  for a Q&A bot's multi-turn UX since the model still has the substance of prior answers even
  without replaying exactly which tool produced them. Each answer displays which model actually ran
  and which tool(s) it checked, so the "show your work" principle established elsewhere in this app
  (Reconciliation Demo, Delivery Review's suggested-qty transparency) extends here too.

## Session: near-miss - Write tool used on api.js by mistake, overwrote the whole file

While starting Phase 6, a `Write` call meant for something else was accidentally issued against
`frontend/src/api.js` with placeholder content, wiping out ~45 real functions (auth, uploads,
ordering, reports, reconciliation, delivery review, ask bot). Caught immediately (the tool result
literally said "the file has been updated"), before any other edit compounded it.

**Recovery, since this is not a git repo (no `git checkout` safety net) and there's no Time
Machine/local snapshot available (`tmutil listlocalsnapshots /` returned nothing)**: the most
recent `frontend/dist/assets/*.js` production build - built and left on disk *before* the
accidental overwrite - still contained the real, correct compiled code. Vite/esbuild's default
minifier renames local variables but leaves every string literal untouched, including every
`/api/...` path, every JSON body key (`lookback_days`, `is_admin`, etc.), and object-shorthand
property names - so the exact original logic was recoverable from the bundle almost like reading
un-minified source. Cross-referenced two ways: (1) grepped every still-intact `.jsx` file's
`import { ... } from "../api"` statements for the *definitive* real function names (a handful,
like `searchItems`, `downloadPurchaseLogSampleCsv`, `uploadPurchaseLogWithProgress`, weren't
guessable from naming conventions alone), and (2) a `grep -n "^export async function"` run earlier
in this same session, before the accident, had already captured ~19 exact original signatures
verbatim - lucky timing, not something to rely on next time. After reconstructing the full file,
verified it against the untouched pre-accident bundle: rebuilt, diffed the compiled API module
byte-for-byte, and confirmed all 41 `/api/...` endpoint paths matched exactly (a handful of
single-letter local variable names differed - a harmless minifier artifact from one function using
separate `const` statements instead of a comma-chain, not a functional difference). One
low-confidence spot: `uploadInventory(file)` - a single-param async wrapper confirmed to have
existed (from the pre-accident grep) but never called anywhere in the shipped bundle (dead code,
tree-shaken out) - its exact original body couldn't be recovered from the bundle since it wasn't
in it; reconstructed as a thin `uploadInventoryWithProgress(file)` delegate, which is safe
regardless of what the real body was, since nothing in the app actually depends on it.

**The lesson**: `Write` requires having read the file, but "the file was read earlier in this
session" is not the same guarantee as "I am about to write the content I intend to write" -
double-check the tool call's actual `content` argument matches the file being targeted,
especially when several files are being edited in a similar timeframe (this happened while
`api.js` had just been discussed alongside several newly-created files). `Edit` (which requires an
`old_string` match against real current content) is structurally safer for touching an existing
file than `Write` ever is - reach for `Write` only for genuinely new files or an intentional full
rewrite, never as a reflex for "add a function to this file." **If this ever happens again and the
project has no git**: check for a very recent `frontend/dist` build first, before assuming data is
gone - a minified bundle is far more recoverable than it looks, especially cross-referenced against
still-intact source files that import from the lost one.

## Session: Phase 6 - Weekly Digest (one Claude call, no tool use, generated on demand)

Straightforward once Phase 5 existed - literally "cheap to build," as the user's own roadmap
predicted. No tool-use loop needed here (unlike Ask Inventory Bot): every underlying number is
gathered directly in Python first (`weekly_digest.py::get_weekly_digest_data`, reusing
`compute_reorder_candidates`, `get_dead_stock`, `get_margin_report`, `get_vendor_price_comparison`,
`get_reconciliation`, `get_missing_barcodes`/`get_invalid_barcodes`, plus a new `_sales_totals`
query following `forecast.py`'s established correct filtering pattern - `voided.is_(False)`,
`parent_selection_guid.is_(None)` - since `export.py`'s own `_fetch_rows` doesn't filter either of
those and would have double-counted/included voided rows), then handed to Claude as one single
`messages.parse()` call with a Pydantic output schema (`WeeklyDigestNarrative`) to turn into prose.
Model is `claude-opus-5` (the `claude-api` skill's actual default), not the Haiku/Sonnet routing
built for Ask Inventory Bot - that routing was specifically what the user asked for on that one
feature, not a house style to carry everywhere; a once-a-week generation has no volume-cost
pressure, so quality wins by default per the skill's own rule ("never downgrade for cost - that's
the user's decision, not yours").

- **Delivery mechanism, asked explicitly before writing code**: in-app only, no email/notification
  send - avoids needing a new email-sending dependency/credentials entirely. Generated by a button
  click (not a scheduled cron job), so a week nobody checks never spends an API call.
- **Refactored to avoid a real duplicate**: both `ask_bot.py` and `weekly_digest.py` need the exact
  same "is `ANTHROPIC_API_KEY` set, construct the client, raise a clear typed exception if not"
  logic - factored into `app/services/anthropic_client.py` (`get_anthropic_client()` +
  `AnthropicNotConfigured`) rather than defining the same exception class twice under the same
  name in two files (which is what happened on the first pass - caught and fixed before shipping).
  `ask_bot.py` and `app/routers/ask.py` were updated to use the shared version too.
- **Frontend**: `WeeklyDigest.jsx`, added as a new card on the Overview tab (matches the existing
  `.grid` of cards pattern - `JobStatusWidget`, `InventoryUpload`, `SalesDownload`). Shows the real
  sales numbers (this week vs. last week, with a computed % delta) alongside Claude's one-sentence
  narrative per section - never just prose alone, consistent with this app's running "show your
  work" principle.

## Session: Location Transfer Log - Container <-> Each movement tracking

Prompted by the user asking for a "Toast can't do this" gap list for operations/stock, then
picking "inter-location transfer log" to build - explicitly unsure how it would even work, which
was the right instinct: this one needed real-data investigation before any code, the same way
Phase 4's original spec did.

- **Investigated before designing anything**: pulled all 26 real Container-split Retail item pairs
  (the same pairing `supplier_projection.py::_container_qty_by_name` already detects) and tracked
  both rows' `inventory_quantity` across the full 5-day snapshot history. **The Container row never
  changed even once, for a single item, across the entire history.** Only the priced/Each row ever
  moved (from ordinary sales). This ruled out the obvious naive design ("Container decreased +
  Each increased = a transfer happened") before writing a line of code - there's no real events to
  detect that signal from, the same category of problem as the original Phase 4 rejection (a
  design built on data that doesn't actually behave the way the spec assumed).
- **Asked the user directly** whether Container is normally recounted when stock moves - genuinely
  a fork in the road (if yes, a diff-based detector might work eventually; if no, there's no signal
  in Toast's data at all). The user's answer effectively said: don't try to auto-detect from data
  diffing - use the same human-confirms pattern as Delivery Review instead (checkbox + a direction
  choice, then review suggested candidates, confirm into a log). That's what got built.
- **The detection signal that ended up working**: not Container's own delta (confirmed unreliable
  above) but the **Each row's net-of-sales swing** - the exact same `delta + sold_today` signal
  Delivery Review already established (`items_sold.py`, reused directly). A positive swing beyond
  the noise threshold suggests stock arrived from somewhere (container_to_store candidate); a
  negative one beyond what sales explain suggests stock left the shelf (store_to_container
  candidate). **Verified against real data**: this correctly caught a real event invisible to any
  Container-delta approach - Maggie Family Pack 560g swung -32 to +2 (net +34, zero sales) while
  its Container row stayed flat at 600 both days, confirming the design reasoning end-to-end.
- **New pieces**: `location_transfers` table (migration 0008, `LocationTransferLogEntry` model,
  separate from `purchase_log` - not a purchase, no vendor/cost) +
  `location_transfer_log.py` (CRUD, mirrors `purchase_log.py`) + `location_transfer.py` (candidate
  detection + confirm, mirrors `delivery_review.py` - reuses `_latest_two_snapshot_dates` and
  `QTY_SWING_THRESHOLD` from there, and `_container_qty_by_name` from `supplier_projection.py`,
  plus a new `_each_item_by_name` helper with the identical "skip ambiguous multi-match names"
  safety rule) + `/api/transfers/*` router + `TransferReview.jsx`/`TransferReviewPage.jsx` (mirrors
  `DeliveryReview.jsx`, simpler - one direction, no per-vendor loop) + a second checkbox on
  `InventoryUpload.jsx` ("Container movement happened today" + direction radio), alongside the
  existing delivery checkbox.
- **Explicitly flagged in the UI copy**: a quantity spike can't be told apart from an unlogged
  delivery from the numbers alone, so the same restock could get double-logged as both a delivery
  and a transfer if a reviewer isn't paying attention - called out directly in `TransferReview.jsx`'s
  InfoBlock and the Help page, rather than silently hoping it doesn't happen.

## Session: PO PDF letterhead - real logo + business contact info

The user asked to swap the PO PDF's logo for the real one at `~/Logos/Copy of LOGO.jpg` (outside
the repo, on their home directory) and add the business address/phone, "formatted neatly like all
the other big players outside do."

- **Never referenced the home-directory path from application code** - copied the logo into the
  repo instead (`backend/app/assets/spice-town-logo.jpg`), matching how `po_export.py` already
  referenced its old icon-only logo from within the repo (`frontend/public/favicon-512.png`). A
  hardcoded path into `/Users/sundar/Logos/...` would break the moment this runs on a different
  machine or that folder moves - the whole point of committing an asset.
  - Read the source file first (a system rule - always read a file before distributing/using it,
    even one already in the user's own home directory) and found it was 900x577 pixels but 8.9MB -
    unusually large for that resolution. Re-saved via PIL at the same dimensions, JPEG quality 90:
    51KB, visually identical. The original 8.9MB version would have made every generated PO PDF
    needlessly heavy to email to a vendor.
  - The source logo already has the full "Spice Town" wordmark + tagline baked into the image
    (unlike `favicon-512.png`, which is icon-only) - so the redesigned header no longer needs a
    separate "Spice Town" text label next to it.
- **Letterhead layout**: classic two-column header (logo top-left; "PURCHASE ORDER" title +
  378 Kelly Road, Vernon, CT 06066 + (860) 237-4280 + supplier + date, right-aligned, top-right) -
  the same pattern real invoice/PO templates use. Business address/phone are also repeated in the
  footer. Verified by actually rendering a real PDF and converting it to a PNG (`sips -s format
  png`, since `pdf2image`/`pdftoppm` aren't installed) to visually confirm the layout, not just
  that the code ran without error.
- **Scope stayed narrow, on purpose**: only `po_export.py`'s PDF changed. The sidebar logo,
  favicon, and every other logo reference in the app were left alone - the user's ask was
  specifically about the PO PDF, not a rebrand.

## Session: Job Status widget - collapsed the ignored-columns wall of text

The Overview page's Job Status card was showing the inventory upload job's full `detail` string
verbatim, including the entire ~48-name ignored-columns list (`inventory.py`'s upload endpoint
builds it into `job_runs.detail` - see gotcha #7/`inventory_parser.py`) - unreadable on a page
meant for a quick glance. That raw text is still the only place the real Toast header names are
visible (needed once, for the `supplier_item_id` column-name gotcha), so it wasn't removed, just
collapsed: `JobStatusWidget.jsx`'s new `JobDetail` component splits on the known
`"Columns ignored (not in COLUMN_MAP): "` marker, shows just the item-count summary plus a
`"N columns ignored (as expected) ?"` toggle (reusing `.info-toggle`, already past gotcha #18's
hover-specificity fix), and only renders the full comma-separated list if expanded. Falls back to
showing `job.detail` unchanged for any job whose detail doesn't contain that marker (e.g. the sales
sync job's own, differently-formatted detail string) - the split is purely a frontend string check,
no backend change, so `job_runs.detail` itself is untouched and still holds the full text.

## Session: PO PDF letterhead - compact follow-up (crop the icon, shrink fonts, drop a footnote)

Immediate follow-up to the letterhead session above. The full logo (900x577, icon + wordmark +
tagline stacked) was too tall to use directly for a compact top-left corner mark - the user said
so explicitly ("you will have to crop it, do not use as is"). Checked the actual pixel content
first (`PIL` + `numpy`, thresholding non-white pixels) rather than guessing crop coordinates:
found a clean gap (zero non-white pixels) at rows 330-349 separating the icon from the wordmark,
and another at rows 500-529 separating the wordmark from the tagline - so the icon alone is rows
0-329, cols 211-691 of the original. Cropped to that box (+8px padding) -> `spice-town-icon.jpg`
(497x334, 11KB). The original full logo (`spice-town-logo.jpg`) was left in `assets/` unused but
harmless, not deleted, in case a full-width banner use ever comes up.

- **The wordmark is now real text** (`brand_name_style`, "Spice Town" in Helvetica-Bold), not part
  of the image - this is what actually made the fonts independently tunable, which is what "adjust
  the font size" needed. Title/business-name fonts dropped from 18-20pt down to 13pt, address/phone
  /supplier/date down to 7.5-8pt - deliberately small, since a letterhead reads as amateurish when
  oversized, not when it's this compact.
- **Removed the "N item(s). Supplier Code is..." explanatory footnote entirely** - the user asked
  directly, no design judgment call needed.
- **Verified the actual header height, not just that the code ran**: rendered a real PDF, converted
  to PNG via `sips -s format png` (612x792px = exact 72dpi, so 1px = 1pt = 1/72in on a letter page),
  then scanned pixel rows for the accent-colored horizontal rule to find exactly where the header
  block ends - landed at y≈78px ≈ 1.08 inches from the top, comfortably under the requested 2-inch
  budget. This is the same "measure the real rendered artifact, don't just trust the code" pattern
  used earlier for the Supplier Projection Container-merge and Delivery Review sold-netting fixes.

## Session: Supplier Projection defaults, need-sorted table, persistent PO cart, manual item add

Four usability changes to Supplier Projection/ordering, all from real usage feedback after using
the feature for a real order ("found real flaws... some changes can make it more user friendly"):

- **Default lookback changed from 1 month to 3 months** (`SupplierProjection.jsx`'s initial
  `lookbackPreset`/`startDate` state) - the 3-month preset already existed, just wasn't the
  default.
- **Supplier Projection's table now defaults to sorting by "Need" descending** (most-needed items
  on top), via `useTableControls`'s existing `defaultSortKey`/`defaultSortDir` options - previously
  unsorted (API order) despite the Help page already (incorrectly) claiming this behavior existed.
- **The old one-shot "check items -> Build purchase order -> download PDF" flow was replaced with a
  persistent, shared, multi-supplier cart** (`CartItem` model, migration 0009, `po_cart_items`
  table, `services/po_cart.py`, `/api/ordering/cart*` routes, `PurchaseOrderCart.jsx` replacing the
  deleted `PurchaseOrderBuilder.jsx`). Checking items on Supplier Projection and clicking "Add to
  cart" no longer navigates away - it posts to the cart (pre-filled qty = projected need, rounded)
  and the user can keep browsing, switch suppliers, or come back another day. The old router-state
  based hand-off (`navigate("/purchase-order", { state: {...} })`) is gone entirely - the cart page
  is now a real sidebar tab (`/purchase-order`, "Purchase Order Cart") since it's no longer only
  reachable via one specific navigation. Re-adding an item that's already in a supplier's cart
  (matched by `item_id`) updates its quantity rather than duplicating a row; a hand-added item
  (`item_id IS NULL`) always inserts a new row, since name alone isn't a reliable identity.
  Quantity edits on the cart page save via `PATCH` on every change (optimistic local update first,
  so typing doesn't fight a full refetch). PDF export is per-supplier and unchanged in its own
  logic (`export_simple_po_pdf`) - it just now reads from the cart instead of router state, and
  doesn't clear the cart afterward (a human clears a supplier's section explicitly once the real
  order's actually been placed - "just a document," same principle as the original PO PDF design).
- **"Add an item not in inventory" directly on the cart page** (`AddItemForm` inside
  `PurchaseOrderCart.jsx`): a small form (supplier, item name, optional SKU, qty) that posts
  straight into the shared cart with `item_id: null` - the real fix for "sometimes we order new
  items which are not in the inventory," since those items have no Toast row to project demand
  from in the first place.

**A real, non-obvious debugging detour worth remembering**: right after adding `CartItem` to
`models.py`, calling the new service function threw `sqlite3.OperationalError: no such column:
po_cart_items.logged_by_user_id` - a column name that was never written anywhere in the intended
class body. This looked exactly like a bizarre SQLAlchemy/Python 3.9 declarative bug (and a long
bisection chased that theory hard: reordering classes, renaming columns, testing minimal repros,
even suspecting a source-line-number caching quirk) before the real cause turned up: **the
original `Edit` call's `new_string` had accidentally duplicated `LocationTransferLogEntry`'s own
trailing two lines (`logged_by_user_id`/`created_at`) onto the end of the new `CartItem` class
body** - a plain copy-paste error while both classes' similarly-shaped audit-column lines were in
view, not a framework bug at all. It went unnoticed because the verification `Read` right after the
edit used a line-limited window that happened to cut off exactly before those stray lines, so the
duplication was never actually seen. **The lesson**: after adding a new SQLAlchemy model class
(or any class near others with similarly-named trailing fields), read the *entire* new class body
back with no offset/limit truncation before trusting it - a partial-window verification can miss
exactly this kind of trailing duplication, and the resulting runtime error (a real column name
that exists elsewhere in the same file) is genuinely confusing enough to send you chasing a
framework bug that isn't there. `t.columns` / `Base.metadata.tables[name]` inspection (comparing
actual mapped columns against the intended field list) is also a fast, decisive way to check a new
model's shape directly, rather than reasoning about it from source alone.

**Immediate follow-up, same session**: the user didn't want "Purchase Order Cart" sitting in the
sidebar nav list alongside the regular pages, and wanted a way to collapse the sidebar entirely.
- `Sidebar.jsx`'s `NAV_ITEMS` no longer includes it. Instead, `CartButton.jsx` is a fixed
  top-right circular button (mirrors `ChatWidget.jsx`'s fixed bottom-right bubble pattern, mounted
  once in `App.jsx` outside `<Routes>` the same way) showing a live item-count badge and navigating
  to `/purchase-order` on click - a persistent cross-page action, not a page you navigate between,
  so it doesn't belong in the nav list at all. The badge count comes from a `window.dispatchEvent(
  new Event("cart:updated"))` fired inside `api.js`'s `addToCart`/`deleteCartItem`/
  `clearSupplierCart` (not `updateCartItemQty`, since that doesn't change the item count) - reusing
  the exact same window-event pattern `request()` already uses for `auth:unauthorized`, so
  `CartButton` just listens for that event to refetch its count without polling.
- **Desktop sidebar collapse** (`Sidebar.jsx`): a new `«` button in the sidebar's brand row
  collapses it to width 0 (not an icon rail - none of the nav items have icons to fall back on) and
  a small fixed `»` tab takes its place to bring it back. The collapsed state is remembered in
  `localStorage` (`spicetown_sidebar_collapsed`) since it's a standing layout preference, not
  per-session. This is entirely independent of, and only active alongside, the existing *mobile*
  hamburger-drawer toggle - both the collapse button and the expand tab are force-hidden under the
  `@media (max-width: 768px)` block, since the mobile drawer's own open/close mechanism already
  covers that case and a second, unrelated collapse concept there would just be confusing.
- **Not visually verified in an actual browser this round either** (see the mobile-nav caveat in
  the earlier session note below) - only confirmed via `npm run build` succeeding and the built
  bundle serving real 200s through a throwaway `uvicorn`, plus grepping the built JS for the new
  class names/strings to confirm they actually made it into the bundle. Worth a real check that the
  fixed-position cart button doesn't visually collide with any page's own top-right content on a
  narrower desktop width, since it floats above content with no reserved space (same tradeoff the
  chat bubble already made).

**Second immediate follow-up, same session**: two real visual bugs in the above, both fixed without
needing a browser to diagnose since the cause was clear from the CSS itself:
- **Cart button was barely visible**: it used `var(--accent)`, the same red already used for every
  primary button, link, and error message in the app - it didn't stand out, it blended in. Gave it
  its own color, `--cart-accent`/`--cart-accent-hover` (a blue, `#2563eb`/`#1d4ed8`), deliberately a
  different hue from the app's red-heavy palette; the item-count badge keeps the red (`--accent`)
  on purpose, since a badge is supposed to grab attention the way the button body now doesn't need
  to.
- **The collapsed-sidebar "expand" button was covering real content**: it was pinned to the exact
  top-left corner (`top: 0.9rem; left: 0.9rem`) - which is also where every page's own heading
  starts once the sidebar's gone, so it sat on top of that text. Moved it to a vertically-centered
  tab on the left edge (`top: 50%; transform: translateY(-50%)`) instead of the corner - a common
  "reopen a collapsed panel" pattern, and one that can't collide with a page title since headings
  are never vertically centered on the page.

**Third immediate follow-up, same session**: the cart button's icon itself wasn't visible at all
(not a color problem this time - the 🛒 emoji glyph just wasn't rendering on the real system this
was checked on, most likely a missing color-emoji glyph in whatever font the browser fell back to).
Replaced it with a plain inline SVG (`CartIcon` in `CartButton.jsx`, `stroke="currentColor"`) - an
SVG path draws identically on every system regardless of font/emoji support, unlike the other
emoji already used elsewhere in this app (💬/✕/☰) which happened to work. **General lesson**: don't
assume an emoji glyph will render just because a similar one already works elsewhere in the app -
color-emoji support varies by specific glyph, OS, and browser font fallback in a way plain Unicode
dingbats (✕, ☰) don't share; an inline SVG has no such dependency and is the safer default for any
new icon-only UI element.

## Session: real revenue bug found and fixed - unpaid orders counted as "sold" early

User report: "Items Sold" totals didn't match Toast's own dashboard. Investigated by reconciling a
fresh live pull of real Toast data against the app's stored total for 2026-08-31 (selection-level,
per the established gotcha #14 method) and found a genuine, verified bug - not just the
already-documented small headline-total gap.

- **Root cause**: `sales_sync.py::_extract_line_items`'s `check_paid_at` fallback chain was `check
  paidDate -> order paidDate -> order createdDate`, unconditionally. The `createdDate` fallback's
  original intent (per its own comment) was "so a comped/voided order still gets a sensible date" -
  but voided rows are already excluded from every revenue total downstream via the `voided` flag
  regardless of what date they land on, so that fallback never actually mattered for voided rows.
  What it *did* affect was a completely different, real case: a genuine, non-voided order that
  simply hasn't been paid yet (confirmed with a real example - a Chicken Shami Kebab order created
  2026-08-31 evening for a 2026-09-01 pickup, `paidDate: null` on both the order and check, not
  voided) - its price was being counted as "sold" on its *creation* date, before the customer had
  actually paid, which is real, uncollected revenue being reported as already earned.
- **Fix**: `check_paid_at` now only falls back to `order_created_at` when the order or check is
  actually `voided`; a real pending/unpaid order is left with `check_paid_at = None`, which the
  already-existing downstream handling in `items_sold.py` correctly treats as "not yet resolvable
  to a date" (excluded from a live "today" pull; falls back to Toast's own `business_date` for a
  stored/past-date query, so it still surfaces once actually synced under whatever day Toast
  eventually files it, but never gets front-run onto an earlier day via `createdDate` again).
- **`Order.paid_at` is only ever consumed by `items_sold.py`** (confirmed via a full-codebase
  grep before changing this) - `forecast.py`, `weekly_sales.py`, `export.py`, and everything else
  windows by `business_date` instead, so this fix has no effect anywhere outside Items Sold (and
  Delivery Review's "sold today" netting, which calls into `items_sold.get_items_sold` directly).
- **Already-synced recent history was corrected too, not left "going forward only" this time**:
  unlike the earlier `paid_at` column migration (which added a brand-new field with no historical
  data to fix), `sync_sales_for_date` is a plain idempotent upsert (gotcha #8) - re-running it for
  the last 10 real days (2026-08-22 through 2026-08-31) safely overwrote the old, buggy `paid_at`
  values with correct ones from a fresh Toast pull. Verified real, meaningful corrections: 2026-08-29
  dropped from $6551.89 to $6251.84 (-$300.05), 2026-08-30 from $6045.55 to $5928.74 (-$116.81) -
  both real dollar amounts that were being over-counted as revenue before it was actually paid.
  2026-08-31 itself didn't change ($3995.32 both times) since its one specific culprit order
  belongs to *tomorrow's* Toast businessDate (2026-09-01), which hasn't synced into the `orders`
  table at all yet (gotcha #8: the nightly cron only syncs yesterday-and-earlier) - it was already
  absent from 8/31's stored total for an unrelated, correct reason, so there was nothing there left
  to fix.
- **If asked to investigate a sales-total mismatch again**: reconcile at the selection level
  against a *fresh* live Toast pull (not just the stored `orders` table) for the specific date in
  question, diff the set of `toast_selection_guid`s between the two, and look at what's genuinely
  different rather than assuming it's the already-documented small headline-total gap (gotcha #14) -
  that gap is real and expected, but it's on the order of <1%, not a good enough explanation for
  every mismatch report on its own.

## Session: PO Cart cost estimate - Case of, Cost of, and a PO total (screen-only, never in the PDF)

Same session as the revenue bug fix above. The user wanted the cart to help estimate what an order
will actually cost, working from case packaging rather than raw units: enter Qty as a case count
(matches the PDF's existing "Qty to order (in Cases)" framing) and a new **Case of** figure (units
per case), and the cart computes total units and a dollar estimate from Toast's own recorded item
cost - explicitly screen-only, never printed on the vendor-facing PDF.

- **`CartItem.case_of`** (migration 0010, `Float`, `server_default="1"` so existing rows default to
  a plain 1-unit case with no backfill needed) - `total_units = qty * case_of`. `POST /cart/items`
  accepts an optional `case_of` (via `CartItemIn`, defaults 1.0); `PATCH /cart/items/{id}` was
  generalized from a qty-only update to `CartItemUpdate` (`qty`/`case_of` both optional) so one
  endpoint handles editing either field.
- **Cost is never stored on the cart row** - `GET /api/ordering/cart` looks it up fresh every time
  from `reorder.py::latest_inventory_by_item(db)`'s `.cost` field (the same real per-item cost
  `vendor_price_comparison`/margin-report already use), matched by `item_id`. A hand-added item
  (`item_id IS NULL`) has no Toast row to look cost up from, so `unit_cost`/`line_cost` come back
  `None` for it - shown as "-" and explicitly excluded (with a visible count) from both the
  per-supplier and grand-total estimate, rather than silently treated as $0.
  `ordering.py::_cart_item_out()` is the one place that builds a `CartItemOut` (computing
  `total_units`/`line_cost` from a row plus an optional looked-up `unit_cost`) - reused by all three
  cart mutation endpoints so their response shape stays consistent with `GET /cart`, even though
  only `GET /cart` actually does the cost lookup (the others pass `unit_cost=None` since the
  frontend doesn't use their response bodies for anything cost-related anyway).
- **The frontend recomputes the visible estimate live from `unit_cost * qty * case_of`** on every
  keystroke (`PurchaseOrderCart.jsx`), rather than waiting on the server's per-request aggregate -
  `unit_cost` itself doesn't change when qty/case_of are edited, so this is cheap and keeps the
  on-screen total in sync with an in-progress edit instead of lagging until the next full refresh.
- **The PDF (`po_export.py::export_simple_po_pdf`, `SimplePOExportItem` schema) was deliberately
  left completely untouched** - `handleDownload` in `PurchaseOrderCart.jsx` still only sends
  `{name, supplier_item_id, qty}` per the user's explicit instruction that cost/estimate (and, by
  extension, case_of) are a cart-side planning aid only, never something to hand the vendor.

## Session: Items Sold Today - a live old-vs-new revenue comparison, for auditing the paid_at fix

Immediate follow-up to the revenue bug fix above - the user wanted to see the size of that fix
directly on the page, not just take the earlier session's numbers on faith.

- **`sales_sync.py::_extract_line_items` gained a `legacy_paid_at_fallback: bool = False` param**:
  when `True`, it reproduces the exact pre-fix behavior (unconditional fallback to `createdDate`).
  The real sync path (`sync_sales_for_date`) never passes it, so nothing about the real fix from
  the earlier session changed - this exists purely so a "what would the old, buggy logic have
  shown" number can be computed on demand for comparison, without a second copy of the whole
  selection-flattening/modifier-recursion logic living in parallel.
- **`items_sold.py::get_items_sold_comparison(target_date)`**: always a fresh *live* pull from
  Toast for `target_date` and its adjacent day on each side (unlike `get_items_sold`, which serves
  a past date from the already-corrected `orders` table) - the stored table only ever has the
  corrected values after a re-sync, so there's nothing to diff against for "old logic" without
  re-fetching raw Toast data both ways. New route `GET /api/sales/items-sold-compare?date=`.
- **`ItemsSold.jsx`** fetches this alongside (not blocking) the main table load, in its own
  loading/error state, since it's slower (3 live Toast fetches every time vs. the normal path,
  which is instant for a stored past date). Renders two stat boxes, "Sold today (old logic)" /
  "Sold today (new logic)", plus one caption line explaining why old is never lower than new.
  **This is explicitly an audit/verification aid tied to one specific dated bug fix, not a
  permanent product feature** - if a future session is asked to remove it (e.g. once the user has
  finished cross-checking against Toast's own dashboard), it's safe to delete `get_items_sold_
  comparison`, the `/items-sold-compare` route, and the two-box block in `ItemsSold.jsx` outright;
  just leave `legacy_paid_at_fallback` alone if anything else ever needs the same before/after
  comparison pattern for a different fix.

## Session: Items Sold Today now matches Toast's dashboard exactly - business_date + check totals

Direct follow-up to the two session notes above (the paid_at revenue bug fix, and the old-vs-new
comparison audit view). The user reported the "new logic" number *still* didn't match Toast's own
dashboard for 2026-08-31, and gave the exact figure they saw there: **$3,720.46**.

- **Root cause of the remaining gap, confirmed with an exact match**: recomputed Toast's own
  check-level total directly (`sum(check.totalAmount) for checks where check.businessDate ==
  2026-08-31, excluding voided`) and got **exactly $3,720.46** - the precise number on Toast's
  dashboard. This proved Toast's own dashboard is bucketed by Toast's `businessDate` field (not
  payment date at all) and sums each check's own official total (already net of discounts), not a
  sum of individual item prices. The app's "new logic" number was still paid_at-bucketed and
  item-price-summed - a real, different, valid definition (better for same-day cash-flow tracking)
  but never going to agree with Toast's own headline figure by construction.
- **Asked the user directly which definition should be the primary figure** (a genuine three-way
  tradeoff: match Toast exactly / keep payment-date logic with Toast's number alongside / flip
  which one is primary) via `AskUserQuestion`, since this reverses an earlier explicit design
  decision (the payment-date fix from a previous session, itself made to fix gotcha #12) rather
  than being a bug fix with one obviously-correct answer. **The user chose to match Toast exactly.**
- **`CheckTotal` model** (migration 0011, `check_totals` table): one row per Toast check -
  `toast_check_guid` (unique), `toast_order_guid`, `business_date`, `total_amount` (Toast's own
  official post-discount check total), `voided`. Separate from `orders` (per-selection/line-item)
  since a check's total isn't a line item - `sales_sync.py::_extract_check_totals`/
  `_upsert_check_totals` populate it alongside `orders` in every `sync_sales_for_date` run (same
  idempotent upsert pattern, keyed on `toast_check_guid`).
- **`items_sold.py` rewritten**: `get_items_sold`'s headline `total_revenue` now comes from
  `CheckTotal` rows summed by `business_date` (matches Toast exactly, by construction) instead of
  summing `Order.net_price`. The per-item table below still uses selection-level net_price (the
  only way to show a per-item breakdown at all) but is now also bucketed by plain `business_date`
  equality (no more paid_at, no more the earlier ±1-day widening) - both the live path (`fetch_
  orders_for_business_date(target_date)`, one fetch, not the old today+tomorrow spillover) and the
  stored path (`WHERE business_date = target_date`, exact) got simpler as a direct result of no
  longer needing to reattribute across days by payment date.
- **The per-item table's own revenue sum can differ slightly from the Revenue figure above it,
  same as Toast's own per-item vs. per-day reports can** (a check-level discount doesn't get spread
  back across its items) - called out explicitly in both `ItemsSold.jsx`'s `InfoBlock` and the
  Help page, per this app's running "flag known limitations instead of leaving a confusing silent
  gap" principle (same pattern as gotcha #14, the Reconciliation Demo, and Phase 3's launch note).
- **The old-vs-new comparison feature from the immediately preceding session note was removed
  outright**, not left alongside: `get_items_sold_comparison`, `/api/sales/items-sold-compare`, the
  two-box UI in `ItemsSold.jsx`, and `_extract_line_items`'s `legacy_paid_at_fallback` param are
  all gone - that comparison existed specifically to audit a mismatch this methodology switch now
  resolves by construction (the app's number *is* Toast's number now), so keeping it around would
  just be unused/confusing scaffolding. That session note itself had already flagged this exact
  removal as safe once the user finished cross-checking, which is effectively what happened here,
  just resolved by switching methodology rather than by the user manually confirming a match.
- **`Order.paid_at` is now completely unused** (nothing left calls `get_items_sold_comparison`
  or reads it) but was deliberately left in place, still populated during every sync - it's a
  real, correctly-computed field (when the guest actually paid) that just isn't what this page's
  headline number uses anymore; removing the column/its sync logic wasn't necessary to fix
  anything and might be useful for a future feature that genuinely wants payment-date granularity
  (e.g. a future cash-flow report) - don't remove it reflexively just because nothing reads it
  today.
- **Re-synced the same 2026-08-22 through 2026-08-31 window again** (third time this session,
  each time for a different real reason: paid_at fix, then this) to backfill `check_totals` for
  those dates too, since `sync_sales_for_date` is the one function that populates both tables
  together - verified 2026-08-31 now returns exactly $3,720.46 through the real stored-data path
  (`get_items_sold`), not just the live recompute used to diagnose it.

## Session: Items Sold Today reverted back to payment-date logic - the Toast-matching detour was undone

Immediate reversal of the session note directly above. After actually seeing the Toast-matching
version in use, the user's real answer was: forget matching Toast's own number exactly, go back to
"pay today for tomorrow's order counts as today" (the original payment-date design), but make the
computation itself unambiguous and clearly explained in the UI - the opacity, not the methodology,
was the real complaint underneath the last few rounds of back-and-forth on this page.

- **`CheckTotal` model, migration 0011, and the `check_totals` table were removed outright** - not
  left dormant. `alembic downgrade` was run against the real DB to drop the table cleanly, the
  migration file was deleted, and `sales_sync.py`'s `_extract_check_totals`/`_upsert_check_totals`
  and their call in `sync_sales_for_date` were reverted. That infrastructure existed for exactly
  one purpose (matching Toast's business-date/check-total methodology) which is no longer what this
  page does - keeping it around unused would just be confusing dead machinery in a real production
  schema, not a reasonable "just in case" hedge.
- **`items_sold.py` is back to payment-date bucketing** (`_items_sold_live`/`_items_sold_stored`,
  effectively restoring the version from immediately after the original paid_at bug fix, before the
  Toast-matching detour) - same real fixed `check_paid_at` logic in `sales_sync.py::
  _extract_line_items` (unaffected by any of this back-and-forth: still only falls back to
  `createdDate` when actually voided, never for a genuinely-pending-unpaid order). The module
  docstring now spells out the exact computation rule in three precise, numbered steps specifically
  because "clearly tell how is that total computed" was the user's explicit ask this round - if
  this page's logic changes again, keep that docstring (and the matching `InfoBlock`/Help page
  copy) as the one authoritative, precise description, not a vague summary.
- **The UI now states outright that this number is this app's own logic and will not always match
  Toast's own dashboard, and explains why** (`ItemsSold.jsx`'s `InfoBlock`, `HelpPage.jsx`'s Items
  Sold Today section) - both rewritten to lead with the exact computation rule and the "pay today
  for tomorrow = counts as today" example, rather than leaving the definition implicit.
- **The general lesson from this whole three-part detour** (payment-date fix -> match-Toast-exactly
  -> back to payment-date): when a user reports a number "doesn't match" some external reference,
  confirm which specific definition they actually want as the source of truth *before* building
  infrastructure for a particular methodology - this session built and then completely tore out a
  whole new table (`check_totals`) chasing an exact-match goal that the user, once they'd actually
  seen it, didn't want after all. The `AskUserQuestion` asked partway through was the right instinct
  (this genuinely was the user's call, not a bug with one correct fix) - it just didn't fully
  surface that "match Toast exactly" might not survive contact with actually using it. If a similar
  "which definition of X" question comes up again, consider prototyping cheaply (e.g. a one-off
  script/manual number, like the original investigation's live recompute) before committing to a
  schema change, so reversing course doesn't mean unwinding real migrations against production data.

## Session: PO Cart UX follow-up - search-first item add, pre-ticked cart membership, qty defaults to 1

User feedback on the PO Cart / Supplier Projection flow shipped in the two sessions above, once
actually used for real:

- **`AddItemForm` (`PurchaseOrderCart.jsx`) now searches that supplier's real inventory first**,
  instead of always being a blank name/SKU/qty box. It reuses the existing `ItemPicker` pattern
  from `Reconciliation.jsx` (`.item-picker`/`.item-picker-results`/`.item-picker-selected` CSS,
  already in `index.css`) rather than inventing new styling. Manual name/SKU entry is now a
  fallback only, surfaced via an "Add it as a new item →" link that appears once a search comes up
  empty - not a parallel option shown by default. This needed a new `supplier` query param on
  `GET /api/inventory/items/search` (`inventory.py`), which filters using
  `supplier_projection.py`'s existing `_split_suppliers`/`_supplier_item_id_for` helpers (already
  cross-imported by `delivery_review.py`, so this is an established pattern, not a new one) so a
  match reflects that vendor's own SKU, not a different vendor's if the item carries several.
- **Supplier Projection now pre-ticks items already sitting in that supplier's cart** when a
  projection is (re-)run, via a new `getCart()` call in `handleRun` cross-referenced against
  `data.items` by `item_id`, plus an "(in cart)" label per row. Re-running a projection used to
  reset selection to empty every time, giving no visual signal of what was already queued -
  now it's obvious at a glance. A `cart:updated` window-event listener keeps this honest if the
  cart changes elsewhere (the cart page, another projection run) while this view stays open.
- **Important interaction consequence of the above**: "Add to cart" now only ever submits ticks
  that are genuinely *new* (not already in `cartItemIds`) - it does NOT resubmit already-in-cart
  items even if they're still ticked. This is deliberate, not an oversight: `po_cart.py::add_items`
  upserts by `item_id` (replaces qty rather than creating a duplicate row), so blindly resubmitting
  every ticked row on every "Add to cart" click would silently overwrite any qty someone had
  already hand-edited on the Purchase Order Cart page back down to whatever this click sends. If
  this pre-tick/resubmit split is ever touched again, keep that exclusion - the qty-clobber bug it
  prevents is real and easy to reintroduce by "simplifying" back to "submit everything ticked."
- **New cart adds from Supplier Projection now always default to qty 1**, not a computed
  "need to order" figure. The projected-need number was being silently used as an initial cart
  quantity with no visible label explaining where it came from, which read as an unexplained
  auto-populated value - the user's own words were "I don't know how they are autopopulated."
  Projected need is still shown in its own dedicated "Need" column for reference; it's just no
  longer smuggled into the cart qty by default. Quantities are meant to be reviewed/adjusted on the
  cart page regardless, so qty 1 (an obviously-a-placeholder default) beats a computed number that
  looks authoritative but wasn't actually reviewed by anyone yet.
- **Reminder**: this session edited `backend/app/routers/inventory.py` (Python) as well as frontend
  files, and `frontend dist/` was rebuilt via `npx vite build` (the real backend serves that `dist`
  directory directly per `main.py`, so the frontend change is live on next page refresh with no
  restart needed) - but the **backend service still needs a restart** (`sudo launchctl kickstart -k
  system/com.spicetown.backend`, run by the user - see gotcha #2) for the new `supplier` query
  param on `/api/inventory/items/search` to actually take effect.

## Session: spicetown-labels migrated from Render onto this same server

A separate sibling project, `~/spicetown-labels` (label printing: staff scan a barcode, print a
price label on the store's Brother QL-810W), was migrated off Render's free tier onto this same
always-on Mac. It's a fully independent Flask app/repo/venv/git remote from spicetown-backend -
mentioned here only because of the one integration point and the shared-machine gotchas below.

- **New Overview card**: `frontend/src/components/LabelPrinting.jsx`, added to `pages/Overview.jsx`,
  is just a styled external link (`.button-link` in `index.css`) to the labels app's own URL -
  `https://spicetown-server.tailcc1217.ts.net:8443/`. No API integration, no shared auth (the
  labels app has no login of its own, by original design - low risk since it's a staff scanning
  tool). If that URL/port ever changes, update `LABELS_APP_URL` in that one file.
- **Why local printing instead of the cloud remote-print-bridge it used on Render**: this Mac is
  confirmed on the same LAN as the physical Brother QL-810W (`Brother_QL_810W` already showed up as
  a configured CUPS printer here before the migration even started) - so `spicetown-labels/.env`
  sets `STL_PRINT_MODE=local` + `STL_PRINT_TRANSPORT=cups`, printing directly via CUPS instead of
  through the GitHub-hosted store tablet bridge. Verified with a real physical test print (CUPS job
  accepted, no errors) before building anything permanent around it.
- **Runs as its own two LaunchDaemons**, separate from `com.spicetown.backend`:
  `com.spicetown.labels` (the Flask app itself, gunicorn, port 8080) and
  `com.spicetown.labels.sync` (a new `scripts/sync_catalog.sh`, `git pull` + `POST /api/refresh`
  every 15 minutes - Render got catalog updates for free via auto-deploy-on-push from the
  `toast-sync.yml` GitHub Action; this Mac needed its own periodic pull since nothing else here
  watches that git remote). Both installed the same way as `com.spicetown.backend`
  (`/Library/LaunchDaemons/`, `UserName sundar`, needs the user's own `sudo`).
- **Exposed on a second Tailscale Funnel port (8443), not a path under this dashboard's domain**:
  reverse-proxying under a subpath (e.g. `/labels`) was considered and rejected - Tailscale serve's
  path-mount doesn't strip the prefix, so the labels app's own relative `/api/...` and static-asset
  URLs would break without real Flask-side `SCRIPT_NAME`/prefix surgery it wasn't built for. A
  second Funnel port keeps it a clean, independent root app; the dashboard just links out to it.
  Public (Funnel, not just tailnet-only `serve`) by the user's explicit choice, matching what Render
  already exposed publicly with no login.
- **Real bug hit and fixed during migration, worth remembering if this ever bites spicetown-backend
  too**: a freshly-written launchd `ProgramArguments` script must have its own execute bit set -
  `scripts/run_gunicorn.sh` was `-rw-r--r--` (no `+x`) in the repo, which launchd execs directly
  (no shell wrapper), so the daemon silently failed with `EX_CONFIG`/empty logs until `chmod +x`.
  Running the same script manually via `bash scripts/foo.sh` masks this exact bug (bash doesn't
  need the target file executable), so it looked fine under every manual test right up until the
  daemon install - **when handing a script to `ProgramArguments`, confirm it's actually executable
  in the repo/filesystem, not just that `bash script.sh` works**.
- **`sudo launchctl kickstart -k <target>` can hang indefinitely when the target job isn't currently
  running** (e.g. sitting in launchd's throttled "penalty box" after a crash loop) - confirmed this
  session over a remote connection (not a Touch ID / SecurityAgent GUI-prompt issue - checked
  `/etc/pam.d/sudo`, no `pam_tid`). The fix that worked: `sudo launchctl bootout system/<label>`
  then `sudo launchctl bootstrap system /Library/LaunchDaemons/<label>.plist` instead - a real
  unload/reload cycle rather than kickstart's kill-then-restart, and it didn't hang. Prefer
  bootout+bootstrap over kickstart -k for any future daemon here that might be in a bad state,
  not just a clean restart of an already-healthy one.
- **A real latent bug in spicetown-labels' own code, fixed while here**: `app/routes/bridge.py`'s
  `_convert_to_raster` (the remote-bridge/`brother_ql` raster path) passed `STL_LABEL_SIZE` straight
  to the `brother_ql` library, which names the 29x62mm DK-1209 label `"62x29"`, not `"29x62"` (the
  app's own internal convention, used correctly everywhere else, e.g. `QL_MEDIA_PX`/CUPS's
  `-o media=` string). Never triggered on Render since it never set a custom label size; this Mac's
  `.env` setting the real `29x62` store label size exposed it via the test suite. Fixed with a
  one-entry alias dict at that one call site rather than renaming the app's own convention. Also
  fixed a real test-isolation gap while here: `spicetown-labels/conftest.py` claimed to isolate
  tests from a local `.env` but only pinned `STL_ENV`, not `STL_LABEL_SIZE`/`STL_CUPS_LP_OPTIONS`/
  etc., so a real production `.env` silently changed test expectations. Neither fix was committed
  to that repo's git history this session (explicit user choice - left as uncommitted local
  changes) - a future session picking up spicetown-labels should check `git status` there before
  assuming its working tree matches `origin/main`.
- **Render is intentionally still live**, running in parallel by the user's explicit choice, to be
  decommissioned only after this local deployment proves itself over real use - don't assume it's
  safe to tear down without checking back in.

## Session: per-user feature/tab access control (admin-granted, including Overview)

The user asked for admin to have full rights and to decide, per non-admin user, which dashboard
tabs they can access - explicitly including Overview, which had never been gateable before (every
logged-in user always landed there).

- **`users.allowed_features`** (migration 0011): a JSON-encoded list of feature keys on the `User`
  row. `app/features.py` holds the canonical `FEATURES` list (11 keys: `overview`, `items_sold`,
  `reorder_candidates`, `supplier_projection`, `purchase_order_cart`, `delivery_review`,
  `transfer_review`, `inventory_reports`, `reconciliation`, `ask_bot`, `help`) plus
  `require_feature(key)`/`require_any_feature(*keys)` FastAPI dependencies. An admin bypasses every
  check unconditionally (`user.is_admin` short-circuits) - the grant list is only ever consulted for
  a non-admin. **Change Password and the Users admin page are deliberately NOT part of this
  grantable list** - change-password must always stay available to every logged-in user (it's not a
  business-data feature), and Users is already a hard `is_admin` boundary, not something to grant
  piecemeal.
- **Existing users were backfilled to the full feature list in the migration itself**, not left at
  the column's own `'[]'` default - both real accounts (`spicetown_admin`, `store`) had unrestricted
  access before this shipped, and silently locking out `store` the moment the migration ran would
  have been a real regression. Only users created *after* this migration start at no access
  (`allowed_features: []`) until an admin explicitly grants some, via the new checklist on the Users
  page's create-user form (or `PATCH /api/auth/users/{id}/features` after the fact).
- **Router-level gating varies by whether a router is single-purpose or shared across pages.**
  `jobs.py`, `digest.py` (whole file -> `overview`, since `JobStatusWidget`/`WeeklyDigest` both live
  there), `ask.py` (-> `ask_bot`), `transfers.py` (-> `transfer_review`), `reports.py` (->
  `inventory_reports`) are gated at the `APIRouter(dependencies=[...])` level, same pattern as the
  existing `Depends(get_current_user)` they replaced. `sales.py`, `ordering.py`, `reconciliation.py`,
  `inventory.py` serve more than one page each, so gating is per-route instead (e.g.
  `sales.py`'s `/items-sold` -> `items_sold` but `/export` -> `overview`, since `SalesDownload` is an
  Overview widget; `reconciliation.py`'s `/delivery-candidates`+`/delivery-confirm` -> `delivery_review`
  but everything else in that file -> `reconciliation`).
- **The purchase-order cart's write endpoints use `require_any_feature("supplier_projection",
  "purchase_order_cart")`, not a single key** - Supplier Projection's own "Add to cart" button
  (`POST /cart/items`, plus the pre-tick `GET /cart` check) needs to keep working for a user who
  only has `supplier_projection`, not the standalone cart page. The **page** `/purchase-order` and
  the floating `CartButton` are still gated on `purchase_order_cart` alone, though - only
  `supplier_projection` doesn't unlock *browsing/editing the full cart*, just using the one button
  embedded in a page they already have access to.
- **Three small cross-cutting helper endpoints were deliberately left ungated** beyond plain login -
  `GET /api/inventory/items/search` (used by Reconciliation's item picker, PO Cart's add-item
  search, and others), `GET /api/ordering/suppliers` (used by both Supplier Projection and the
  Overview upload page's Delivery/Transfer Review vendor picker), and `/api/ordering/forecast`
  (no live frontend caller at all, found via grep). Gating these would mean an ever-growing OR of
  every feature that happens to call them, for endpoints that only return small lookup lists (item
  name/price/SKU, vendor names), not a full report - noted inline in each router with a comment
  explaining the reasoning, so a future session doesn't "fix" this into an unmaintainable OR chain.
- **Frontend**: `src/featureRoutes.js` is the single source of truth mapping each route path to its
  feature key (used by both `Sidebar.jsx`'s nav filtering and `App.jsx`'s `<Protected>` wrapper +
  `firstAccessiblePath()` fallback) - keep it in sync with `app/features.py` by hand, they're
  independent files in independent language runtimes with no shared codegen. A user who can't
  access `/` (Overview) lands on whichever of their granted tabs comes first in that file's order,
  or `NoAccessPage` (`/no-access`) if they have literally none yet. `AuthContext.jsx`'s `hasFeature()`
  drives everything - admin always true, otherwise checks `user.allowed_features` from `/me`.
- **Known limitation, not fixed this session**: a user's sidebar/route access only refreshes on
  their next login or full page load - `/me` is fetched once on mount, not re-polled, so an admin
  revoking a currently-logged-in user's access doesn't instantly change what that browser tab shows
  until it reloads. The backend enforces the real boundary regardless (any API call the revoked
  session makes 403s immediately), so this is a stale-UI gap, not a security gap - worth fixing with
  a periodic re-fetch or a push mechanism if it ever actually bites someone in practice.
- **Verified directly against the real database/API** (this project's established pattern, no test
  suite exists for spicetown-backend) via a throwaway admin session token created straight in a
  Python shell (`create_session()`), a temporary test user created/verified/deleted through the real
  endpoints, and cleaned up afterward via direct `sqlite3` deletes - confirmed 200s on granted
  features, 403s on withheld ones, a `PATCH .../features` grant/revoke taking effect immediately on
  the next request, unknown feature keys 400ing, and a zero-feature user 403ing on everything as
  expected.

## Session: Open Orders tab - live Toast pull, no new table, plus a real Toast order JSON reference

The user asked whether we could show currently-open (not-yet-closed) Toast orders in a new tab, with
date/employee filters and a refresh button. Nothing about Toast's Orders API response shape had ever
actually been inspected in this codebase before (`toast_client.py`'s own docstring says as much) - so
before writing anything, a throwaway script made real live calls against the production Toast account
to check, rather than guessing from generic API docs.

- **A real Toast order object (confirmed live, `GET /orders/v2/ordersBulk?businessDate=...`) has
  everything needed**: `closedDate` (null = still open), `voided`, `deleted`, `openedDate`,
  `approvalStatus`, `numberOfGuests`, `displayNumber`, and a `server` object
  (`{guid, entityType: "RestaurantUser"}`) naming who opened/owns the order - this is the "opened by
  employee" field the user asked about. Each check under `checks[]` has its own `totalAmount`
  (summed for the order's displayed total). None of this was previously read anywhere in
  `sales_sync.py` - the existing sync only ever reads a handful of fields for completed-sale
  reporting.
- **`server.guid` needed a name** - resolved via Toast's Labor API, `GET /labor/v1/employees`
  (confirmed live: real names, e.g. `d5f03748-... -> "Radhakrishna Mamillapalli (RK)"`), using the
  `labor.employees:read` scope this app already had granted but never used until now.
- **No new DB table.** An open order is inherently transient (it becomes a normal `orders` row once
  closed and synced overnight) - storing a snapshot of "currently open" state would just go stale
  between page loads, so `open_orders.py` is a pure live pass-through: every call re-pulls Toast
  fresh. The employee list IS cached in-process for 10 minutes (`_EMPLOYEE_CACHE` in
  `open_orders.py`) since the roster changes rarely and there's no reason to hit the Labor API on
  every single refresh click.
- **Refresh is manual, by design, not a limitation to fix later** - there is no Toast webhook wired
  up anywhere in this codebase (confirmed via a repo-wide grep, zero hits), so "an order closes on
  the POS" is only ever discovered by asking Toast again; the UI's Refresh button IS that ask. An
  order simply stops appearing in the list on the next refresh once its `closedDate` gets set - the
  app never "closes" anything itself.
- **New pieces**: `app/toast_client.py::fetch_employees()` (new Toast API call),
  `app/services/open_orders.py` (`get_open_orders(business_date, employee_guid=None)`,
  `get_employees()`), `app/routers/orders.py` (`GET /api/orders/open`, `GET /api/orders/employees`,
  gated with a new `open_orders` feature key added to `app/features.py`'s `FEATURES` list),
  `components/OpenOrders.jsx` + `pages/OpenOrdersPage.jsx` (route `/open-orders`, added to
  `featureRoutes.js` right after Overview - the sidebar and `firstAccessiblePath` both pick it up
  automatically from that one list, no separate Sidebar edit needed), plus a matching Help page
  section.
- **New feature keys are opt-in, not auto-granted to existing non-admin users** - `open_orders` was
  added to `FEATURES` the same way `transfer_review`/`ask_bot`/etc. were originally introduced, but
  unlike the original per-user-access migration (which explicitly backfilled every existing user to
  full access so the rollout itself wasn't a silent regression), a feature added to an
  already-running system is deliberately left ungranted for any existing non-admin user - consistent
  with "an admin explicitly grants access" being the stated design principle elsewhere in this file.
  An admin needs to check the new "Open Orders" box on the Users page for any non-admin who should
  see it; admins themselves always bypass this via `is_admin`.
- **Verified end-to-end against real live production data**, same pattern as every other feature in
  this project: a throwaway admin session token via `create_session()`, hitting the real endpoints
  through a sandboxed `uvicorn` process serving the real built `dist/`, confirming actual real open
  orders (4 open out of 214 total orders on 2026-09-03, one open nearly 11.5 hours - an
  online-ordering placeholder tab, not a bug) and a real employee name resolution, then deleting the
  throwaway session row afterward.
- Same as always: this needed `npm run build` (done) and needs the real backend restarted
  (`sudo launchctl kickstart -k system/com.spicetown.backend`, or bootout+bootstrap if that hangs -
  see the spicetown-labels session note above) by the user before `/open-orders` is live for real.

**Immediate follow-up, same session**: the user actually wanted "all time" open orders, not just one
date at a time - specifically to catch an order that got left open on the POS days or weeks ago and
would otherwise sit invisible forever (the single-date view only ever shows one day; nobody would
think to page back through months of dates looking for a stuck order).

- **The `orders` table can't answer this on its own** - it's line-item/selection data with no
  `closedDate`/status column at all (see the `Order` model), and the nightly sync only ever looks at
  "yesterday and earlier" business dates, at which point an order is normally assumed closed. A truly
  stuck-open order from weeks ago would already be sitting in `orders` (it has real selections, so it
  syncs and counts toward revenue) with no way to tell from that table that it was never actually
  closed on the POS. The only way to find it is to ask Toast directly, per historical business date.
- **`open_orders.py::get_all_time_open_orders()`** scans every business date from
  `FIRST_REAL_SALES_DATE` (2026-05-26, the confirmed real-sales start per gotcha #10 - scanning
  further back would only waste calls on empty onboarding test dates) through today, one
  `fetch_orders_for_business_date()` call per date (~101 dates as of this session), with retry/backoff
  on Toast's 429 (`_fetch_with_retry`, honors `Retry-After` when Toast sends one - real rate limiting
  is confirmed to exist per gotcha #9) plus a small 0.15s courtesy delay between requests. The
  unfiltered result is cached in-process for 5 minutes (`_ALL_TIME_CACHE`) since the scan itself is
  the expensive part (confirmed ~3.5 minutes wall-clock for the real full scan) - an employee-filter
  change re-uses the cached scan instead of re-scanning, but the UI's own Refresh button always passes
  `force_refresh=True` to genuinely re-scan.
- **New route** `GET /api/orders/open/all-time` (`employee_guid`, `refresh` params), alongside the
  existing single-date `/open`. Frontend: `OpenOrders.jsx` gained an "All-time (scan full history)"
  checkbox that swaps the date picker out for a scanned-range display and adds a Business date column
  to the table; `getAllTimeOpenOrders()` in `api.js`.
- **Verified against real production data by actually running the full scan** (not just a short
  smoke test) - real result: scanned 2026-05-26 through 2026-09-03 in ~3:35, found **6 open orders**,
  two of which are genuinely significant: order #70 (Sai Durga, opened 2026-06-09) still showing open
  **~86 days later** ($90.15), and order #219 (Harshitha Nayana, opened 2026-08-08) still open **~26
  days later** ($59.69) - real orders that were rung in and then, for whatever reason (POS error,
  forgotten tab), never closed on Toast's side. This is exactly the kind of thing the all-time view
  exists to surface and the single-date view structurally cannot - worth mentioning to the user as a
  concrete example of the feature already paying for itself, not just a hypothetical.
- **A quick smoke test of the scan loop/caching/retry logic was run first** with `FIRST_REAL_SALES_DATE`
  temporarily monkeypatched to a 3-day window (not touching the real module constant) before running
  the full ~101-day production scan - the general pattern worth reusing for any future "scan a long
  Toast date range" feature: validate the loop mechanics cheaply on a short window before spending
  real API quota/time on the full historical range.

## Session: Open Orders all-time moved from live scan to a background-refreshed cache, plus line items

Direct follow-up to the two Open Orders session notes above. Two real problems surfaced from actually
using the feature: (1) the live ~3.5-minute all-time scan felt "stuck" in the UI with zero progress
feedback, and the user asked for it to be instant via a background cron instead; (2) they also wanted
each open order's line items shown, not just its total.

- **`OpenOrderCache` model + migration 0012** (`open_order_cache` table): a full-replace snapshot (not
  an append-only log) of currently-open orders - a row missing after a scan means that order is no
  longer open. Holds the same fields the live view already showed (business_date, display_number,
  opened_at, server_guid/name, num_guests, total_amount, num_checks) plus new `line_items_json`
  (`[{name, quantity}, ...]`).
- **Line items reuse `sales_sync.py::_extract_line_items`** (the same modifier-flattening logic the
  regular sales sync already relies on - see gotcha #11) rather than re-deriving selection parsing -
  `open_orders.py::_line_items()` just filters that function's output to non-voided, top-level
  (`parent_selection_guid is None`) rows. This was a deliberate reuse specifically to avoid
  reintroducing the modifier-double-counting bug in a second, independent implementation.
- **Split into a cheap frequent refresh and an expensive rare one**, since only "today" realistically
  changes minute-to-minute - an order stuck open for 26+ days isn't going to close in the next 15
  minutes. `open_orders.py::refresh_open_orders_cache(db, full=bool)`: `full=False` only re-scans
  today's business date (one Toast call, fast) and only deletes/replaces cache rows for today, leaving
  older cached days untouched; `full=True` re-scans the entire history from `FIRST_REAL_SALES_DATE`
  (the only way to notice something newly stuck open on an OLD date) and replaces the whole table.
  Both paths are tracked via the same generic `JobRun` table (`job_name="open_orders_scan"`, now also
  added to `jobs.py`'s `TRACKED_JOBS`, so it shows up in the existing Overview Job Status widget for
  free).
- **`scheduler.py`** gained two new APScheduler jobs, config-driven
  (`open_orders_full_scan_hour/minute`, default 04:15; `open_orders_today_refresh_minutes`, default
  15) plus matching startup-catchup jobs (today-refresh at +15s, full scan at +30s) mirroring the
  existing `run_daily_sales_sync`/`startup_catchup_sync` pattern exactly, so a freshly restarted
  service populates the cache within moments instead of sitting empty for up to 24h.
- **Router**: `GET /api/orders/open/all-time` now ONLY reads `open_order_cache` (`get_cached_open_
  orders`, a plain SELECT) - genuinely instant (~0.04s measured), never touches Toast live anymore.
  A new `POST /api/orders/open/all-time/rescan` is the explicit manual escape hatch (forces a real
  `full=True` scan on demand, still slow) - the frontend's "Rescan now (slow)" button is the only
  thing that calls it; nothing calls it automatically. The single-date `GET /api/orders/open` (used
  for the fast "today" view) is unchanged - still a live one-call pull, and now also returns
  `line_items` per order via the same shared `_normalize_open_order` helper.
- **Frontend**: `OpenOrders.jsx` shows "Cache last refreshed" + the scanned date range when in
  all-time mode, and each row's Items column is the flattened `"{qty}x {name}, ..."` list, truncated
  with an inline "more/less" toggle for long orders rather than a separate expand-fetch (the data's
  already all in the cache row, no on-demand call needed).
- **Verified against real production data end-to-end**, including actually running the real ~2-minute
  full scan (not a shortened smoke test this time, since the whole point was verifying the real
  background job path) directly via `refresh_open_orders_cache(db, full=True)`, then confirming
  `get_cached_open_orders` returns the exact same 6 open orders instantly, with real, sensible line
  items (e.g. order #70's $90.15 total broken into 11 real grocery items summing correctly). Also
  separately verified a `full=False` today-only refresh correctly leaves the two much-older cached
  rows (6/9 and 8/8) untouched while only replacing today's. The migration was applied directly
  against the real `spicetown.db` (not just a throwaway copy) and the real scan populated real cache
  rows in production data during this same verification pass - so unlike a typical feature restart,
  there's no "empty until the next cron tick" gap for the user this time; the cache already has real
  data as of this session, restarting the daemon just makes the endpoints/scheduler active going
  forward.
- **Root cause of the original "all time does not display open orders" report, confirmed from the
  real production log files (`backend/logs/backend.log`/`.error.log`)**: not a bug in the feature at
  all - the backend daemon simply hadn't been restarted since the Open Orders code was added, so
  every `/api/orders/*` request 404'd (visible directly in the access log) while the frontend bundle
  itself loaded fine (dist/ is served straight off disk with no restart needed - gotcha #2). Worth
  remembering as a fast first check any time a brand-new feature "doesn't show anything" right after
  it's built: check the real log file for the actual HTTP status before assuming application logic is
  wrong.

## Session: Mobile app Phase 1 - Capacitor wrap, dual auth, dual builds

The user wants the web dashboard turned into a real installable mobile app (more features planned
on top, e.g. native barcode scanning merged in from spicetown-labels). Decision made directly
(the user's other planning AI - Gemini - wasn't cooperating, so this was reasoned through and
committed to rather than left open): wrap the **existing** React app with **Capacitor** rather than
rewrite in React Native or native Swift/Kotlin - reuses ~95% of already-built, already-verified UI,
ships as a real App Store/Play Store binary (bundled locally, not a live-loaded webview - see
below), and gets native plugin access (camera, push, filesystem/share) via JS.

- **A real, easy-to-miss architecture fact surfaced while investigating this**: this skill's own
  "Network exposure" line (Architecture section above) says tailnet-only `serve`, explicitly never
  Funnel, reaffirmed once already. Live-checking `tailscale funnel status` this session found
  **Funnel is actually ON for both the main backend (root, ->8000) and spicetown-labels (:8443)** -
  a real drift from that documented decision, not something reversed deliberately in any session
  note. Flagged to the user directly rather than silently treated as fine; they're already planning
  to move off Tailscale to a real domain soon regardless, so this wasn't re-litigated further, but a
  future session shouldn't assume the "tailnet-only, never Funneled" line is still accurate without
  checking `tailscale funnel status` again.
- **Domain migration readiness, per explicit user instruction** ("we'll stop using tailscale soon"):
  nothing about the mobile build hardcodes today's Funnel URL in more than one place -
  `frontend/.env.mobile`'s `VITE_API_BASE` is the single value to change before the next mobile
  build/release. Not gitignored (no secret in it, just a public URL) - it's meant to be a visible,
  committed one-line diff in git history when the domain changes.
- **Dual auth, no new table needed**: sessions were already just an opaque token row in
  `user_sessions`, looked up by the token itself as primary key - so the exact same token can be
  delivered two ways instead of needing a separate device-token system. `app/auth.py::
  get_current_user` now accepts the token via the existing cookie OR an `Authorization: Bearer`
  header (`extract_bearer_token()`); `POST /api/auth/mobile-login` (new, `app/routers/auth.py`) does
  the same credential check as `/login` but returns the raw token in the JSON body instead of
  setting a cookie. **Deliberately a separate endpoint, not a change to `/login`'s response** -
  adding `token` to the existing web login response would hand any web-page XSS a JS-readable token
  where today only an httpOnly cookie exists, a real regression to the web app's security model for
  no benefit to it. `logout()` now also accepts the token via header so a mobile client can actually
  revoke its session server-side, not just forget it locally.
- **Verified live, real end-to-end**, same throwaway-user pattern as every other feature in this
  project: mobile-login issuing a real token, that token working as a Bearer header on `/me`, a
  garbage/missing token correctly 401ing, logout actually revoking it (401 after), and the existing
  cookie-based web login completely unaffected (still 200s normally) - all against a real throwaway
  `uvicorn` process, cleaned up after.
- **CORS**: `capacitor://localhost` (iOS) and `http://localhost` (Android's Capacitor default) added
  to `CORS_ORIGINS` in the real `.env` (needs the usual backend restart - gotcha #2). Verified via a
  real CORS preflight (`curl -X OPTIONS` with `Origin` header) that both are allowed and an
  arbitrary untrusted origin is correctly rejected (400).
- **Two separate frontend builds, on purpose - this is the one gotcha most likely to bite a future
  session**: `npm run build` (web, `dist/`, relative `""` API base - correct since the backend
  serves this directory same-origin) vs. `npm run build:mobile` (`vite build --mode mobile && npx
  cap sync`, outputs to `dist-mobile/` per `vite.config.js`'s mode-based `outDir`, loads
  `.env.mobile`'s absolute `VITE_API_BASE`). **These must never share an output directory** - a
  mobile build landing in plain `dist/` would silently ship a hardcoded-today's-domain bundle to
  every web visitor instead of the correct relative-path one, defeating the whole point of the
  split. Confirmed by grepping both built bundles for the literal API host: present (bare, no port)
  only in `dist-mobile/`, absent from `dist/` (which only has the unrelated `:8443` labels-app link,
  a different hardcoded URL entirely - `LABELS_APP_URL`, not the API base). `capacitor.config.json`'s
  `webDir` points at `dist-mobile`, never `dist`.
- **Native file download -> share**: `src/downloadOrShare.js` (new) - web keeps the existing blob +
  `<a download>` click unchanged; native writes the blob to the app's cache dir via
  `@capacitor/filesystem` and hands it to `@capacitor/share`'s OS share sheet instead, since a
  Capacitor WebView doesn't reliably trigger a browser-style download. Every blob-download call site
  in `api.js` (PDF export, CSV report exports, the purchase-log sample CSV) now goes through this
  one shared helper instead of duplicating the platform check three times.
- **`src/mobileAuth.js`** (new): token storage via `@capacitor/preferences`, cached in memory after
  first read (`restoreToken()`, called once by `AuthContext.jsx`'s `refresh()` before its first
  `getMe()` call - without this, a relaunched mobile app would flash "logged out" every time even
  with a valid stored session, since there's no cookie to fall back on there). Preferences-backed
  storage, not a hardened Keychain-only plugin - acceptable for this app's current threat model
  (revocation is instant server-side via the existing session-delete mechanism regardless of where
  the token sits on-device); revisit only if a stricter requirement shows up later.
- **Capacitor scaffold**: `com.spicetown.app` app ID, `ios/` and `android/` platform directories
  added (both committed to git - their own generated `.gitignore`s already cover build
  artifacts/Pods/gradle caches correctly, no hand-editing needed). iOS uses Swift Package Manager
  for Capacitor's own plugins (no CocoaPods dependency, confirmed by `cap add ios`'s own output) -
  this machine has Xcode but not CocoaPods, and it wasn't needed.
- **Real verification, not just "the code looks right"**: built the actual iOS app for the
  simulator (`xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator`, succeeded),
  installed and launched it in a real booted simulator (`xcrun simctl`), and took real screenshots
  confirming the bundled React app actually renders (the real Spice Town login screen, matching the
  web version) inside the native shell - not just that `npm run build`/`cap sync` exited 0. **Not
  verified**: an actual login attempt through the simulator's UI (would need XCUITest/Appium-grade
  automation to type into fields, out of scope for this session's tooling) - the mechanism was
  instead verified in pieces (correct absolute URL baked into the bundle + CORS allowing the exact
  WebView origin + the mobile-login endpoint itself, each confirmed separately). A real live login
  through the actual public Funnel URL also can't be verified from here until the user restarts the
  real backend daemon (gotcha #2) - none of this is live in production yet. Android has no SDK/
  Android Studio on this machine, so only the project scaffold exists there, unbuilt/unverified.
- **Two real, verifiable (not cosmetic-guess) mobile-web bugs fixed in `index.css`'s existing
  `@media (max-width: 768px)` block**: any `input`/`select` under 16px font-size triggers WebKit's
  auto-zoom-on-focus on iOS (was 0.88rem/14px - hit literally every text/date/search field in the
  app); most buttons/inputs fell well under Apple's 44px minimum tappable target. Both are
  deterministic, spec-level facts, not something requiring a device to "see" - fixed directly.
  **Deliberately did NOT attempt a full stacked-card redesign of the dense data tables** (Reorder
  Candidates, Supplier Projection, Inventory Reports, Reconciliation) in this pass - every one of
  them already sits in a `.table-wrap` with `overflow-x: auto` (confirmed via grep - this was
  already correctly in place, not new), so the "page itself scrolls sideways" failure mode doesn't
  exist; a real per-table mobile card layout is a much larger, per-table design project that
  couldn't be visually verified without a device/browser in this session, and was consciously left
  as explicit future scope rather than rushed and shipped unverified.
- **Not yet built**: barcode scanner plugin merge from spicetown-labels, push notifications, the
  TanStack Query/offline-caching layer - these are Phase 2/3 per the plan discussed with the user,
  not started this session.

## Keeping this skill current

This file should be updated whenever a new non-obvious gotcha is found, a new major feature ships,
or the architecture changes (e.g. if Purchasing API scope is ever granted and PO drafting gets
built). Treat it as a living document, not a one-time snapshot.
