# CoKarma Payment Reconciliation Bridge — Design

## Problem

Our client is an investor in CoKarma, a co-working space with 2000+ customers. Payments to CoKarma arrive via UPI, bank transfer, or cash, often from a different name than the actual customer (e.g. a friend or family member pays on the customer's behalf). Our client cannot integrate with CoKarma's own systems — they're an actively running organization outside his control. He needs a standalone bridge that tells him, reliably, whose payment is whose, without requiring any change on CoKarma's side.

## Approach

A WhatsApp bot that customers self-report payments to. Identity comes from the customer's registered WhatsApp number (a channel our client controls), not from the payer name on the transaction — which solves the "friend paid on my behalf" problem directly. The bot captures a structured claim (amount + proof) and routes it to a human admin, who manually checks the real bank/UPI account and confirms or rejects. No OCR or automated bank-statement matching in this version — verification is a human-in-the-loop step for now.

Built as a standalone project (separate codebase, database, and WhatsApp account from the Jalan Group backend — different client, different business), reusing the same proven stack and stability fixes as the existing Jalan Group WhatsApp bot: Node.js + Express + PostgreSQL + whatsapp-web.js under PM2.

### Why whatsapp-web.js over the official WhatsApp Cloud API

The client explicitly wants no subscription or per-message cost. whatsapp-web.js links to a real WhatsApp account (personal or business) via QR scan and is free beyond the cost of a machine running headless Chrome — which the client already has (the same office server pattern as Jalan Group). The official Cloud API has a limited free tier and bills per conversation beyond it, plus requires Meta Business verification and pre-approved templates for business-initiated messages (like reminders). Given the cost constraint and that reminders/notifications will be frequent at 2000+ customers, whatsapp-web.js is the right fit.

Tradeoff accepted: whatsapp-web.js is an unofficial library (browser automation), carrying some risk of number rate-limiting/bans and requiring a permanently-running machine. This is judged acceptable given the cost constraint and the precedent of the Jalan Group bot running stably on this stack.

### Number migration path

Development and testing happen on the developer's (Vansh's) personal WhatsApp number, linked via QR. Before production handoff, the bot is re-linked to the client's own number by scanning a new QR — nothing in the codebase references a specific phone number, so this is an operational step, not a code change.

## Architecture

- **Bot process**: whatsapp-web.js client, PM2-managed, running on the client's office server (headless Chrome + Node, same deployment pattern as the Jalan Group bot).
- **Backend**: Node.js + Express + PostgreSQL. One process handles both the WhatsApp message handling and any future HTTP surface (e.g. an admin dashboard), sharing the same database and verification functions.
- **Reused reliability patterns** from the Jalan Group bot: `safeSend` (uses `client.sendMessage` instead of `msg.reply`, with timeout), keepalive polling (`client.getState()` every 15s) to prevent Chrome throttling, Chrome/Singleton-lock cleanup on startup and exit, LID-to-real-number resolution for admin identification.

## Data model (PostgreSQL)

```
customers
  id                    uuid PK
  name                  text
  phone_number          text (normalized, unique)
  cokarma_membership_id text NULL   -- filled in once matched/linked, null if unlinked
  created_at            timestamptz

dues
  id               uuid PK
  customer_id      uuid FK -> customers
  description      text     -- e.g. "July 2026 membership"
  amount_due       numeric
  due_date         date
  import_batch_id  uuid FK -> dues_imports
  created_at       timestamptz

dues_imports
  id            uuid PK
  filename      text
  imported_by   text        -- admin phone number
  imported_at   timestamptz
  row_count     int
  unmatched_count int

payment_claims
  id              uuid PK
  customer_id     uuid FK -> customers
  amount_claimed  numeric
  proof_type      text        -- 'screenshot' | 'utr_text' | 'cash'
  proof_reference text NULL   -- UTR/reference number, or stored image path
  status          text        -- 'pending' | 'confirmed' | 'rejected'
  reported_at     timestamptz
  reviewed_by     text NULL   -- admin phone number
  reviewed_at     timestamptz NULL
  review_note     text NULL

admins
  id            uuid PK
  phone_number  text unique
  name          text
  active        boolean default true
```

**`customer_balances`** is a SQL view, not a stored table:
```sql
CREATE VIEW customer_balances AS
SELECT
  c.id AS customer_id,
  c.name,
  COALESCE(SUM(d.amount_due), 0) AS total_due,
  COALESCE(SUM(pc.amount_claimed) FILTER (WHERE pc.status = 'confirmed'), 0) AS total_confirmed,
  COALESCE(SUM(d.amount_due), 0) - COALESCE(SUM(pc.amount_claimed) FILTER (WHERE pc.status = 'confirmed'), 0) AS balance
FROM customers c
LEFT JOIN dues d ON d.customer_id = c.id
LEFT JOIN payment_claims pc ON pc.customer_id = c.id
GROUP BY c.id, c.name;
```
Computing balance as a view (rather than a maintained running total) guarantees it can never drift out of sync with the underlying dues/claims rows.

