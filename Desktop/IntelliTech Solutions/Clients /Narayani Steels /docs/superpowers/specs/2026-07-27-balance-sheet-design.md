# Daily Balance Sheet — Design

**Date:** 2026-07-27
**Client:** Narayani Steels
**Status:** Approved by Vansh, pending implementation plan

## Purpose

Narayani Steels currently closes out each business day on a handwritten paper
balance sheet (photographed reference: a single sheet with a devotional
header, then cash/bank in and out entries in four rough blocks, ending in a
running total). This adds a Daily Balance Sheet module to the existing
billing tool so the shop can record each day's cash and bank position
digitally instead, with the closing balance automatically carrying forward
as the next day's opening.

This spec covers the module as a real, ongoing daily record — not a one-off
print template — since it's explicitly meant to replace the daily
handwritten process going forward.

## Non-goals

- No changes to Quotation, Chitti/Invoice, Delivery Challan, or Stock flows.
  This is a new, independent module that happens to live in the same app.
- No automatic linking between this and the Stock/Ledger modules (e.g. an
  invoice does not auto-create a Balance Sheet row). Entries are typed in by
  whoever closes the register for the day, same as the handwritten process.
- No multi-user concurrency handling beyond the same atomic-file-write
  assumption the Stock module already makes (single shop PC, single operator
  at a time).
- No enforcement that Opening Balance must be auto-carried forever — the
  field is editable so the shop can switch to manual entry later without any
  code change, per Vansh's explicit "auto for now, might go manual later."

## Architecture

- **New page**: `public/balance-sheet.html`, self-contained HTML/CSS/JS in
  the same style as `stock.html`/`reports.html` (no build step, no
  framework). Linked as a 7th card in `final-invoice-NS.html`'s main
  doc-type grid, and cross-linked in Stock/Reports' header nav, matching the
  existing pattern.
- **New API routes** on the existing `server.js`:
  - `GET /api/balance-sheet/:date` — returns the day's rows plus all
    computed totals (derives Opening if not explicitly overridden — see Data
    model).
  - `PUT /api/balance-sheet/:date` — saves the day's four row-arrays.
- **Storage**: a single JSON file, `app/data/balance-sheet.json`, gitignored
  alongside `stock.json` (real business data, never committed). Reads/writes
  go through a new `app/balanceSheetStore.js` module, following
  `stockStore.js`'s existing pattern: serialized in-memory access, atomic
  writes (temp file + rename).
  - Rejected alternative: folding this into `stock.json`. Balance sheet data
    (cash/bank movements) is a distinct concern from item stock levels; a
    separate file keeps each store module small and focused, matching this
    project's existing "many small files" convention.
- `app/data/` already exists (created by the Stock module); no new directory
  needed. `balance-sheet.json` is initialized with `{ days: {} }` if missing.

## Data model

```jsonc
// app/data/balance-sheet.json
{
  "days": {
    "2026-07-27": {
      "cashIn": [ { "label": "Opening Balance", "amount": 42000 },
                  { "label": "Ashok", "amount": 1000 } ],
      "bankIn": [ { "label": "Narsingh Steel", "amount": 250000 } ],
      "expenses": [ { "label": "Coal", "amount": 560 } ],
      "bankOut": [ { "label": "Narayani Steel supplier", "amount": 2500000 } ]
    }
  }
}
```

- Each date key is `YYYY-MM-DD`. A day's record is exactly the four row
  arrays — nothing else is stored per day.
- **Opening Balance is not a separate stored field.** By convention it is
  structurally **`cashIn[0]`** — a reserved position, not identified by
  matching its label text (fragile if the label were ever edited or
  duplicated). `cashIn[0]`'s **label is fixed as `"Opening Balance"` and is
  not editable**, and it has **no delete action** in the UI — it always
  exists as the first row, even on a day with no other entries at all.
  Only its `amount` is editable, same as any other row's amount.
- When a day is fetched via `GET` and it has no saved record yet, the
  server synthesizes `cashIn[0]` with `amount` derived live as **the
  closing balance of the most recent earlier date that has a saved
  record** (0 if none exists). This is computed fresh on every read, never
  cached or written until the user actually saves that day — so editing a
  past day automatically corrects every later day's opening the next time
  it's viewed, with no cascade or rewrite step.
