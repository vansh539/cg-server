# Aaral Marketing — WhatsApp Bot + Chitti/Invoice Dashboard Design

## Problem

Aaral Marketing (cement trading) needs the same self-reported WhatsApp payment
reconciliation bridge already built for CoKarma, plus something CoKarma
doesn't need: a running, per-customer ledger (long-standing credit
relationships) *and* a day-to-day Chitti/invoice tool for instant-payment
walk-in sales — both visible to the client from anywhere, not just the office
WiFi.

This is the second real client for [`payment-ledger-core`](../../../../../packages/payment-ledger-core/),
built specifically to be reused this way. The WhatsApp bot side is a
mechanical duplication of CoKarma's bot per the already-documented
"New-client bootstrap flow" (see CoKarma's
`docs/superpowers/specs/2026-07-05-reusable-ledger-core-and-balance-notifications-design.md`).
The new design work is the Chitti/invoice tool, the ledger dashboard, and the
notification wiring between them and the bot.

## Non-goals

- No GST/tax fields, no invoice numbering series beyond a simple incrementing
  number — this is an informal Chitti, not a statutory tax invoice.
- No product catalog. Every line item (Particulars, Grade, Vch, Qty, Rate) is
  typed freehand, same as Narayani's tool — Aaral's inventory doesn't
  warrant a pre-loaded list yet. Revisit only if this becomes a real
  bottleneck in practice.
