# Narayani Steels — Bending Charges, Dual Stock Tracking, Ledger Removal, Stock Sort (2026-08-05)

## Summary

Five changes to the billing/stock tool, requested together:

1. Add a "Bending Charges" line item to the Chitti/Invoice.
2. Let individual stock items track Pieces and Kg as two independent, manually-entered counters (opt-in per item), instead of pieces always being a derived estimate.
3. Remove the Ledger feature (customer accounts, invoices, WhatsApp send) entirely. Balance Sheet stays — it's a separate module with no shared code.
4. On the Stock page, sort zero-stock items to the bottom of each category, below a visual divider, instead of interleaved with in-stock items.
5. Reports not reflecting newly-added stock items — root-caused, no code fix needed (see below).

## 1. Bending Charges

Mirrors the existing Loading/Kanta/Freight/Unloading/Others charges in the Chitti (`final-invoice-NS.html`, `#s3`):

- New manual number input `f-bend` ("Bending Charges") in the `charges-grid`, next to Unloading/Others.
- Threaded through the same plumbing those fields already use: `recalc()`, `generate()`, `totalsBlock()`, `buildFirstSlip()`/`buildContSlip()`, the printed totals-row list (hidden when 0, same as Kanta/Freight/Unloading/Others), `reset()`'s field-clear list, and the fixed-19-row blank-padding count (`tc`/`cc` arrays) that these charge fields already participate in.
- No auto-calculation — plain manual entry, always additive into Grand Total.
- Quotation and Delivery Challan are untouched (Bending Charges is Chitti-only, per the ask).

## 2. Dual Pieces + Kg stock tracking (per-item, opt-in)

**Today:** each stock item tracks one real number (`currentStockKg` — kg for `unit:'kg'` items, a piece count for `unit:'pcs'` items). For `unit:'kg'` items with `weightPerPieceKg` set, "Pieces" shown anywhere is a derived estimate (`floor(currentStockKg / weightPerPieceKg)`), never a real tracked count.

**New:** a per-item checkbox, **"Track Pieces + Kg together"** (`dualTrack: boolean`, new field, default `false`), on the Add Item and Edit Item forms in `stock.html`. It's a property of the item, not a one-off toggle — it stays exactly as last set until someone changes it, satisfying "keep this option set to whatever was last used."

When `dualTrack` is `true` for an item:
- The item gets a second real counter, `stockPcs` (new field, default `0`), tracked completely independently of `currentStockKg` — no conversion, no derivation from `weightPerPieceKg`.
- **Stock In** and **Adjust** (`stock.html`) show two required number inputs — Pieces and Kg — instead of the current single input (+ optional kg/pcs unit dropdown for weight-linked items). Both must be filled before submit; leaving either blank blocks the action with an inline validation message, matching this project's existing validation style.
- The item list and item History show both counters (e.g. "120 pcs / 850 kg") instead of a single value + derived pieces.
- `weightPerPieceKg` becomes irrelevant for a dual-track item (no longer read for any calculation) but the field itself isn't removed from the data model — it just stops being used while `dualTrack` is on. `computePieces()` returns `item.stockPcs` directly when `dualTrack` is true, instead of the derived formula.
- **Chitti deduction**: a row matched to a dual-track stock item requires **both** Qty(kg) and Pcs filled in (both > 0, or one explicitly zero — just not blank) before it counts as deductible. A row missing either is flagged with a distinct warning (reusing the existing ⚠ badge mechanism, with a tooltip naming which field is missing) and excluded from `performStockDeduction()`, listed alongside today's "not linked to stock" warnings rather than silently going through. Deducting posts both quantities in one call, decrementing `currentStockKg` and `stockPcs` independently.
- Items with `dualTrack: false` (the default, and every existing item post-migration) behave exactly as today — zero change to TMT Bars, Cement, or any item nobody opts in for.

**API changes** (`stockStore.js`, `server.js`):
- `addItem`/`updateItem` accept `dualTrack` (boolean) and, when true, `initialStockPcs`.
- `stockIn`, `adjust`, `deduct` accept an optional `pcs` value alongside the existing `kg` value. For non-dual items this is ignored exactly as today (kg-only). For dual items, both `kg` and `pcs` are required by the route and applied to their respective counters in the same movement.
- Movement records (`data.movements`) gain an optional `deltaPcs` field (alongside the existing `deltaKg`), populated only for dual-track items' movements.

