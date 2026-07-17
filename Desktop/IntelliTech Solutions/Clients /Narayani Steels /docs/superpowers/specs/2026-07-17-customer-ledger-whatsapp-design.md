# Customer Ledger + WhatsApp Invoice Sending — Design

**Date:** 2026-07-17
**Client:** Narayani Steels
**Status:** Approved by Vansh, pending implementation plan

## Purpose

Narayani Steels' Chitti/Invoice flow currently generates a print-only blob and
persists nothing (the tool's own tagline: "Nothing is saved · Instant print
only"). This adds:

1. **Invoice persistence** — Chitti/Invoice generation starts creating a real,
   stored invoice record, but only for customers explicitly opted into ledger
   tracking (not every walk-in/cash sale).
2. **A customer ledger** — running balance per tracked customer, computed live
   from invoice charges plus manual old-balance and cash-paid entries, with a
   view of each customer's invoice/payment history and a read-only view of
   any individual invoice.
3. **WhatsApp invoice sending** (Phase 2, built after #1–2 work) — a
   dedicated, always-running WhatsApp process on the shop PC that sends a
   generated invoice's PDF to a customer on demand, decoupled from the
   billing server itself.

This is explicitly modeled on the Aaral Marketing dashboard's customer/ledger
pattern (live-computed balance, dues+payments split, decoupled WhatsApp
sender process) but rebuilt on Narayani's existing plain-JSON-file stack
rather than Aaral's Postgres stack, and adds a manual-entry web UI that
Aaral's version doesn't have (Aaral's balance adjustments are bot-driven
only).

## Non-goals

- Quotation and Delivery Challan do **not** create ledger entries — only
  Invoice/Chitti does (confirmed with Vansh).
- Every customer does **not** get auto-tracked. Ledger customers are an
  explicit, opt-in list (like Stock's categories/items) — a walk-in typed
  into the Chitti's existing free-text Particulars/name fields with no
  customer selected creates no ledger record at all.
- `invoice.html`'s read-only view is a plain data table, not a pixel-perfect
  reprint of the carbonless-slip print layout (`buildFirstSlip`/
  `buildContSlip`). A true reprint affordance is a separate future ask.
- WhatsApp sending is **manual per invoice** (a "Send via WhatsApp" button),
  not automatic on generate — confirmed with Vansh, avoids surprise sends.
- No changes to GST/totals/row-padding calculation logic anywhere in
  `final-invoice-NS.html` beyond what's needed to read/post ledger values.
- This spec does not cover redeploying to the shop PC — that's a separate
  TeamViewer session per this project's established pattern, same as the
  Stock module.

## Architecture

- **`app/ledgerStore.js`** — synchronous JSON-backed store, same shape and
  conventions as `app/stockStore.js` (atomic temp-file-then-rename writes,
  in-memory cache loaded on first access, a `requireLedger`-style init-error
  guard in `server.js` so a corrupted `ledger.json` disables only
  `/api/ledger/*`, not the whole app — mirrors Stock's existing
  `requireStock` pattern exactly).
- **Storage file:** `app/data/ledger.json` — added to the same `app/data/`
  gitignore entry already covering `stock.json` (real financial data, never
  committed).
- **New `/api/ledger/*` routes** on the existing `server.js`.
- **New pages**, root = source of truth, synced to `app/public/` exactly like
  `stock.html`:
  - `ledger.html` — customer list + add customer.
  - `customer.html?id=` — one customer's ledger detail.
  - `invoice.html?id=` — one invoice's read-only detail.
- **Ledger becomes a 5th card** in `final-invoice-NS.html`'s Document type
  grid (`#s2`'s `.grid3`, already widened to 4 columns for Stock — widens
  again to 5, `grid-template-columns:1fr 1fr 1fr 1fr 1fr`, same inline-style
  scoping so the shared `.grid3` class used elsewhere stays untouched).
  Clicking it navigates straight to `ledger.html`, same pattern as Stock's
  card.
- **Balance is never stored**, only ever computed live:
  `balance = sum(ledgerEntries where type='due' and customerId=X) − sum(ledgerEntries where type='payment' and customerId=X)`.
  This is the single most important invariant carried over from Aaral's
  design (a Postgres VIEW there, a plain reduce here) — it means the balance
  can never drift out of sync with its underlying entries, by construction.

## Data model

```jsonc
// app/data/ledger.json
{
  "customers": [
    { "id": "cust_...", "name": "Lakshmi Bhavani Steel", "phone": "9876543210", "createdAt": "..." }
  ],
  "invoices": [
    {
      "id": "inv_...",
      "invoiceNo": 1,                 // sequential display number, own counter
      "customerId": "cust_...",
      "date": "17/07/2026",
      "mobile": "9876543210",
      "lorry": "TS08AB1234",
      "items": [{ "q": "500", "name": "MS Angle", "p": "20", "r": "52" }],
      "sub": 26000, "lab": 200, "weigh": 0, "freight": 0, "unload": 0,
      "gst": 4716, "others": 0,
      "total": 30916,                 // sub+lab+weigh+freight+unload+gst+others (see note below)
      "createdAt": "..."
    }
  ],
  "ledgerEntries": [
    {
      "id": "le_...",
      "customerId": "cust_...",
      "type": "due",                  // "due" | "payment"
      "amount": 30916,
      "reason": "invoice",            // "invoice" | "old-balance" | "cash-paid" | "advance"
      "invoiceId": "inv_...",         // null for manual entries
      "note": "",
      "at": "..."
    }
  ]
}
```

**Critical invariant — no double-counting old balance:** a recorded
invoice's `due` ledger entry amount is **only the new charges on that
invoice** (`sub+lab+weigh+freight+unload+gst+others`). It never includes
whatever "Old Balance" was displayed on the printed slip, because that
figure *is* the customer's pre-existing ledger balance being redisplayed for
the customer's information — re-adding it as a new due would double it. If
"Advance" was filled on the Chitti, recording the invoice also posts a
**separate** `payment` entry (`reason: 'advance'`) for that amount. The
invoice record's own `total` field is for display/printing only — it is a
snapshot of what the printed slip said (`sub+lab+weigh+freight+unload+gst+others`,
matching `final-invoice-NS.html`'s existing `taxable+gst` — old
balance/advance are handled at the ledger level, not baked into this stored
`total`).

IDs use the same `crypto.randomUUID()`-based scheme as `stockStore.js`.

## Chitti integration (`final-invoice-NS.html`)

1. **Customer picker** added to the Chitti step (`#s3`), sourced from
   `GET /api/ledger/customers`: a `<select id="f-customer">` with a default
   "— Walk-in, not tracked —" option (`value=""`) plus one option per saved
   customer. This is separate from the existing free-text `f-name` field —
   `f-name` still controls what prints on the slip (so you can type a
   different display name if needed), the picker only controls ledger
   linkage.
2. Picking a customer:
   - Fetches that customer's live balance (`GET /api/ledger/customers/:id`)
     and writes it into the existing `f-oldbal` field, which becomes
     `readonly` (mirrors `f-labour`'s existing readonly/auto-calc styling)
     for as long as a customer is selected. Deselecting back to walk-in
     restores it to a normal editable manual field (existing behavior,
     untouched).
   - `f-advance` stays a normal editable field; its existing behavior
     (subtracted from the invoice total) is unchanged — the only new
     behavior is that recording the invoice will *also* post it as a ledger
     payment.
3. On the preview screen (`#s4`), a new **"💾 Record Invoice"** button
   appears only when a customer is linked, positioned before/near the
   existing Stock "Deduct from Stock" button (both can be visible
   simultaneously for the same invoice — independent features). Deliberately
   a separate explicit action, not folded into `generate()`, for the same
   reason as Stock's Deduct button: `generate()` can be called repeatedly
   while reviewing/editing, and each *intentional* click of Record Invoice
   should create exactly one new invoice + one new due — including on a
   genuine re-generate after going back to Edit, since that legitimately
   represents a new/corrected invoice being issued (unlike Stock's kg
   deduction, there's no "same physical goods double-counted" risk here —
   each recorded invoice is, by real-world accounting convention, its own
   document with its own invoice number, so no same-invoice-double-click
   guard is needed beyond simple button-disable-after-success to prevent an
   accidental double-click during the single click itself).
   - `POST /api/ledger/invoices` with the current form/rows state → creates
     the invoice record, one `due` ledger entry, and (if `f-advance` > 0) one
     `payment` ledger entry.
   - On success, button becomes disabled/"✓ Recorded" for that preview
     instance, and a **"📱 Send via WhatsApp"** button (Phase 2) appears next
     to it, now enabled since there's a real `invoiceId` to send.

## Ledger UI

### `ledger.html`

- Text search input (filters by name/phone, client-side).
- Customer list: name, phone, live balance (red if positive/owed — sign
  convention: positive balance = customer owes Narayani, matching "due minus
  payment"), click → `customer.html?id=`.
- "+ Add customer" inline form (name, phone) — phone is the WhatsApp target
  in Phase 2, so validated as digits-only, no format enforcement beyond that
  (matches how loosely the rest of this app treats phone fields today).

### `customer.html?id=`

- Header stat tiles: name, phone, current balance, entry count (mirrors
  Aaral's `customer.html` exactly, per Vansh's explicit ask for something
  "like the one we created for aaral marketing").
- Chronological table of all `ledgerEntries` for this customer, each row
  showing date, reason, amount (signed), running balance — computed by
  walking entries oldest-to-newest once per page load (the *display* is
  chronological-ascending-with-running-total for readability, distinct from
  Stock's newest-first movement log convention — called out explicitly since
  the two modules intentionally differ here and that's not an inconsistency
  to "fix").
- Invoice-type entries (`reason: 'invoice'`) link to `invoice.html?id=`.
- **"+ Old Balance"** button — inline form (amount, optional note), posts a
  `due` entry with `reason: 'old-balance'`. For one-time backfill of debt
  that existed before this system.
- **"+ Cash Paid"** button — inline form (amount, optional note), posts a
  `payment` entry with `reason: 'cash-paid'`. For payments collected outside
  the invoice flow (e.g., customer pays down their account in person,
  unrelated to a specific new invoice).

### `invoice.html?id=`

- Read-only render of one invoice's stored snapshot: customer, date,
  mobile, lorry, items table, charges breakdown, total. Plain data table,
  not the print-slip layout (see Non-goals).

## WhatsApp sending (Phase 2)

- **New sibling directory** `whatsapp-bot/` under the Narayani Steels
  project root (mirrors Aaral's `whatsapp-bot/` structure/naming so Vansh's
  mental model transfers across clients), running its own long-lived
  Node process with `whatsapp-web.js`.
- **Session setup:** one-time QR-code pairing on the shop PC, to a number
  dedicated to this purpose (not a personal phone — reduces blast radius if
  anything ever goes wrong with the session).
- **Decoupled send path**, matching Aaral's proven shape: the billing
  server's "Send via WhatsApp" button does a local HTTP call (e.g.
  `POST http://127.0.0.1:<bot-port>/send-invoice` with `{phone, pdfBase64,
  filename, message}`) to the bot process, which does the actual
  `client.sendMessage(chatId, new MessageMedia(...), {caption})`. The
  billing server never touches the WhatsApp session directly.
- **New piece not present in Aaral's reference implementation:** server-side
  PDF rendering. Aaral's dashboard apparently already produces a
  `pdfBase64` for its own invoices; Narayani's Chitti today is
  browser-print-only (`window.print()`), so the billing server needs its own
  render step — headless Chrome rendering the invoice slip HTML to PDF, the
  same technique already used repeatedly in this project's verification
  workflow (`--headless=new --print-to-pdf`), just invoked server-side
  on-demand instead of manually from a terminal.
- **Operational guardrails, carried over from real incidents on other
  clients' `whatsapp-web.js` bots** (non-negotiable, not optional
  hardening):
  - Startup-timestamp guard — the bot must never act on messages/chats that
    existed before its own process start, to avoid replaying history on
    reconnect.
  - Outbound-only, single-purpose bot: it sends invoices, it does not need
    to read/react to incoming messages at all, which sidesteps most of the
    historical-replay and self-sent-message (`message_create` vs `message`)
    complexity that chat-bots on other client projects have hit — this bot
    only calls `sendMessage`.
  - Never run two instances against the same session directory — confirmed
    real logout/ban incident on another client's bot.
  - No artificial rate/daily send caps are being removed or bypassed —
    since sends are manual/on-demand (a shop worker clicking a button per
    invoice), volume is inherently low and human-paced, not a bulk-sender
    pattern.
  - Session directory lives under `whatsapp-bot/`, is added to
    `.gitignore` (never committed — contains live auth material).

## Error handling

- All `/api/ledger/*` routes validate input server-side and return `4xx`
  with `{ error }` on bad input, `404` for unknown customer/invoice IDs —
  same conventions as `/api/stock/*`.
- `POST /api/ledger/invoices` validates `customerId` exists before creating
  anything; if it doesn't, the whole request fails atomically (no partial
  invoice-without-ledger-entry state).
- A corrupted `ledger.json` disables `/api/ledger/*` with a `500` but leaves
  the rest of the app (billing, Stock) working — same guard pattern as
  `stockStore`'s `_stockInitError`.
- Phase 2: if the WhatsApp bot process is unreachable when "Send via
  WhatsApp" is clicked, the billing server's fetch to it fails fast (short
  timeout) and the UI shows a clear inline error rather than hanging —
  sending is never silently dropped without feedback.

## Testing

- **Unit (`app/ledgerStore.test.js`, Node's built-in `node --test`, matching
  Stock's existing test setup — no new dependency):** customer CRUD,
  invoice creation with correct due-entry math (explicitly test that old
  balance is never double-counted), old-balance/cash-paid manual entries,
  balance computed correctly across a mixed sequence of dues and payments,
  unknown-customer-id error cases.
- **Integration (`app/server.test.js`, extended):** each `/api/ledger/*`
  route's happy path + 4xx/404 cases, using a temp `ledger.json` per test
  run — same pattern already established for `/api/stock/*`.
- **E2E (Claude-in-Chrome, matching this project's existing manual
  verification convention, no automated browser test framework):** add
  customer → link on Chitti → confirm Old Balance auto-fills read-only →
  generate → Record Invoice → confirm ledger entry appears on
  `customer.html` with correct running balance → confirm Advance posted as
  a separate payment entry → view invoice → confirm Quotation/Challan never
  show a Record Invoice button.
- Phase 2 E2E is necessarily more manual (a real QR scan, a real WhatsApp
  send) and will be verified live during implementation, not scripted.
