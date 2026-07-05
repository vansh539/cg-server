# Reusable Ledger Core + Balance-on-Confirm Notifications — Design

## Problem

Two related gaps:

1. When an admin `CONFIRM`s a payment claim, the customer gets told the payment was confirmed, but not their updated balance. They have to separately ask an admin to `BALANCE <name>` to find out where they stand.
2. A second IntelliTech client needs the same payment-reconciliation bot (self-report payment → admin verifies → ledger updates), running against their own Postgres DB and WhatsApp number, in their own repo. Unlike CoKarma (which started every customer at zero), this client has pre-existing balances that must be seeded from an Excel file, itemized per customer, before the bot goes live.

CoKarma's ledger already exists as `dues` (charges) + `payment_claims` (confirmed = payments) feeding a `customer_balances` SQL view (`balance = total_due - total_confirmed`) — this is not a from-scratch build. The work is (a) surfacing that balance at the right moment, and (b) extracting the CoKarma-specific parts of the ledger code into a reusable package so client #2 doesn't fork-and-diverge from CoKarma's bot.

## Approach

### 1. Balance-on-CONFIRM message

After `confirmClaim` succeeds, look up the customer's balance (`getBalanceByCustomerId`) and append it to the existing confirmation message:
- Balance ≤ 0: `"You're all settled up!"`
- Balance > 0: `"Remaining balance: ₹<balance>"`

Fires synchronously, in the same `CONFIRM` handler turn — no batching. `REJECT` is unaffected (no balance changed).

### 2. Extract a reusable core package

Everything CoKarma-specific is confined to: the `cokarma_membership_id` column name, a hardcoded `'CoKarma dues'` default description in the import parser, the dev-default DB name, and WhatsApp message copy. Everything else — `customers`, `claims` (dedup, confirm/reject), `balances` (the view + queries), the Postgres `query` wrapper, and the dues-import logic — is already business-agnostic.

Extract into a new local package:

```
~/Desktop/IntelliTech Solutions/packages/payment-ledger-core/
├── package.json          (name: "payment-ledger-core", no registry publish — consumed via file: dependency)
├── db.js                 (moved from src/db/db.js, unchanged — reads standard DB_* env vars)
├── migrate.js            (new — the migration *runner*, moved out of each client's scripts/migrate.js)
├── migrations/           (moved from src/db/migrations/, with the rename below)
├── ledger/
│   ├── customers.js      (moved; cokarma_membership_id → external_ref_id)
│   ├── claims.js         (moved, unchanged)
│   └── balances.js       (moved; cokarma_membership_id reference updated)
└── imports/
    └── duesImport.js     (moved; adds parseDuesXlsx, generic description handling)
```

`src/whatsapp/` (bot.js, flows.js) stays in each client's own repo — WhatsApp session handling, admin phone numbers, OCR wiring, and all customer-facing message copy are genuinely per-client.

**Schema change:** `customers.cokarma_membership_id` → `customers.external_ref_id`, via `ALTER TABLE customers RENAME COLUMN cokarma_membership_id TO external_ref_id`. This is a generic "however this business identifies the customer externally" field (membership ID, account number, customer code, etc.) — no business name baked into the shared schema.

**Package consumption:** each client repo takes `payment-ledger-core` as a `file:../../packages/payment-ledger-core` dependency (or `npm link` during local dev) and requires from it (`require('payment-ledger-core/ledger/customers')`, etc.) instead of relative `../ledger/...` paths. CoKarma itself becomes the first consumer of the package rather than keeping its own copy — no fork.

### 3. Excel opening-balance import

Client #2's opening balances are itemized per customer (multiple line items each, not one lump sum), which maps directly onto the existing `dues` table — no new table needed. `imports/duesImport.js` gains `parseDuesXlsx(buffer)` (using the `xlsx` npm package) alongside the existing `parseDuesCsv(csvContent)`. Both normalize to the same row shape:

```js
{ phoneNumber, name, externalRefId, description, amountDue, dueDate }
```

...and feed the same insert path (`dues_imports` batch row + one `dues` row per line item, matched/created against `customers` by phone). The bot's `IMPORT` command detects file type from the attachment's mimetype/extension and calls the matching parser — no new command needed, `.xlsx` attachments just work where `.csv` did before.