## Core flows

### 1. Customer registration (implicit)
An unknown number messaging the bot triggers a short registration: bot asks for name, creates a `customers` row with `cokarma_membership_id = NULL`. This row is flagged (via a `PENDING LINKS` admin view/command) for the admin to match against CoKarma's customer list later, if/when the client obtains one. Registration is not blocked on having a preloaded customer list — the system works whether or not that list ever materializes.

### 2. Preloading customers / dues (if the client obtains CoKarma's list)
Admin sends `IMPORT` in WhatsApp and attaches a CSV/Excel export. Rows are matched to existing `customers` by phone number or membership ID; unmatched rows either create new customer records or are reported back to the admin as unmatched (not silently dropped), along with a count in `dues_imports`.

### 3. Reporting a payment (guided flow)
State machine (same `pendingConfirmations`-style Map pattern as the Jalan bot), triggered by a keyword like `PAID` or automatically when the bot detects payment-related language:
1. Bot: "How much did you pay?" → customer replies with an amount.
2. Bot: "Send a screenshot of the payment, or type the UPI reference/UTR number, or reply CASH if you paid in cash."
3. Bot confirms the summary back to the customer and creates a `payment_claims` row with `status = 'pending'`.
4. Bot broadcasts the claim to all `admins` where `active = true`: customer name/phone, amount, proof (image forwarded or UTR/cash text), and the claim ID.

### 4. Verification (human-in-the-loop)
Admin manually checks the real bank/UPI account off-system, then replies in WhatsApp:
- `CONFIRM <id>` → calls `confirmClaim(claimId, adminPhone)` → sets `status = 'confirmed'`, `reviewed_by`, `reviewed_at`.
- `REJECT <id> <reason>` → calls `rejectClaim(claimId, adminPhone, reason)` → sets `status = 'rejected'` with the note.

Both functions are plain internal functions, not tied to the WhatsApp transport — a future web dashboard can call the same functions via an HTTP endpoint without any change to this logic.

### 5. Admin utility commands
- `PENDING` — lists open (`status = 'pending'`) claims older than a few minutes.
- `BALANCE <name or phone>` — looks up `customer_balances` for a match.
- `PENDING LINKS` — lists customers with `cokarma_membership_id IS NULL`, for manual reconciliation against CoKarma's records.

## Error handling

- **Duplicate UTR**: before inserting a new claim, check whether `proof_reference` already exists on another claim with `proof_type = 'utr_text'`. If so, flag it in the admin notification as a possible duplicate/fraud rather than silently accepting it.
- **Stale pending claims**: a scheduled job (node-cron, matching the Jalan bot's existing pattern) sends admins a digest of claims pending review for more than 24 hours, so nothing rots silently.
- **Incorrect amount reported**: admin rejects with a reason; customer is expected to re-report. An `EDIT <id> <amount>` admin shortcut is out of scope for v1 but noted as a likely v1.1 addition if rejection/re-report proves annoying in practice.
- **Bot/Chrome crash**: same PM2 auto-restart + Chrome/Singleton-lock cleanup on startup and process exit, proven on the Jalan Group bot.
- **Unmatched/unlinked customer**: never blocks a claim from being created — an unlinked customer can still report and be verified; linking to a CoKarma membership ID is a separate, optional reconciliation step admins do via `PENDING LINKS`.

## Testing

- Manual QA using the developer's number as the customer/tester and a small, config-driven `admins` table (initially the developer + two test numbers — e.g. family members — marked `active = true`, removed before production handoff).
- Walk through: registration of a new number, all three proof types (screenshot, UTR text, cash), confirm and reject paths, balance correctness after confirmation, duplicate-UTR detection, and the unmatched/unlinked-customer path.
- The `customer_balances` view and the `confirmClaim`/`rejectClaim` functions get automated (integration-level) tests, since correctness of money balances is the one thing that must not regress silently. The WhatsApp conversational flows follow the same manual-QA precedent already established for the Jalan Group bot — no automated test harness for the chat state machine itself.

## Out of scope for this version

- Automated bank-statement/UPI transaction matching or OCR of payment screenshots (verification is manual for now).
- A web dashboard (the verification functions are designed to support one later without rework, but none is built now).
- Multi-admin role permissions beyond a flat active/inactive admin list.
- Official WhatsApp Cloud API migration (may happen later; not part of this build).
