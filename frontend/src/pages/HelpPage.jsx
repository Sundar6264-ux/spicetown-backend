const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "open-orders", title: "Open Orders" },
  { id: "items-sold", title: "Items Sold Today" },
  { id: "reorder", title: "Reorder Candidates (All Suppliers)" },
  { id: "supplier-projection", title: "Supplier Projection" },
  { id: "inventory-reports", title: "Inventory Reports" },
  { id: "reconciliation", title: "Reconciliation" },
  { id: "ask", title: "Ask Inventory Bot" },
  { id: "users", title: "Users (admin)" },
  { id: "limitations", title: "What this doesn't do (yet)" },
];

export default function HelpPage() {
  // Plain <a href="#id"> anchors don't work here: this app uses HashRouter,
  // which treats the URL hash as a route, not a same-page anchor - clicking
  // one would try to navigate to a "/overview" route instead of scrolling.
  // Scroll (and open the target <details>) with JS instead.
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div className="page-header">
        <h1>Help</h1>
        <p className="muted">What each tab does, how the numbers are calculated, and how to use them.</p>
      </div>

      <section className="card">
        <p className="muted" style={{ margin: 0 }}>Jump to a section:</p>
        <div className="help-toc">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => jumpTo(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
      </section>

      <details className="help-section" id="overview">
        <summary>Overview</summary>
        <div className="help-section-body">
          <p>
            The daily-operations landing page. Three things live here: sync status, inventory
            upload, and sales export.
          </p>
          <h4>Job status</h4>
          <p>
            Shows the last run of the two automatic/manual background jobs: <strong>Sales sync
            (Toast)</strong> - pulls the prior day's orders from Toast automatically every night,
            and self-heals a missed night on the next run or the next service restart - and
            <strong> Inventory upload</strong> - the last time you uploaded a file below. A green
            pill means it finished successfully, yellow means it's currently running, red means it
            failed (click the detail text for why).
          </p>
          <h4>Upload today's inventory</h4>
          <p>
            Upload Toast Retail's daily "retail items" export (CSV or XLSX), unchanged - don't
            re-save or edit it first, since columns are matched by their exact header text. It gets
            tagged with today's date automatically. You'll see a real upload progress bar, then a
            "Processing…" state while the server parses and saves potentially thousands of rows.
          </p>
          <p>
            <strong>Missing a day is fine.</strong> Every report that uses inventory (Reorder
            Candidates, Supplier Projection, Inventory Reports) always uses the{" "}
            <em>most recent</em> upload on file. If you upload June 1st and then don't upload again
            until June 5th, everything just quietly uses the June 1st numbers in between - no error,
            no data loss, just slightly stale on-hand counts and prices until the next upload lands.
          </p>
          <h4>"We received a delivery today"</h4>
          <p>
            Check this box before uploading and pick the vendor(s) that delivered. After the
            upload finishes, click <strong>Review delivery</strong> to open a page per vendor
            showing items likely from that delivery - anything new to the catalog, plus anything
            whose net change since the previous upload was more than 5 (a big drop is shown too,
            in case it's worth a look, just not pre-filled as a delivery amount). "Net change"
            means the on-hand count change <em>plus</em> whatever sold that same day, so a
            delivery isn't undercounted just because some of it already sold before you uploaded -
            e.g. 100 on hand yesterday, 400 delivered, 50 sold today shows a raw count change of
            only +350, but the suggested quantity correctly shows 400. That suggestion is still
            only a starting point - review and edit it, then <strong>Confirm &amp; log</strong> to
            write it to the purchase log (see Reconciliation below). Nothing is logged
            automatically; you can freely change any quantity, but if what you type doesn't match
            the suggested quantity, the field turns red - a reminder that you're overriding it, not
            a block on doing so. The Cost column shows that day's inventory file cost for each
            item - confirming logs it against the vendor you picked, which is what powers Vendor
            Price Comparison in Inventory Reports.
          </p>
          <h4>"Container movement happened today"</h4>
          <p>
            Some items appear in the daily upload as two rows sharing one name: a regular priced
            row you sell from, and a bare "Container" row tracking stock in a different storage
            location (Supplier Projection already folds that second row's quantity into "on hand" -
            see its section below). Check this box, pick a direction (Container → Store for a
            normal restock, or Store → Container for returning stock to storage), then click{" "}
            <strong>Review transfer</strong> after the upload finishes. Toast's own Container count
            almost never changes on its own between uploads, so the suggestions here come from the
            sellable row's count change instead, netted against that day's sales - the exact same
            signal Delivery Review uses. Because a count change like this can't be told apart from
            an unlogged delivery just from the numbers, double-check you're not logging the same
            event as both a delivery and a transfer. Confirmed transfers are logged to their own
            record, separate from the purchase log.
          </p>
          <h4>Download sales data</h4>
          <p>
            A raw line-item export (every item sold, with price/tax/void status) for a date range,
            as CSV or PDF. This is a plain export, not an analysis - for trends or reorder decisions,
            use the other tabs instead.
          </p>
          <h4>Weekly Digest</h4>
          <p>
            Click <strong>Generate this week's digest</strong> for an auto-generated summary of the
            trailing 7 days - sales vs. last week, top reorder needs, dead stock/margin losers,
            vendor savings opportunities, the biggest reconciliation variances, and barcode data
            quality counts. Every number comes from the same reports listed elsewhere in this Help
            page; Claude only writes the short summary sentence per section, it's never asked to
            compute or estimate a figure. It's generated on demand (not automatically on a
            schedule) and shown here only - nothing is emailed or sent anywhere. Requires{" "}
            <code>ANTHROPIC_API_KEY</code> in <code>backend/.env</code>, same as Ask Inventory Bot.
          </p>
        </div>
      </details>

      <details className="help-section" id="open-orders">
        <summary>Open Orders</summary>
        <div className="help-section-body">
          <p>
            Orders Toast currently has on file for a chosen date (defaults to today) that haven't
            been closed on the POS yet - a live look at what's still open right now, not a stored
            report.
          </p>
          <p>
            <strong>Nothing here is saved by this app.</strong> Every time you load this page or
            hit <em>Refresh</em>, it asks Toast directly for that date's orders and shows whichever
            ones don't have a closed timestamp yet (and aren't voided or deleted). There's no button
            to close an order here - once it's actually closed on the POS, the next refresh simply
            stops showing it.
          </p>
          <p>
            <strong>Date and employee filters:</strong> picking a past date will normally show zero
            results, since every order from a finished day has already been closed by the time you'd
            look. The employee filter matches whoever the POS recorded as running that order
            (Toast's own "server" on the order) - it's who opened/owns the ticket, not necessarily
            who's about to close it.
          </p>
          <p>
            <strong>All-time</strong> shows every open order regardless of date - useful for catching
            an order that got left open for days or weeks and would never show up in the normal
            single-date view unless you happened to pick that exact date. This mode reads instantly
            from a cache this app keeps fresh in the background, not a live Toast pull: today's
            orders are re-checked every 15 minutes, and the full order history (the only way to
            notice something stuck open on an older date) is fully re-swept once a day. If you need
            certainty right this second, <strong>Rescan now</strong> forces a real full re-scan on
            demand - genuinely slow (a minute or more, one Toast request per historical date), which
            is exactly why it isn't what happens automatically on every page load.
          </p>
          <p>
            <strong>Order total and items</strong> shown per row come straight from that order's
            checks and line items on Toast, same underlying data the rest of this app's sales
            reporting uses - each item on its own line, so a full order is readable at a glance.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Two sections: "Needs a look" and "Scheduled for later."</strong> An order that's
            fully paid but still open isn't automatically a problem - Toast charges an online/pickup
            order on placement and only closes it once someone marks it fulfilled, and a guest can
            pay tonight for a pickup scheduled tomorrow. An order only lands in "Scheduled for later"
            if it's paid AND its promised time hasn't arrived yet; the moment that promised time
            passes (or it was never paid to begin with), it moves into "Needs a look" instead - that's
            the section actually worth checking.
          </p>
        </div>
      </details>

      <details className="help-section" id="items-sold">
        <summary>Items Sold Today</summary>
        <div className="help-section-body">
          <p>
            Quantity and revenue sold, per item, for one chosen date - defaults to today, but the
            date picker at the top works for any past date too.
          </p>
          <p>
            <strong>How the total is computed, precisely:</strong> an item counts toward a date if
            it was actually <em>paid for</em> on that date - not whichever date Toast internally
            files the order under. Revenue is the sum of each counted item's own price (after any
            per-item discount, before tax).
          </p>
          <p>
            <strong>Pay today for tomorrow's order = counts as today.</strong> A guest paying
            tonight for a pickup scheduled tomorrow shows up under <em>today</em>, since that's
            when the money actually came in - even though Toast internally files that whole order
            under tomorrow's business date. An order that hasn't actually been paid yet doesn't
            count toward any date until it is.
          </p>
          <p>
            <strong>This is this app's own logic, and it will not always match the number on
            Toast's own dashboard - on purpose.</strong> Toast's dashboard instead groups by the
            calendar day it filed the order under (not payment date) and uses each check's official
            total (which nets out a check-level discount that isn't reflected in the sum of
            individual item prices). Both approaches were checked directly against real data on
            2026-09-01 and both are internally consistent - they just answer a genuinely different
            question ("what did we actually get paid for on this date" vs. "what's Toast's own
            headline total for this business date"). A small, expected gap between the two is not
            a sign of a sync problem.
          </p>
          <p>
            <strong>Today's date is pulled live from Toast</strong> on every load, since the
            overnight sync only ever covers yesterday and earlier - any past date is served from the
            already-synced database instead, which is faster and doesn't re-hit Toast's API.
          </p>
        </div>
      </details>

      <details className="help-section" id="reorder">
        <summary>Reorder Candidates (All Suppliers)</summary>
        <div className="help-section-body">
          <p>
            A flat list, across every supplier at once, of items projected to run out before you'd
            likely be able to restock them - a simple early-warning list, not tied to one vendor.
            For one supplier at a time with a draft PO to send, use Supplier Projection instead.
          </p>
          <h4>How it's calculated</h4>
          <ul>
            <li>
              <strong>Avg/day</strong> - average daily quantity sold over the "Lookback (days)" you
              choose (a simple moving average; it doesn't account for seasonality or trends).
            </li>
            <li>
              <strong>Forecast (lead time)</strong> - Avg/day × the "Vendor lead time (days)" you
              type in (how long it typically takes that item to arrive once ordered - this is a
              manual estimate, not looked up automatically, since Toast's vendor data isn't
              accessible with the current account credentials).
            </li>
            <li>
              <strong>Shortfall</strong> - Forecast (lead time) minus current on-hand. Only items
              with a positive shortfall (projected to actually run short) are listed.
            </li>
          </ul>
          <p>
            Only items with a known on-hand count (present in the latest inventory upload with a
            real quantity) are considered - a prepared kitchen item that's never quantity-tracked in
            the retail export won't falsely show up as "out of stock." Nothing here is sent
            anywhere automatically; it's a read-only list for you to review and act on yourself.
          </p>
        </div>
      </details>

      <details className="help-section" id="supplier-projection">
        <summary>Supplier Projection</summary>
        <div className="help-section-body">
          <p>
            The same idea as Reorder Candidates, but for one supplier at a time, over one
            projection duration you pick - built for actually putting an order together for that
            vendor.
          </p>
          <h4>How to use it</h4>
          <ol>
            <li>Pick a supplier.</li>
            <li>
              <strong>Lookback</strong> - the sales history window used to calculate average
              demand. Pick a preset (1 week, 2 weeks, 1 month, 3 months - 3 months is the default)
              or choose <strong>Custom range…</strong> to pick an exact start and end date from a
              calendar.
            </li>
            <li>
              <strong>Projection duration</strong> - how far out to project. Pick a preset (1
              week, 2 weeks, 3 weeks, 1 month, 2 months, 3 months) or choose{" "}
              <strong>Custom…</strong> to pick a target date from a calendar instead. This drives
              the "Need" column in the table.
            </li>
            <li>
              Click <strong>Generate projection</strong>. Every item that supplier is listed against
              in the latest inventory upload shows up, sorted by how much you'd need to order.
            </li>
            <li>
              <strong>Avg/day</strong> and <strong>Avg/week</strong> are the same underlying
              velocity, just at two scales - click either one to expand the actual week-by-week
              sales it's averaged from, so you're not trusting a single number blind.
            </li>
            <li>
              <strong>Need</strong> - projected demand over the chosen duration minus current
              on-hand. An asterisk (*) means on-hand quantity isn't tracked for that item, so the
              number shown is just projected demand, not netted against stock.
            </li>
            <li>
              <strong>On hand</strong> automatically folds in that item's Container-location count
              when there is one - some items show up in the daily upload as two rows sharing one
              name: a regular priced row, and a second bare row (no price, no supplier) that's just
              the on-hand count sitting in a different storage location. Those are the same
              physical item, so their quantities are added together; a small "(+N container)" note
              next to the number shows how much of it came from that second row.
            </li>
            <li>
              Check the items you actually want to order, then click{" "}
              <strong>Add to cart</strong>. This adds them to a shared{" "}
              <strong>Purchase Order Cart</strong> (its own sidebar tab) at a starting quantity
              equal to the projected need - it doesn't take you anywhere, so you can keep checking
              items from this supplier, switch to another supplier and add more, or come back and
              add to the same cart another day. The cart remembers everything until you remove it.
            </li>
            <li>
              On the Purchase Order Cart page, items are grouped by supplier. Adjust the quantity
              for any item directly there (it saves automatically), remove an item you don't want,
              or use the small form at the top to add an item that isn't in inventory at all -
              useful the first time you order something new. When a supplier's section is ready,
              click <strong>Download PDF</strong> to get the finished order document for just that
              supplier; other suppliers' sections stay in the cart untouched. Any item left at 0 is
              skipped in the PDF but stays in the cart.
            </li>
          </ol>
          <h4>About the exported PDF</h4>
          <p>
            It opens with the real Spice Town letterhead - logo, address, and phone number - then
            a table with just four columns: a serial number, the supplier code, the item name, and
            the quantity you entered.{" "}
            <strong>It is not a real Toast purchase order</strong> - Toast's Purchasing API isn't
            accessible with the current account credentials, so there's no automatic submission to
            the vendor or to Toast; you review it and send it yourself (email, print, whatever
            you'd normally do).
          </p>
          <p>
            <strong>Supplier code</strong> is the vendor's own SKU, sourced straight from your
            daily inventory upload when Toast has it on file for that item/vendor - it's left
            blank on the PDF for items where Toast itself doesn't have it recorded.
          </p>
        </div>
      </details>

      <details className="help-section" id="inventory-reports">
        <summary>Inventory Reports</summary>
        <div className="help-section-body">
          <p>
            One tab, five reports, all checked against your latest inventory upload - pick one from
            the buttons at the top of the page.
          </p>
          <h4>Missing barcodes</h4>
          <p>Items with no barcode on file at all.</p>
          <h4>Invalid barcodes</h4>
          <p>
            Items with a barcode that fails validation - "invalid" means structurally malformed
            (wrong length, or fails the standard UPC-A/EAN-8/EAN-13/GTIN-14 check-digit formula
            every real barcode is built with). This can catch a typo or a truncated/garbled code,
            but it can't confirm a well-formed code is actually the right one registered to that
            product. An item listing several barcodes (common for different pack sizes of the same
            product) only shows up here if at least one of them fails.
          </p>
          <h4>Price change log</h4>
          <p>
            Every item whose price has changed recently, plus a search box to look up one item's
            full price/cost history regardless of whether it ever changed. Both work by comparing
            consecutive inventory uploads for the same item - so this is only as complete as your
            upload history. A single day on file has nothing to compare against yet (correctly
            shows "no changes," not an error). If you skip a few days between uploads, a price
            change in that gap still gets caught - it's just detected on the next upload rather
            than the day it actually happened.
          </p>
          <h4>Dead stock / slow-moving</h4>
          <p>
            Items with real stock on hand that are either <strong>Dead</strong> (zero sales in the
            last 90 days - hasn't sold at all) or <strong>Slow</strong> (selling, but at a pace that
            would take 90+ days to sell through the current on-hand quantity). Sorted by dollars
            tied up, since that's usually the number that decides whether it's worth acting on. Both
            figures come straight from Toast's own daily export (days on hand, 90-day sales) - not
            recalculated here.
          </p>
          <h4>Margin report</h4>
          <p>
            Items that actually sell (90-day sales &gt; 0) with the worst gross margin, worst first
            - a low-margin item nobody buys wouldn't cost you anything real, so it's excluded here
            (it would show up in Dead Stock / Slow-Moving instead if it's not selling at all). A
            negative margin means you're losing money on every sale of that item at its current
            price - worth a second look regardless of how small the item seems.
          </p>
          <h4>Vendor price comparison</h4>
          <p>
            Flags an item where the vendor you most recently bought it from costs more than a
            different vendor already on file for that same item - the vendor you'd likely save
            money switching back to, shown alongside how much per unit.
          </p>
          <p>
            This one works differently from the other five. The daily inventory file's{" "}
            <code>cost</code> field is a single blended number per item, and an item commonly lists
            several possible suppliers at once - there's no way to tell which of them that cost
            actually belongs to, so it can't be used to compare vendors directly. Instead, this
            report is built from real, vendor-attributed costs: every time you confirm a delivery
            in Delivery Review, that item's file cost is captured and tagged to the vendor you
            picked; a manually logged purchase with a cost entered works the same way. Once an item
            has a captured cost from two or more different vendors, it becomes comparable here.
          </p>
          <p>
            <strong>This starts out empty, and that's expected</strong> - it only has something to
            show once real vendor-tagged cost data exists, which builds up naturally as you use
            Delivery Review or log purchases with a cost.
          </p>
        </div>
      </details>

      <details className="help-section" id="reconciliation">
        <summary>Reconciliation</summary>
        <div className="help-section-body">
          <p>
            Purchased vs. sold vs. counted - the shrinkage/spoilage signal. For each item in a
            chosen window: <code>expected closing = opening count + purchased - sold</code>,
            compared against what was actually counted on the closing date. A negative variance
            means less is physically on hand than the math says there should be.
          </p>
          <h4>Why you have to log purchases by hand</h4>
          <p>
            Toast's Purchasing &amp; Receiving API isn't accessible with this account's current
            credentials, so there's no automatic feed of what was actually bought/received - "sold"
            (from Toast orders) and "counted" (from your inventory uploads) are both automatic, but
            "purchased" only exists if you log it yourself below. The fastest way to do that is the{" "}
            <strong>"we received a delivery today"</strong> flow on the inventory upload (see
            Overview's help section) - it suggests quantities for you to confirm instead of typing
            each one from scratch. The form and CSV upload below are for anything that flow misses,
            or a past date.
          </p>
          <h4>Demo section</h4>
          <p>
            The "Demo: see how this works with your real data" panel at the top isn't a canned
            example - it pulls one real item and its real opening count, real Toast sales, and real
            next-count closing figure, over the most recent window your upload history actually
            supports, then walks through the exact formula with those real numbers. A "try it" field
            lets you type a hypothetical purchased quantity and see the expected closing and
            variance recalculate live, so you can see how logging a delivery would change the
            result before you start logging for real.
          </p>
          <h4>Log a purchase</h4>
          <p>
            Search for the real item (so it matches up correctly with sales/inventory data), enter
            the supplier, quantity received, and date - unit cost and notes are optional. Logged
            entries show up in the list below, where you can delete a mistaken one.
          </p>
          <h4>Bulk-logging from a CSV</h4>
          <p>
            For a whole vendor delivery at once, use "Bulk-log purchases from a CSV" under the
            form. Columns are matched by header name in any order - needed: an item column
            (<code>item name</code> or <code>item id</code>) and a <code>quantity</code> column;
            optional: <code>supplier</code>, <code>unit cost</code>, <code>received date</code>{" "}
            (rows with no date use the default date you pick before uploading), and{" "}
            <code>notes</code>. Item names have to match an existing inventory item exactly (not
            case-sensitive) - any row that can't be matched, or has a bad quantity/date, is skipped
            and listed after the upload instead of being guessed at.
          </p>
          <h4>Reading the report</h4>
          <p>
            <strong>Until purchase logging is routine, expect most items to show a variance</strong>{" "}
            - that's not real shrinkage, it just means nothing's been logged as purchased for that
            item yet, so any restocking that happened looks like unexplained loss. This report only
            becomes a meaningful signal once logging is consistent - treat early results as a
            reminder to log purchases, not a shrinkage report yet.
          </p>
        </div>
      </details>

      <details className="help-section" id="ask">
        <summary>Ask Inventory Bot</summary>
        <div className="help-section-body">
          <p>
            The 💬 chat bubble in the bottom-right corner is on every page, not just this one - click
            it to ask a question in plain language and get an answer backed by the same reports as
            the rest of the app: reorder candidates, supplier projection, reconciliation, vendor
            price comparison, items sold, price history, dead stock/margin, and barcode reports.
            It's powered by Claude (Anthropic's AI), given tools to look up each of those reports for
            real - it never guesses or estimates a number itself. Your conversation stays open as
            you navigate between pages, until you close the chat.
          </p>
          <h4>Strictly read-only</h4>
          <p>
            The bot cannot log a purchase, confirm a delivery, change a price, or write anything to
            the database - every tool it has access to only reads data. A misunderstood or
            ambiguous question can at worst give you a wrong or incomplete answer; it can't corrupt
            real inventory or purchase records.
          </p>
          <h4>Which model answers</h4>
          <p>
            A quick, cheap check decides how to route each question before it's answered: a direct
            single-lookup question ("how much cilantro do we have") is answered by a fast, cheap
            model, while a question that needs combining multiple reports or real reasoning ("why
            did margin drop this month", "which vendor should I switch to") is automatically handed
            to a stronger model instead. Each answer says which one actually ran, and which
            report(s) it checked, so you can see where the number came from.
          </p>
          <h4>Setup</h4>
          <p>
            Requires an Anthropic API key set as <code>ANTHROPIC_API_KEY</code> in{" "}
            <code>backend/.env</code>. If it isn't set, the chat shows a clear "not configured"
            error instead of a broken response - nothing else in the app depends on it.
          </p>
        </div>
      </details>

      <details className="help-section" id="users">
        <summary>Users (admin only)</summary>
        <div className="help-section-body">
          <p>
            Admin accounts can create new logins and reset anyone's password. There's{" "}
            <strong>no self-service "forgot password" flow anywhere, by design</strong> - if someone
            forgets their password, an admin resets it here. Resetting a password immediately signs
            that user out everywhere (their old session stops working right away).
          </p>
          <p>
            Any user - admin or not - can change their own password from{" "}
            <strong>Change Password</strong> in the sidebar, as long as they know their current one.
          </p>
        </div>
      </details>

      <details className="help-section" id="limitations">
        <summary>What this doesn't do (yet)</summary>
        <div className="help-section-body">
          <ul>
            <li>
              <strong>No automatic ordering.</strong> Nothing in this dashboard places an order or
              talks to a vendor system - Reorder Candidates (All Suppliers) and Supplier Projection
              are decision support; the draft PO PDF is something you review and send yourself.
            </li>
            <li>
              <strong>No real vendor cost or lead time.</strong> "Vendor lead time" on Reorder
              Candidates is a number you type in, not looked up - Toast's Purchasing API isn't
              accessible with the current account credentials.
            </li>
            <li>
              <strong>Forecasting is a simple average, not a smart prediction.</strong> Every demand
              number is "average daily sales over your chosen window" - it doesn't know about
              seasonality, holidays, or trends up/down.
            </li>
            <li>
              <strong>Inventory is only as fresh as your last upload.</strong> There's no live
              stock feed - every on-hand number reflects whenever you last uploaded the Toast Retail
              export.
            </li>
          </ul>
        </div>
      </details>
    </>
  );
}