**Migration** (existing ~163 items, per your answer): every existing item gets `dualTrack: false` and `stockPcs: 0` seeded on load (one-time schema migration in `stockStore.js`'s `load()`, or a version-bump migration step — whichever is simpler in the existing load path). No values are fabricated; you turn the checkbox on per item as needed and enter real counts from then on.

**Reports** (`getReport()`): for dual-track items, the report row additionally carries `openingPcs`/`stockInPcs`/`soldPcs`/`adjustmentsPcs`/`closingPcs`, computed via the same backward-reconstruction logic already used for the kg/count column, applied independently to `stockPcs`/`deltaPcs`. No new table columns — `reports.html` renders each of the five existing quantity cells (Opening/In/Sold/Adjustments/Closing) as a combined `"X pcs / Y kg"` string for a dual-track item's row, the same "both counters together" convention the Stock page's item list already uses. A category subtotal row shows the combined string too whenever it contains at least one dual-track item (summing pcs and kg separately, then joining); categories with no dual-track items keep the current single-number rendering, unchanged.

## 3. Remove Ledger

Removed entirely:
- `app/public/ledger.html`, `app/public/customer.html`, `app/public/invoice.html`.
- `app/ledgerStore.js` and its test file.
- Every `/api/ledger/*` route in `server.js`, including `/api/ledger/invoices/:id/send-whatsapp` (this only ever served ledger invoices — the separate WhatsApp bot process itself is untouched, this repo just stops calling it) and `/api/ledger/invoices/:id/pdf` (and `renderInvoicePdf()`, confirmed used nowhere else).
- The "📒 Ledger" tile from the main doc-type grid in `final-invoice-NS.html`.
- In the Chitti (`final-invoice-NS.html`): the Customer `<select>`, `onCustomerPick()`, Old Balance field, Advance field, the "Finalize & Send" button and `recordInvoice()`, `loadLedgerCustomers()`, the ledger-load-failed banner message, and every reference to `oldbal`/`advance` in `recalc()`, `totalsBlock()`, `buildFirstSlip()`/`buildContSlip()`, `reset()`'s clear-list, and the blank-padding row count math.
- `updateDeductButton()` simplifies: since there's no more ledger-linked "Finalize & Send absorbs stock deduction" branch, the standalone "📦 Deduct from Stock" button just shows whenever any row is matched to stock, for every Invoice — no more walk-in-only condition.

Untouched: Balance Sheet (`balance-sheet.html`, `balanceSheetStore.js`) — confirmed it has no dependency on `ledgerStore` or ledger data, and its own nav links (from Reports, Stock) don't route through Ledger.

`app/data/ledger.json` (if present on a given deployment) is simply no longer read — not actively deleted by this change, since it's gitignored runtime data, not source.

## 4. Stock page: zero-stock items sorted to the bottom

In `stock.html`'s `renderItems()`, within each category view (and search results), partition the visible items into two groups **preserving their existing relative order** within each group — no alphabetizing, just a stable split:
- Items with any stock remaining (kg or pcs, whichever the item tracks; for dual-track items, "any" means kg > 0 OR pcs > 0) render first.
- A single visual divider row (a thin horizontal rule spanning the table) renders between the two groups — only when both groups are non-empty.
- Zero-stock items (all tracked counters exactly 0 — kg==0 for a normal item, kg==0 AND pcs==0 for a dual-track item) render after the divider, visually dimmed (reduced opacity on that row) to reinforce they're empty.
- **Negative** stock (over-deducted, already shown today with the `.neg` class) counts as "has stock" for sorting purposes — it stays in the top group, since it needs attention, not burial at the bottom.

## 5. Reports not showing new items — root cause, no code fix needed

Tested directly: added a throwaway item to the current (not-yet-deployed) code via a locally-run server, hit `/api/stock/report`, and it appeared correctly with all-zero figures — then deleted it and confirmed cleanup. `getReport()` iterates `data.items` unconditionally, so every item, however new, always gets a row.

You confirmed this gap is something you've seen on the **live shop PC**, not on current source. That PC is still running the last successfully deployed version (predates the 2026-08-04 fixes, which are still blocked on TeamViewer access) — this is almost certainly the same "partial/stale file" failure mode as the 2026-07-29 balance-sheet incident, not a new bug.

**Action, not a code change**: when the next TeamViewer deploy finally happens, ship the **complete** `app/` file set (`server.js`, `stockStore.js`, every `public/*.html`) rather than only the files touched since the last deploy — this guarantees Stock, Chitti, and Reports are all running mutually consistent code, closing this class of failure generally rather than patching one instance. This is a checklist addition for the deploy step, not an implementation task.

## Testing

- `stockStore.test.js`: dual-track item creation, stock-in/adjust/deduct requiring both fields, migration seeding (`dualTrack:false`, `stockPcs:0` on legacy items), report rows carrying pcs columns for dual-track items.
- `server.test.js`: updated/removed ledger route tests deleted; stock routes gain dual-track request/validation coverage.
- Manual verification via local server + Claude-in-Chrome (established pattern for this project): Bending Charges prints/totals correctly; a dual-track item's Stock In/Adjust/Chitti-deduct round-trip end to end; Ledger's absence doesn't break Chitti/Stock/Reports/Balance Sheet; Stock page's zero-stock sort/divider renders correctly across categories with mixed stock levels.

## Out of scope (explicitly, per prior sessions' scope discipline on this project)

- No changes to Quotation or Delivery Challan.
- No changes to Balance Sheet.
- No retroactive backfill of real Pieces counts for existing items — that's manual, per-item, done by Vansh via Edit, same as the still-open M.S. Section/Rings weight backfill from the 2026-07-23 session.
- No change to how billing **amount** is calculated (Qty×Rate / Pcs×Rate) — this work is about stock **quantity tracking**, not pricing.