The hardcoded `'CoKarma dues'` default description is removed from the package; each row must carry its own `description` (already true of client #2's itemized Excel data), or the caller passes an explicit default — the package itself stays business-name-free.

### 4. New-client bootstrap flow

1. Copy CoKarma's repo as the starting template (bot.js, flows.js, README, message copy — customized per business).
2. `npm install`, with `payment-ledger-core` wired in as a `file:` dependency; swap local ledger/db/import requires for package imports.
3. Set up that client's own `.env` (`DB_NAME`, WA session path, admin numbers, etc.).
4. `createdb <client>_bridge`; run migrations via the package's `migrate(pool)` runner — each client's `scripts/migrate.js` becomes a two-line wrapper instead of duplicating the runner logic that lives in `scripts/migrate.js` today.
5. Seed admin(s) via a thin per-client `scripts/seed-admin.js` calling the package's customer/admin helpers.
6. **Run the Excel opening-balance import before going live**, so no real customer ever sees a `0` balance that should have been nonzero.
7. Start the bot, scan QR.

## Architecture

**New dependency (package):** `xlsx` (for `.xlsx` parsing).

**Data model:**
- Migration: `ALTER TABLE customers RENAME COLUMN cokarma_membership_id TO external_ref_id;` (applied in CoKarma's DB; the package's shipped `001_init.sql` reflects the renamed column going forward for new clients).
- No new tables. Opening balances are just `dues` rows tagged to their own `dues_imports` batch (existing `import_batch_id` mechanism already supports this — a client can distinguish "opening balance import" from a later "monthly dues import" by filename/imported_at, no schema change required).

**Modified/moved code:**
- `src/db/db.js`, `src/ledger/*.js`, `src/imports/duesImport.js`, `src/db/migrations/*.sql`, `scripts/migrate.js` → moved into `payment-ledger-core`, with the `external_ref_id` rename applied throughout.
- `src/whatsapp/bot.js`:
  - `CONFIRM` branch: after `confirmClaim` + existing customer notification, fetch balance and append the settled-up/remaining-balance line.
  - `IMPORT` branch: currently always saves the attachment as `import-<timestamp>.csv` regardless of actual type (`bot.js:582`) — this must save with the extension matching `media.mimetype` instead (reusing the same `mimeToExt` map already used for screenshot proofs), then route to `parseDuesCsv` or `parseDuesXlsx` based on that extension.
  - All `require('../ledger/...')`, `require('../db/...')`, `require('../imports/...')` → `require('payment-ledger-core/...')`.
- CoKarma's own `package.json` gains the `file:` dependency; `scripts/migrate.js` and `scripts/seed-admin.js` shrink to thin wrappers around the package.

## Data flow (CONFIRM path, updated)

1. Admin sends `CONFIRM <id>` (unchanged: lookup by ID prefix, `confirmClaim`).
2. Admin gets `"Claim #<id> confirmed."` (unchanged).
3. Customer is notified: `"✅ Your payment of ₹<amount> has been confirmed. Thank you!"` (unchanged) **+ new line**: `"You're all settled up!"` or `"Remaining balance: ₹<balance>"`.
4. `REJECT` path is unchanged — no balance involved.

## Data flow (IMPORT path, updated)

1. Admin sends an attachment with caption `IMPORT` (unchanged trigger).
2. Bot inspects the file extension/mimetype (new): `.csv` → `parseDuesCsv`, `.xlsx` → `parseDuesXlsx`. Both return the same normalized row shape.
3. Rest of the import (customer match-or-create, `dues_imports` batch row, per-row `dues` insert, unmatched-row reporting) is unchanged — shared between both formats.

## Error handling

- Balance lookup after `CONFIRM` failing (DB error) — logged, and the customer still gets the base confirmation message without the balance line (mirrors how OCR failures already degrade gracefully elsewhere in this codebase — a secondary enrichment failing never blocks the primary action).
- `.xlsx` file that fails to parse (corrupt file, unexpected sheet layout) — caught, reported to the admin the same way a malformed CSV row is already reported today (`unmatchedCount` in the import summary), not a hard failure of the whole import.
- Rows in either format missing `phoneNumber` or with an invalid `amountDue` — already handled by existing validation in `importDuesFromFile`; unchanged, shared by both parsers.

## Security & Failsafes

**Already in place, confirmed during design, no change needed:**
- Every DB query in this codebase is parameterized (`$1`/`$2`) — no SQL injection surface to introduce.
- Admin-only commands (`CONFIRM`/`REJECT`/`IMPORT`/`BALANCE`) are gated by `isAdmin(waNumber)` against the `admins` table (`active = true`), checked *before* any admin branch runs (`bot.js:343`) — a non-admin number can never reach `handleAdminCommand`, regardless of message text.
- The OCR Flask service binds to `127.0.0.1` only — not reachable from outside the host.
- Secrets are already gitignored: `.env`, `wa-sessions/` (WhatsApp auth material), `proofs/` (payment screenshots — PII), `logs/`.

**New hardening introduced by this change:**

1. **File-upload hardening (`IMPORT`).** Any attachment reaching an admin session is untrusted input:
   - Reject attachments over a size cap (5MB) before writing to disk or parsing — closes off a large-file DoS via WhatsApp media.
   - Pin `xlsx` (SheetJS) to a current, patched version at install time — older releases have known prototype-pollution/ReDoS CVEs.
   - Cap rows processed per import (10,000) — a malformed or huge sheet fails with a clear admin-facing error instead of hanging the bot process.
   - **Formula-injection sanitization**: any imported cell value starting with `=`, `+`, `-`, or `@` is neutralized (leading `'` prefix) before being stored — protects any admin who later opens exported/reported data in Excel from a booby-trapped name/description field.
   - Parsing is wrapped in try/catch exactly like the existing malformed-CSV-row handling — a corrupt `.xlsx` degrades to a reported "0 rows imported" error, never a crash.

2. **Migration safety (the `cokarma_membership_id` rename).** Renaming a live column is the highest-blast-radius step here:
   - Manual `pg_dump` backup immediately before running the migration — called out as a required pre-step in the implementation plan, not automated away.
   - The rename runs inside an explicit transaction so a mid-failure leaves the schema untouched rather than half-renamed.
   - Applied to a scratch copy of the CoKarma DB first; only run against the live DB after that's verified.

3. **Import idempotency.** `dues_imports` already records `filename`/`imported_by`/`row_count` but nothing stops the same file being imported twice and silently doubling every affected customer's dues. Add a `sha256` content hash column on `dues_imports`, checked before insert — a repeat import of an unchanged file is flagged back to the admin ("already imported on \<date\> — import again anyway?") instead of double-counting.

4. **Balance-message correctness.** The new CONFIRM balance lookup runs *after* `confirmClaim`'s `UPDATE` returns, so Postgres read-committed isolation guarantees it reflects that confirmation — no race between "claim confirmed" and "balance read." If the lookup itself throws, it's caught and logged the same way OCR failures already degrade gracefully — the customer still gets the base confirmation, CONFIRM never fails because of this.

5. **Package boundary doubles as a security boundary.** Each client keeps its own Postgres pool, `.env`, and WhatsApp session — `payment-ledger-core` shares *code* only, never runtime state or credentials. A bug or compromise in one client's bot process has no path to another client's DB or WhatsApp session.

**Explicitly deferred (flagged, not built this pass):** per-customer rate limiting on `PAID`/claim submission (e.g. capping concurrent pending claims) — real abuse-resistance work, but a separate behavioral change from the ledger/import/notification work here. Noted so it isn't forgotten, not silently dropped.

## Testing

- `payment-ledger-core` inherits and keeps the existing test coverage for `customers.js` (rename reflected), `claims.js`, `balances.js`, and CSV import (unchanged behavior, just relocated + renamed column).
- New unit tests for `parseDuesXlsx`: itemized multi-row-per-customer sheet, missing required fields, mismatched column headers, matching the existing `parseDuesCsv` test shape.
- New tests for formula-injection sanitization and the file-size/row-count caps (oversized file rejected, >10k rows rejected, `=`/`+`/`-`/`@`-prefixed cell neutralized).
- New test for import idempotency: importing the same file content twice is flagged, not double-inserted.
- New test for the CONFIRM balance message: settled-up case (balance ≤ 0) and remaining-balance case, both via the existing bot-level test pattern (mocked `client.sendMessage` / DB).
- No test coverage change needed for `REJECT` (untouched).

## Out of scope

- Generalizing `src/whatsapp/bot.js`/`flows.js` (OCR wiring, message copy, command parsing) into the shared package — client #2 gets its own copy as a starting template, not a shared dependency. If a third client needs the identical WhatsApp layer too, that's a future extraction, not this one.
- Publishing `payment-ledger-core` to a real npm registry — `file:` dependency is sufficient for two clients on the same developer's machine.
- Any change to how `dues`/`payment_claims`/`customer_balances` are calculated — the ledger math itself is correct today and untouched.
- Batched or scheduled balance notifications — CONFIRM-triggered only, per the existing synchronous message pattern.
- Per-customer rate limiting / claim-submission throttling — flagged above as deferred, not part of this pass.
