# Vishesh Steels Billing Tool — Design

## Goal

Port the full Narayani/Vansh Iron billing-tool architecture (stock-tracked
invoicing + reports + balance sheet) to Vishesh Steels, whose invoicing
today is a single static `final-invoice-VS.html` with no stock system at
all. Primary design pressure: VS staff routinely run several invoices in
multiple browser tabs at once, so the stock-deduction flow must stay
correct and legible under that usage pattern.

## Current state (as found)

- `final-invoice-VS.html` (736KB, mostly one embedded base64 letterhead
  image) already implements two document flows in one file: the tax
  invoice/Chitti (`generate()`) and a short-validity "Quotation" weighment
  slip (`buildFirstSlip`/`buildContSlip`, "Valid for 2 Hours") — a
  pre-invoice rate quote issued at the weighbridge, not a binding sale.
- Invoice/quotation item rows already carry **Qty (kg) + Pcs + Rate**,
  matching the dual pieces+kg tracking `stockStore.js` already supports
  (no store changes needed).
- The file has **dead duplicate code**: `qAddRow`/`qRender`/`qDel`/
  `qRecalc`/`qFmt` are defined four separate times (lines ~203-213,
  224-243, 245-263, 265-284), left over from past edits.
- `Delivery Challan/delivery_challan.html` already exists standalone and
  was in fact the donor template Vansh Iron's own challan was adapted
  from — it needs no redesign, just relocation into the new `app/public/`
  and a menu link.
- `Quotation/` only contains an old `.odg` mockup, not live code — the
  working quotation flow is the one embedded in `final-invoice-VS.html`
  above.
- Existing accent color is `#1a2a6e` (navy) — kept as-is, no rebrand.
- No stock system, no backend, no reports/balance-sheet pages exist yet.

## Architecture

Same shape as Vansh Iron's port, reusing `stockStore.js` and `server.js`
verbatim (both are already generic — no VI-specific code in either):

```
Vishesh Steels/
├── app/
│   ├── server.js, stockStore.js       (copied unmodified from Vansh Iron)
│   ├── data/stock.json                (new, seeded categories, qty 0)
│   └── public/
│       ├── final-invoice-VS.html      (rebuilt entry point)
│       ├── stock.html
│       ├── reports.html
│       ├── balance-sheet.html
│       └── delivery_challan.html      (moved in, unchanged apart from menu link)
├── final-invoice-VS.html              (top-level copy kept in sync, same
│                                        dual-file pattern as VI)
└── final-invoice-VS.BACKUP-<date>.html (pre-edit snapshot)
```

Runs on port **3500** (3400 is already Vansh Iron). No license/self-update
gate — Vishesh Steels is Jalan Group's own business, not an external
paying client. Deployment to the shop PC (launch.vbs / start.bat pair) is
a separate later step, not part of this build.

## Stock data model

Reuses `stockStore.js` as-is: categories, items (kg and/or dual pcs+kg
tracked), movements log, `stock-in`/`adjust`/`deduct` operations, period
reports. Seeded categories (matching Vansh Iron's real product lines,
confirmed with the user): **TMT Bars, MS Pipes, MS Rounds, Flats, Angles,
Channels, Squares, Profile Sheets.**

## Multi-tab deduction flow (the core design question)

The underlying write path is already safe under concurrency: deduction
only happens on an explicit "📦 Deduct from Stock" click (never
automatically while typing), and the Node server applies each deduction as
a synchronous, single-threaded file write — two tabs deducting at the same
moment can't corrupt or interleave the stock numbers.

What was missing is **staleness visibility** — a tab's displayed stock
quantity is fetched once at load, so an operator could be looking at a
number another tab already invalidated. Two additions close that gap:

1. **Live-refreshing display**: while the invoice-builder step is open,
   re-fetch `/api/stock/items` on a 30s interval and re-render the
   quantity shown next to each linked item, so a tab reflects other tabs'
   completed deductions within 30s without a manual reload.
2. **Fresh check + soft warning at commit time**: immediately before
   `deductStock()` fires its POSTs, re-fetch current stock for every row
   about to be deducted. If any deduction would take an item negative,
   show a non-blocking warning listing which items and by how much
   ("TMT Bars 12mm: only 40kg left, this invoice deducts 60kg") with two
   choices — **Deduct Anyway** (proceeds, same as today's no-negative-guard
   behavior, still logged as `invoice-deduct`) or **Cancel** (returns to
   editing, nothing deducted). This is a warning, not a hard block —
   steel yards sometimes intentionally sell against incoming stock.

The existing idempotency guard (`_deducted` flag per row, `btn-deduct`
disabled after success) is kept unchanged — it already prevents a single
tab from double-deducting on repeated clicks.

The Quotation slip does **not** deduct stock (it's a non-binding rate
quote) but shows the same live stock quantities for reference when picking
items, using the same 30s-refresh fetch.

## Companion pages

`stock.html`, `reports.html`, `balance-sheet.html` are ported from Vansh
Iron with only cosmetic changes: company name → Vishesh Steels, accent
color stays VS's existing `#1a2a6e` (no new palette needed, unlike VI
which needed a fresh accent). No VS-specific functional changes — same
daily/weekly/monthly report periods, same movement reasons
(`initial`/`stock-in`/`adjustment`/`invoice-deduct`).

## Cleanup included in this pass

- Collapse the four duplicate `qAddRow`/`qRender`/`qDel`/`qRecalc`/`qFmt`
  definitions in `final-invoice-VS.html` into one canonical set as part of
  the rebuild (dead code, not a behavior change).
- No other refactoring beyond what the stock port requires.

## Out of scope

- Redesigning the invoice/quotation print layout — VS's existing layout,
  fields, and letterhead are kept as-is.
- Deployment to the shop PC / AnyDesk delivery — separate step once this
  is built and tested locally.
- Delivery Challan stock linking — stays pure paperwork, same as Vansh
  Iron's challan (only the invoice/Chitti step deducts).