- No weight column/section — cement is sold by bag/qty, not weight (unlike
  Narayani's steel invoices).
- No customer self-service portal. The dashboard is for Aaral's staff/owner
  only; customers only ever interact via WhatsApp.

## Architecture

```
Clients /Aaral Marketing/
├── whatsapp-bot/        (duplicate of CoKarma's bot — see Bootstrap section)
└── dashboard/            (new)
    ├── server.js         (Express, licensed — same shape as Narayani's app/)
    ├── public/            (Chitti form + print view, ledger views)
    └── migrations-aaral/  (Aaral-only tables, run after payment-ledger-core's own)
```

Both processes run under PM2 on Aaral's existing 24/7 office server and read
the same `aaral_bridge` Postgres database via `payment-ledger-core` (declared
as a `file:../../../packages/payment-ledger-core` dependency in both).
Neither process owns the other — the dashboard never touches the WhatsApp
session directly (see **Notifications** below for why).

**Remote access:** a Cloudflare Tunnel exposes the dashboard on its own
subdomain, same mechanism already in use for Jalan Group's backend, so your
client can check a ledger from his phone without being on the office network.

**Licensing:** reuse the existing `license.key` + expiry-check + renewal
prompt pattern already shipped for Narayani Steels and Sai Krupa Jewellers —
1-year term, renewal screen on expiry, no new licensing mechanism to build.

## Bootstrap (WhatsApp bot side)

Follows CoKarma's documented runbook as-is:

1. Copy CoKarma's bot repo as the starting template; swap client-specific
   message copy.
2. `npm install`, `payment-ledger-core` wired in as a `file:` dependency.
3. New `.env`: `DB_NAME=aaral_bridge`, own WhatsApp session path, Aaral's
   admin number(s).
4. `createdb aaral_bridge`; run `payment-ledger-core`'s `migrate(pool)`.
5. Seed admin(s).
6. Run the opening-balance Excel/CSV import (`IMPORT`) before going live, so
   no existing Aaral customer shows a `0` balance that should be nonzero.
7. Start the bot, scan QR.

No design changes needed here — this is execution, not a new subsystem.

## Data model

`payment-ledger-core`'s tables stay exactly as they are — no cement-specific
columns leak into the shared package. Aaral gets two additional tables of its
own, applied by a small migration runner in `dashboard/migrations-aaral/`
that runs *after* the package's own migrations:

```sql
-- invoices
id                uuid PK
invoice_number    integer, unique, auto-incrementing per Aaral
customer_id       uuid, nullable FK -> customers(id)   -- null for walk-ins
paid_now          boolean
unloading_charge  numeric(12,2), nullable
subtotal          numeric(12,2)
total             numeric(12,2)                        -- subtotal + unloading_charge
created_by        text                                  -- admin phone/name
created_at        timestamptz

-- invoice_items
id                uuid PK
invoice_id        uuid FK -> invoices(id)
s_no              integer
particulars       text
grade             text
vch                text
qty               numeric(12,2)
rate              numeric(12,2)
amount            numeric(12,2)                        -- qty * rate
```

`invoices.total` is what gets posted to the ledger when a customer is
attached (see next section) — the unloading charge rides along as part of
the same due/payment, not a separate ledger line.

## Chitti/invoice flow

1. Staff opens **New Chitti**. Optionally searches and picks an existing
   customer (name/phone, reuses `payment-ledger-core`'s
   `findByNameOrPhone`) — or leaves it blank for a walk-in.
2. Adds line items freehand: Particulars, Grade, Vch, Qty, Rate. Amount is
   computed client-side (`qty * rate`) and re-validated server-side on save.
3. Optional **Unloading charges** field, added into the total once, not
   per line item.
4. Running subtotal and grand total shown live as items are added.
5. Toggle: **Paid now** (default on) vs **On account** — hidden entirely if
   no customer is attached, since a walk-in with no ledger customer has
   nothing to post against.
6. **Save & Print**:
   - Always: `invoices` + `invoice_items` rows are written, invoice number
     assigned, printable Chitti rendered (S No / Particulars / Grade / Vch /
     Qty / Rate / Amount table, subtotal, unloading charge, total — visual
     language matches Narayani's Chitti, minus the weight section).
   - If a customer is attached: a `dues` row is posted for `invoices.total`
     (the `INVOICE ISSUED` event). If **Paid now**, a matching, pre-confirmed
     `payment_claims` row is inserted in the same DB transaction (the
     `PAYMENT RECEIVED` event) — net balance change is ₹0, but both events
     are visible in that customer's ledger history as "Invoice #N" and
     "Paid — Invoice #N."
   - If no customer is attached (true walk-in): nothing is posted to the
     ledger at all — print-only, as agreed.

## Ledger dashboard

- **Customer list** — searchable by name/phone, each row shows current
  balance from `customer_balances`, color-coded (settled / customer owes /
  customer in credit).
- **Customer detail** — full chronological ledger: every invoice and every
  payment for that customer, running balance shown after each line
  (bahi-khata style), sourced from `dues` + `payment_claims` joined by
  `customer_id`, ordered by timestamp.

## Notifications

Two ledger-affecting events, from either entry point (dashboard Chitti save,
or WhatsApp `CONFIRM`), notify **both** the customer and Aaral's admin
number(s) with the new balance:

- `INVOICE ISSUED` — customer: *"New invoice #N for ₹X. Your balance is now ₹Y."* Admin: *"Invoice #N (₹X) issued to \<customer>. Balance: ₹Y."*
- `PAYMENT RECEIVED` — customer: *"Payment of ₹X received, thank you! Balance: ₹Y."* Admin: *"Payment of ₹X received from \<customer>. Balance: ₹Y."* (This path already exists for WhatsApp-side `CONFIRM`; new here is that Chitti-triggered payments fire the same message.)

Since only the WhatsApp bot process may safely own the `whatsapp-web.js`
session (see CoKarma's documented shutdown-handling history — a second
process touching that session is not something to risk), the dashboard never
talks to WhatsApp directly. Instead it calls a small `127.0.0.1`-only HTTP
endpoint the bot process exposes:

```
POST /notify  { phone, message }  -> { sent: true } | { sent: false, reason }
```

Same shape as the existing PaddleOCR sidecar pattern, just inverted (dashboard
calls bot instead of bot calls OCR). If the bot process is down, the
dashboard's Chitti/payment action still succeeds and is saved — the
notification attempt is logged as failed, never blocking the underlying
transaction. This mirrors the existing "secondary enrichment degrades
gracefully" philosophy already used for OCR and balance-line lookups.

## Error handling

- Invoice save is one DB transaction (`invoices` + `invoice_items` + optional
  `dues`/`payment_claims`) — if any part fails, nothing is written and the
  form shows an error, no partial Chitti.
- Notification failures never roll back or block the invoice/payment save.
- Same input validation posture as `payment-ledger-core`'s existing dues
  import: reject non-positive amounts, missing required fields, before
  hitting the DB.

## Testing

- `invoice_items` amount calculation (qty × rate, and rounding).
- Invoice total = subtotal + unloading charge.
- Customer-attached + paid-now → both `dues` and `payment_claims` rows
  created, `customer_balances` net-zero change, both visible in ledger
  history.
- Customer-attached + on-account → only `dues` row created, balance
  increases.
- No customer (walk-in) → no `dues`/`payment_claims` row, invoice still
  saved and printable.
- `/notify` unreachable → invoice/payment save still succeeds, failure
  logged.
