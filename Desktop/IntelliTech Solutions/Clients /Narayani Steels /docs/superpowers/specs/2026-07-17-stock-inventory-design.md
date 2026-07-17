# Stock/Inventory Management — Design

**Date:** 2026-07-17
**Client:** Narayani Steels
**Status:** Approved by Vansh, pending implementation plan

## Purpose

Narayani Steels currently has no way to track stock levels for the items it
sells. This adds a Stock/Inventory module to the existing billing tool
(`final-invoice-NS.html` + Express server in `app/`) so Vansh's uncle's team
can:

1. Create stock items (with category, name, optional weight-per-piece) and
   see piece counts auto-computed from total kg.
2. Manage categories, including adding new ones on the fly.
3. Update stock levels over time (receiving new stock, correcting counts).
4. Have stock automatically reduce when an item is billed on a Chitti/Invoice.

The exact item list (grouped by category) will be supplied later as an Excel
file and bulk-imported — this spec does not depend on that data arriving
first.

## Non-goals

- No changes to Quotation (`#s5`/`#s9`) or Delivery Challan flows — stock only
  links to the Chitti/Invoice (`#s3`) step.
- No multi-user concurrency handling beyond basic atomic file writes — this is
  a single shop PC, single operator at a time, same assumption the rest of
  the tool already makes.
- No barcode/scanner integration.
- No historical reporting/analytics UI beyond the raw movement ledger.

## Architecture

- **New page**: `public/stock.html`, self-contained HTML/CSS/JS in the same
  style as the existing tool (no build step, no framework). Linked from a new
  small "📦 Stock" nav item added to `final-invoice-NS.html`'s header.
- **New API routes** on the existing `server.js` (still plain Express, no new
  dependencies):
  - `GET /api/stock/categories`, `POST /api/stock/categories`
  - `GET /api/stock/items`, `POST /api/stock/items`
  - `POST /api/stock/items/:id/stock-in` (add received quantity)
  - `POST /api/stock/items/:id/adjust` (correct to a new true total)
  - `POST /api/stock/items/:id/deduct` (used by the Chitti "Deduct from
    Stock" action)
  - `GET /api/stock/items/:id/movements` (ledger view for one item)
- **Storage**: a single JSON file, `app/data/stock.json`, containing
  `categories`, `items`, `movements` arrays (schema below). Reads/writes go
  through a small `app/stockStore.js` module that serializes access
  (in-memory mutex around read-modify-write) and writes atomically (write to
  `stock.json.tmp` then `fs.renameSync` over the real file) to avoid a
  corrupt file if the process is killed mid-write.
  - Rejected alternative: SQLite (e.g. `better-sqlite3`). The shop PC has no
    internet and the app ships `node_modules` pre-committed from a Mac dev
    machine — a native module's prebuilt binary is not guaranteed to match
    the Windows target. JSON avoids that risk entirely and this data is small
    (low hundreds of rows at most).
  - Rejected alternative: embedding stock UI as a new step inside
    `final-invoice-NS.html`. That file is already a ~637KB single-file blob
    that requires Python-assisted extraction to edit safely (per prior
    session notes) — adding an unrelated concern to it would make it worse,
    not better.
- `app/data/` is created on first run if missing; `stock.json` is
  initialized with the 6 preset categories and empty items/movements if the
  file doesn't exist yet.

## Data model

```jsonc
// app/data/stock.json
{
  "categories": [
    { "id": "cat_...", "name": "M.S. Pipes" },
    { "id": "cat_...", "name": "TMT Bars" },
    { "id": "cat_...", "name": "M.S. Section" },
    { "id": "cat_...", "name": "Colour Coated Sheets" },
    { "id": "cat_...", "name": "Cement" },
    { "id": "cat_...", "name": "Rings" }
  ],
  "items": [
    {
      "id": "item_...",
      "categoryId": "cat_...",
      "name": "TMT 12mm Bar",
      "weightPerPieceKg": 10.5,   // optional; null if not applicable/unknown
      "currentStockKg": 1250.5
    }
  ],
  "movements": [
    {
      "id": "mv_...",
      "itemId": "item_...",
      "deltaKg": 500,             // positive = added, negative = removed
      "reason": "stock-in",       // "stock-in" | "invoice-deduct" | "adjustment" | "initial"
      "note": "",                 // optional free text, e.g. adjustment reason
      "at": "2026-07-17T10:32:00.000Z"
    }
  ]
}
```

- `currentStockKg` is the authoritative live value read by the UI.
  `movements` is an append-only audit ledger — every change to
  `currentStockKg` (creation, stock-in, adjustment, invoice deduction) writes
  exactly one movement row alongside it, atomically, in the same write.
- Pieces are **never stored** — always computed as
  `weightPerPieceKg ? Math.floor(currentStockKg / weightPerPieceKg) : null`,
  so they can never drift out of sync with the kg value. UI shows "—" when
  `weightPerPieceKg` is null.
- IDs are simple random strings (`crypto.randomUUID()` slice or similar) —
  no auto-increment counter to manage across concurrent-ish writes.

## Stock page UI (`public/stock.html`)

- **Category bar**: pill/tab per category (6 presets seeded on first run),
  plus a **"+ Add category"** button — prompts for a name, `POST`s
  immediately, appears in the bar right away.
- **Item list** (filtered by selected category tab): table of Name,
  Weight/Piece, Current Stock (kg), Pieces (computed), actions.
- **"+ Add item"** form: Category (defaults to selected tab), Name,
  Weight/Piece (kg, optional), Initial Stock (kg). Pieces preview updates
  live as the user types, using the same computation the backend will use —
  no surprise mismatch between what's shown while typing and what's saved.
- **Add Stock** action per item: small inline form, enter kg received →
  `POST .../stock-in` → `currentStockKg += kg`, movement logged with reason
  `stock-in`.
- **Adjust** action per item: enter the new true total kg → `POST
  .../adjust` → server computes `delta = newTotal - currentStockKg`, sets
  `currentStockKg = newTotal`, logs one movement with reason `adjustment`
  and that delta (can be negative).
- **Negative stock is allowed, not blocked.** If `currentStockKg < 0`, the
  row renders with a red/warning style. Rationale: blocking would stop a
  real invoice from being generated just because the tracker under-counted
  somewhere upstream (e.g. items sold before this system existed, or a
  missed stock-in entry) — better to surface the discrepancy visually and
  let a human reconcile it via Adjust, than to hard-stop billing.
- **Movement history**: expandable/small link per item to view its
  `GET .../movements` ledger (date, reason, delta, note) — mainly for
  debugging "why did this number change" rather than a polished reporting
  view.

## Linking to invoicing (auto-deduct)

Scope: **Chitti/Invoice step (`#s3`/`#s4`) only.** Quotation and Delivery
Challan are untouched.

1. **Particulars becomes an autocomplete.** The existing Particulars
   `<input>` in the item row (`itbl` table, `addRow()`) gets a
   `list="stock-items-datalist"` attribute. A `<datalist>` is populated once
   per session from `GET /api/stock/items` (id + display name, formatted as
   `"<name> (<category>)"`). Typing still allows arbitrary free text for
   non-stock/one-off items — those simply won't match anything and won't
   deduct. When the typed value matches a datalist entry's display name
   exactly (case-insensitive, trimmed), that row is tagged with the matched
   `itemId` (stored as a `data-stock-item-id` attribute on the row); if the
   user edits the text afterward and it no longer matches, the tag is
   cleared. This keeps matching unambiguous — no fuzzy/partial matching that
   could deduct the wrong item.
2. **"Deduct from Stock" button on the preview screen (`#s4`)**, placed next
   to the existing Print button, **only shown when doc type is
   Invoice/Chitti** (not Quotation/Challan — those don't reach `#s4` via the
   same path, but the check is explicit either way) and **only enabled if at
   least one row has a matched `itemId`**.
   - Deliberately **not** wired to `generate()` or `window.print()`. Both of
     those can be clicked repeatedly while the user is still editing,
     re-previewing, or reprinting a physical copy — auto-deducting on every
     such click would silently double- or triple-count the stock loss. A
     single explicit action, taken once the operator is satisfied with the
     invoice, avoids that without adding manual arithmetic.
   - On click: for each row with a matched `itemId`, `POST
     /api/stock/items/:id/deduct` with that row's **Qty (kg)** value
     (`deltaKg = -qty`, reason `invoice-deduct`). After all rows succeed,
     the button is disabled (`data-deducted="true"`) and its label changes
     to "✓ Stock Deducted" to prevent an accidental second click for the
     same invoice; going back to Edit (`go(3)`) and re-generating resets
     this flag, since that produces what is functionally a new invoice
     preview.
   - Shows a small inline confirmation listing what was deducted, e.g.
     "Deducted: 250kg TMT 12mm Bar; 80kg M.S. Angle."
   - If a deduct call fails (e.g. server briefly unreachable), show an
     error inline and leave the button enabled/unmarked so it can be
     retried — do not silently swallow the failure.

## Excel import (later, once the file arrives)

A one-off Node script (`app/scripts/import-stock.js`, not part of the
running server) reads the client's Excel (category-separated sheets/columns,
exact shape TBD once the file is seen) and upserts into `stock.json`:
category by name (create if missing), item by name+category (create if
missing, otherwise leave existing `currentStockKg` alone — import sets
*opening* stock, it should not silently overwrite levels already tracked by
then). This script is out of scope for the current implementation plan and
will be scoped separately once the Excel is in hand.

