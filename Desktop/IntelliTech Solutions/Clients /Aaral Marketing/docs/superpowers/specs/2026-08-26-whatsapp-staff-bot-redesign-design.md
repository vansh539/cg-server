# WhatsApp bot redesign: staff-only ledger assistant

**Date:** 2026-08-26
**Status:** approved by Vansh in chat, proceeding straight to implementation plan per his explicit request

## Why

The WhatsApp bot currently exists to let *customers* self-report a payment
(reply PAID → amount → screenshot/UTR/cash → OCR-assisted verification →
admin CONFIRM/REJECT). Vansh wants to flip this: staff will now text the bot
directly to record a payment the moment it happens ("Received 15000 payment
from Shyam miyapur today"), the bot creates the ledger entry itself and
messages the customer a confirmation. Customers no longer interact with the
bot at all. This makes the entire self-report/OCR/claim-review pipeline dead
weight, and it needs to be removed, not just left dormant, since it's the
thing standing in the way of a much simpler, staff-only command surface.

Four asks, one coherent redesign:
1. Free-text payment recording ("Received 15000 from Shyam ... today").
2. Remove OCR entirely.
3. Bot becomes staff-only (employees + admins); drop PAID/HELP and all
   customer-facing text.
4. Staff can fetch a customer's ledger on request.

## Scope: what's being removed

- `PAID` / `HELP` triggers, the by-chat registration flow ("what's your
  name?"), `awaiting_amount` / `awaiting_proof` pending states.
- The OCR service in full: `whatsapp-bot/ocr-service/` (Python/PaddleOCR
  worker, its venv, `server.py`, README), and the OCR-only helpers in
  `flows.js` (`extractAmountMatch`, `extractTxnId`, `extractPaymentDate`,
  `isScreenshotDateStale`, `screenshotAgeDays`) plus every OCR-related code
  path in `bot.js` (service spawn/health-wait/shutdown, the OCR fetch call
  inside `awaiting_proof` handling).
- `CONFIRM` / `REJECT` / `PENDING` / `PENDING LINKS` admin commands and their
  handlers — these exist only to review claims customers submitted
  themselves; once nothing creates an unconfirmed claim, they have nothing
  to act on.
- The 9am stale-claims digest cron (same reason — no more claims sit
  pending).
- `TEST_MODE_ALLOWED_NUMBERS` and its gating logic — it existed to restrict
  who could trigger a reply *during testing*; under this redesign,
  staff-only is the permanent production rule, not a test-mode carve-out, so
  the same restriction is now always true and the separate mechanism is
  redundant.

**Kept as-is, untouched:** the `admins` table and everything that reads it
(`notifyAdmins`, `/notify-admins` bridge endpoint used by the watchdog's
crash-loop alerting, the invoice/payment activity broadcasts in
`dashboard/src/routes/invoices.js` and `payments.js`). This table is part of
the shared `payment-ledger-core` package used by other clients (CoKarma, Sai
Krupa) and serves an unrelated purpose — "who gets pinged about business
activity" — that has nothing to do with WhatsApp bot command authorization.
Renaming or repurposing it would put other clients' deployments at risk for
no benefit here. `BALANCE <name>` and `IMPORT` (dues import) are kept.

## Staff identity & authorization

The bot has never had an "employee" concept — only the standalone `admins`
phone table (now reserved for broadcasts, see above). Staff command access
is now gated through the dashboard's own login identity:

- New migration `dashboard/migrations-aaral/007_add_staff_phone.sql`:
  `ALTER TABLE dashboard_users ADD COLUMN phone_number text UNIQUE;`
  Nullable at the DB level (existing accounts — admin1, Ankit, Sumit, Manoj,
  Vamshi — have no phone number yet); the dashboard's "Add User" form makes
  it mandatory going forward, existing accounts get theirs filled in via a
  new edit action (see Dashboard changes below).
- New `resolveStaffUser(waNumber)` in `whatsapp-bot/src/whatsapp/bot.js`:
  queries `dashboard_users` directly (the bot already holds a raw
  `payment-ledger-core/db` connection) by last-10-digit phone match,
  `active = true`. Returns `{ id, role, displayName }` or `null`.
- This replaces `isAdmin()` as the single gate for every bot command. A
  message from a number that doesn't resolve to an active staff user is
  **always** silently ignored — no exceptions, no allowlist override.
- Role split: `IMPORT` stays admin-only (bulk data mutation, matches the
  dashboard's existing "employees do everything except Delete/Void/Updates"
  convention). `BALANCE`, the new payment-recording flow, and the new
  `LEDGER` command are available to both roles.

## Payment-recording flow

Trigger: any message from a resolved staff user that isn't a recognized
structured command (`BALANCE`, `LEDGER`, `IMPORT`) and isn't a continuation
of a pending multi-turn exchange gets run through a new parser module,
`whatsapp-bot/src/whatsapp/paymentIntent.js`. This is the *only* free-text
surface in the redesign — `LEDGER`/`BALANCE`/`IMPORT` stay structured
commands, deliberately, to keep parsing risk contained to the one place that
actually needs it.

Parsing, all local/deterministic (no external API, no local model — see
"Alternatives considered"):
- **Amount**: the existing ₹/comma-aware numeric regex pattern already used
  elsewhere in this codebase.
- **Date**: `chrono-node` (new dependency, ~200KB, pure JS, no network) —
  handles "today", "yesterday", "3 days ago", "15th Aug", explicit
  dd-mm-yyyy, etc. Defaults to today if nothing parses, since the ask
  explicitly wants backdating to be possible but not mandatory to state.
- **Customer**: fuzzy-match message tokens/token-pairs against
  `payment-ledger-core/ledger/customers.js`'s existing `findByNameOrPhone`
  (`ILIKE '%term%'`), trying each capitalized word and adjacent word-pair in
  the message as a candidate search term, then deduping/ranking by longest
  matched substring.
- **Method**: keyword scan for cash/gpay/g pay/upi/bank/transfer/neft/imps,
  mapped to `payment-ledger-core`'s existing `VALID_METHODS`
  (`cash`/`gpay`/`bank_transfer`).

If amount or customer can't be resolved at all, the bot doesn't guess — it
replies with the available commands (`BALANCE <name>`, `LEDGER <name>`,
`IMPORT`, or "report a payment like: received 5000 from Ramesh"). If the
customer match is ambiguous (0 matches or 2+ equally-close matches), the bot
replies with a numbered list of candidates (or asks for the exact registered
name on zero matches) and sets a pending state awaiting the staff member's
reply — reusing the bot's existing `pendingConfirmations` state-machine
mechanism (`setPending`/`clearPending`/`handlePendingReply`), just with new
`pending.type` values (e.g. `awaiting_customer_clarification`,
`awaiting_payment_method`, `awaiting_payment_confirm`) plumbed into the
existing switch.

If payment method isn't stated in the message, the bot always asks
explicitly (Cash / GPay / Bank?) rather than defaulting — money-handling
detail worth getting right every time, not guessing on.

Once amount + customer + date + method are all resolved, the bot shows a
summary and waits for explicit confirmation before writing anything:

> "Record ₹15,000 from Shyam Miyapur Traders, dated 26-Aug, Cash — balance
> becomes ₹30,000. Reply YES to confirm, NO to cancel."

On `YES`: calls a new shared function lifted out of dashboard's local
`recordPayment` (currently `dashboard/src/payments.js`, ~20 lines, already
generic — `customerId`/`amount`/`method`/`date`/`createdBy`, no Aaral-specific
logic in it at all) into `payment-ledger-core/ledger/payments.js`, so both
apps call the exact same DB-writing code instead of drift-prone duplicates.
`dashboard/src/payments.js` is refactored to call the shared version instead
of keeping its own copy. `createdBy` is stamped as
`whatsapp:<staff display name>` so the activity trail stays attributable the
same way dashboard-originated payments are.

After a successful write, the bot sends two messages directly (it already
owns the WhatsApp client — no cross-process hop needed for plain text):
1. To the **customer**: "Payment received: ₹15,000 on 26-Aug. Balance:
   ₹X" (plain text, no PDF — matches what was asked for).
2. To **staff**: confirmation that it's recorded.

On `NO` or timeout: the pending state is cleared, nothing is written.

## Ledger-fetch flow (`LEDGER <name>`)

Structured command, same shape and same ambiguous-match handling as the
existing `BALANCE <name>`. On a unique match, the bot calls a new
internal-only dashboard endpoint:

`POST /internal/bot/ledger-pdf` (`dashboard/src/routes/`, mounted in
`server.js` **before** the `requireSession` middleware, alongside `auth.js`)
- Body: `{ customerId }`.
- Reuses the already-existing `fetchLedgerEntries` (from `ledger.js`) and
  `renderLedgerPdf` (from `ledgerPdf.js`) — no new PDF-rendering code
  anywhere; dashboard remains the single place that owns Puppeteer and
  `chittiStyles`/`ledgerTemplate`.
- Returns `{ pdfBase64, filename, balanceLine }` as JSON.

**Security note, not present in the original ask but necessary**: dashboard
binds `0.0.0.0` (required for the 4-5 office laptops), so an unauthenticated
route here would be reachable by anyone on the office WiFi, not just the
bot process on the same machine. Gated by a shared-secret header
(`X-Bot-Internal-Secret`, checked against a new `BOT_INTERNAL_SECRET` env
var present in both apps' `.env`/`.env.production`) rather than relying on
network binding. Handled the same way the backup passphrase was: placeholder
in `.env.production` (never a real secret committed to the deploy repo),
real value typed directly onto the office PC by Vansh.

The bot builds a `MessageMedia` from the returned base64 (same pattern
already used in `notifyAdmins()` for attaching claim screenshots) and sends
it to whichever staff member asked, in their own chat — **not** to the
customer. New env var on the bot side: `DASHBOARD_INTERNAL_URL` (defaults to
`http://127.0.0.1:3400`, same machine).

## Dashboard Users page changes

`dashboard/public/users.html` + `dashboard/src/routes/users.js`:
- "Add User" form gains a mandatory phone number field.
- New edit-phone action on each existing user row (new
  `PATCH /users/:id/phone` route, `requireAdmin`, validates E.164-ish
  digits, enforces the same `UNIQUE` constraint with a friendly duplicate
  error).
- New real hard-delete action (`DELETE /users/:id`, `requireAdmin`):
  blocked with a clear error if the target has any `activity_log` rows
  (`user_id` reference — `ON DELETE SET NULL`, so there's no FK risk, but a
  user with real history should be deactivated, not erased), and blocked
  from removing the last active admin (same guard `toggle-active` already
  enforces, extended to cover delete too).

## Testing

Real-Postgres-backed, matching this codebase's existing convention (no
mocked DB):
- `paymentIntent.test.js`: amount/date/customer/method extraction, including
  ambiguous- and zero-match cases, and a range of `chrono-node` date
  phrasings.
- Multi-turn state machine: clarify → method-ask → confirm → commit → both
  outbound messages sent; NO/timeout correctly writes nothing.
- `payment-ledger-core/ledger/payments.js`: the lifted `recordPayment`,
  moved test coverage from `dashboard`'s existing payments tests.
- `dashboard`'s new internal ledger-pdf route: secret-header enforcement
  (missing/wrong secret → 401/403), correct PDF bytes returned for a real
  customer.
- Users-page phone CRUD, duplicate-phone rejection, delete-blocked-on-history,
  delete-blocked-on-last-admin.
- OCR-specific tests removed from `flows.test.js` along with the code they
  tested.

## Alternatives considered (parsing approach)

- **LLM-assisted (Claude API)**: robust to casual phrasing/typos, but adds a
  new external dependency (API key, network call per message, per-message
  cost) to an app that has otherwise never made an outbound AI call.
  Rejected for now — not needed once dates are handled by `chrono-node`.
- **Local model (Ollama + small model) on the office PC**: avoids API cost
  and works offline, but adds real operational weight (a second
  heavyweight local service, model files, another thing to keep alive) to a
  machine with a documented history of Puppeteer/Chrome resource flakiness
  (orphaned processes, cold-boot stalls, `GPU process exited unexpectedly`).
  Rejected — the actual gap (date format variety) is fully covered by
  `chrono-node` without any of that risk.
- **Deterministic regex + chrono-node (chosen)**: zero new services, zero
  API keys, zero added load on a fragile box, covers the stated need.
  Trade-off: unusual phrasing outside what the parser recognizes falls back
  to the clarifying-question flow rather than silently guessing — treated as
  a feature (money-safety), not a gap.

## What's needed from Vansh before this goes live

- Real phone numbers for admin1, Ankit, Sumit, Manoj, Vamshi (entered via
  the new Users page edit-phone action).
- `BOT_INTERNAL_SECRET` typed directly onto the office PC's `.env`/
  `.env.production` for both apps (same handling as the backup passphrase —
  never committed as a real value).
- A real end-to-end WhatsApp send test after deploy (payment confirmation to
  a real customer number, and a `LEDGER` fetch) — this redesign doesn't
  close the long-standing "real send never independently confirmed" item on
  its own; it's a good opportunity to finally close it.