- The synthesized `cashIn[0]` amount is returned to the client like any
  other row and is fully editable — satisfies both "auto-carry for now" and
  "maybe manual later" with no schema change: the user can just overwrite
  the amount for a given day, and it saves like any other row from then on
  (future days still derive from *that* day's saved closing, since the
  derivation always reads whatever is actually on disk).
- Row `amount` must be a finite number ≥ 0; `label` must be non-blank after
  trim — validated server-side in `balanceSheetStore.js`, same convention as
  `stockStore.updateItem`.

## Calculations

```
cashTotal      = Σ cashIn.amount                 // includes the Opening row
expensesTotal  = Σ expenses.amount
cashSubtotal   = cashTotal - expensesTotal

bankInTotal    = Σ bankIn.amount
bankOutTotal   = Σ bankOut.amount
bankSubtotal   = bankInTotal - bankOutTotal

closingBalance = cashSubtotal + bankSubtotal
```

`GET /api/balance-sheet/:date` returns the four row arrays plus
`cashTotal`, `expensesTotal`, `cashSubtotal`, `bankInTotal`, `bankOutTotal`,
`bankSubtotal`, `closingBalance` — all computed server-side so the client
never re-implements this math (mirrors how `stockStore.getReport` already
returns fully-computed rows to `reports.html`).

## Page UI (`public/balance-sheet.html`)

- **Header**: centered "श्री" (stylized text, no image asset) → full-width
  horizontal rule → a row with "श्री रानी सती दादी" on the left and the
  date in English on the right, with prev/next-day arrows (same navigation
  pattern as `reports.html`, defaulting to today) → a second full-width
  rule.
- **2×2 grid** below the rules:
  - Top-left: **Cash In** (Opening Balance as the first, always-present
    row, then add/remove rows for the rest).
  - Bottom-left: **Bank In**.
  - Top-right: **Expenses**.
  - Bottom-right: **Bank Out**.
  - Each square: a label input + amount input per row, a delete (✕) per
    row, an "+ Add row" action, and a live subtotal at the bottom of the
    square (client-side running sum for immediate feedback; server
    recomputes authoritatively on save/fetch).
- **Totals bar** beneath the grid: Cash Subtotal, Bank Subtotal, and a
  large/bold **Closing Balance**.
- **Save** button — explicit, `PUT`s the four row arrays to the server (no
  autosave-on-every-keystroke, to avoid a flood of writes while someone is
  mid-edit).
- **Print** button — triggers `window.print()`; a print stylesheet hides
  the Add/Delete/Save UI chrome and forces the content onto a single A4
  portrait page, reproducing the header → rule → 2×2 grid → totals
  structure as the printed replacement for the handwritten sheet.

## Error handling

- Both routes validate input server-side (rows must be an array; each row's
  `label`/`amount` validated as above) and return `4xx` with a JSON
  `{ error: "..." }` body on bad input, matching the Stock module's
  convention.
- Concurrent writes to `balance-sheet.json` are serialized through the same
  in-process promise-chain pattern `stockStore.js` uses, so two
  near-simultaneous saves (e.g. two open tabs) can't interleave and corrupt
  the file.
- If `balance-sheet.json` is malformed on read, the server logs the error
  and refuses to start the balance-sheet routes with a 500, rather than
  silently resetting to an empty file — same reasoning as the Stock module:
  a visible failure is better than silent data loss.

## Testing

- **Unit** (`balanceSheetStore.test.js`, `node --test`, matching this
  project's existing test tooling):
  - A fresh date with no saved record returns a synthesized Opening row of
    0 and empty arrays otherwise.
  - `saveDay` persists all four arrays; a fresh store instance reloading
    from disk returns the same data (matches `stockStore.test.js`'s own
    "survives reload" test).
  - Calculation math (`cashSubtotal`, `bankSubtotal`, `closingBalance`)
    matches the formulas above for representative rows.
  - Opening Balance carries forward from the nearest **earlier** saved
    date's closing balance, including across a gap day that has no saved
    record at all (not just literal date-minus-one).
  - Editing a past day's rows changes a later day's derived Opening the
    next time that later day is fetched (no stale caching).
  - Invalid rows (blank label, negative or non-numeric amount) are
    rejected with a clear error.
- **Manual verification** on the actual shop PC deployment is still
  required before this is considered delivered, per this project's
  established pattern (TeamViewer live check) — `app/data/balance-sheet.json`
  and the new routes need to exist there too, same as the Stock module's
  delivery required.