## Error handling

- All `/api/stock/*` routes validate input server-side (required fields,
  `deltaKg`/kg values must be finite numbers) and return `4xx` with a JSON
  `{ error: "..." }` body on bad input — mirrors the "fail fast, don't trust
  client input" rule even though this is a trusted single-operator tool.
- Concurrent writes to `stock.json` are serialized through an in-process
  queue in `stockStore.js` (simple promise chain), so two near-simultaneous
  requests (e.g. two browser tabs open) can't interleave and corrupt the
  file or lose a movement.
- If `stock.json` is somehow malformed on read (manual edit gone wrong,
  corrupted write), the server logs the error and refuses to start the
  stock routes with a 500 rather than silently resetting the file to empty —
  losing the client's stock data silently would be worse than a visible
  failure they can report.

## Testing

- **Unit**: `stockStore.js` — create category/item, stock-in, adjust
  (including negative-delta correction), deduct, computed pieces
  (including `weightPerPieceKg` null case), atomic write survives a
  simulated crash between temp-write and rename (leaves prior valid file
  intact).
- **Integration**: API routes — each endpoint's happy path + invalid-input
  4xx cases, using a temp `stock.json` per test run (not the real data
  file).
- **E2E (Playwright, matching this project's existing tooling)**: add
  category → add item → verify piece calc shown → stock-in → adjust
  (including going negative, verify red styling) on `stock.html`; separately,
  on the Chitti flow: type a matching item name into Particulars → verify
  datalist match tags the row → generate → click "Deduct from Stock" →
  verify confirmation text and that the button becomes disabled → verify a
  second click is not possible without going back to Edit and regenerating.
- Manual verification on the actual shop PC deployment is still required
  before this is considered delivered, per this project's established
  pattern (TeamViewer live check), since `app/data/stock.json` and the new
  routes need to exist there too — this isn't a static-file-only update like
  most prior changes to this project.
