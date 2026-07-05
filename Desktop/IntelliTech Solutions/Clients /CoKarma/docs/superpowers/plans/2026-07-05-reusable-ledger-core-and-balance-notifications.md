# Reusable Ledger Core + Balance-on-Confirm Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell customers their updated balance when an admin confirms their payment, and extract CoKarma's ledger (customers/dues/claims/balances/imports) into a reusable `payment-ledger-core` package so a second IntelliTech client can run the same bot against their own database — seeded from an itemized Excel opening-balance file — without forking CoKarma's code.

**Architecture:** Four independently-shippable phases. Phase A adds a balance line to the existing CONFIRM message (no package involved). Phase B moves `src/db`, `src/ledger/*`, and `src/imports/duesImport.js` into a new local package (`payment-ledger-core`, consumed via a `file:` dependency), renaming the CoKarma-specific `cokarma_membership_id` column to the generic `external_ref_id` along the way. Phase C adds itemized `.xlsx` opening-balance import alongside the existing CSV import, with formula-injection sanitization and size/row caps. Phase D adds content-hash import idempotency so re-uploading the same file doesn't double-count dues. `src/whatsapp/` (bot.js, flows.js — message copy, WhatsApp session, OCR wiring) stays in CoKarma's own repo throughout; it is not part of the package.

**Tech Stack:** Existing Node.js + PostgreSQL + `whatsapp-web.js` stack. New: `xlsx` (SheetJS) for `.xlsx` parsing, pinned to an exact patched version.

## Global Constraints

- Money values stay `numeric(12,2)` everywhere.
- All DB access stays parameterized queries (`$1`, `$2`, ...) — never string-interpolated SQL.
- **Never edit an already-applied migration file** (`001_init.sql`, `002_add_ocr_extracted_amount.sql`, `003_add_ocr_txn_id_and_date.sql`) — schema changes are new, additive migration files only (`004_...`, `005_...`).
- `payment-ledger-core` is a private local package, never published to a registry — consumed only via a `file:` dependency.
- `payment-ledger-core` contains **no** business-specific naming, hardcoded defaults, or message copy — anything CoKarma-specific lives only in CoKarma's own `src/whatsapp/`.
- No hardcoded phone numbers anywhere in code.
- Test script stays `node --test --test-concurrency=1` in both CoKarma and the new package — every test file in a given suite shares one real Postgres test database reset via `resetDb()`, so concurrency must stay forced to 1.
- **This repo's root is the user's entire home directory (`/Users/vanshjalan`)** — every `git add`/`git commit` in this plan stages the exact files listed for that task by name. Never `git add -A`, `git add .`, or any broad glob.
- Every admin-only WhatsApp command stays gated behind the existing `isAdmin()` check in `bot.js:269` — no new admin command bypasses it.
- File paths in this plan: `COKARMA` = `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma`; `PKG` = `/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core`.

---

## Phase A — Balance-on-CONFIRM message

### Task 1: `formatBalanceLine` pure function

**Files:**
- Modify: `COKARMA/src/whatsapp/flows.js`
- Test: `COKARMA/tests/flows.test.js`

**Interfaces:**
- Consumes: nothing (pure function, no I/O — same convention as every other function in this file).
- Produces: `formatBalanceLine(balance: number|string): string` — Task 2 calls this with the raw `balance` value from the `customer_balances` view (a `numeric(12,2)`, which `pg` returns as a string like `"1500.00"`).

- [ ] **Step 1: Write the failing test**

Add to `COKARMA/tests/flows.test.js`:

```js
test('formatBalanceLine returns settled-up message when balance is zero', () => {
  assert.equal(flows.formatBalanceLine('0.00'), "You're all settled up!");
});

test('formatBalanceLine returns settled-up message when balance is negative', () => {
  assert.equal(flows.formatBalanceLine('-500.00'), "You're all settled up!");
});

test('formatBalanceLine returns the remaining balance when balance is positive', () => {
  assert.equal(flows.formatBalanceLine('1500.00'), 'Remaining balance: ₹1500.00');
});

test('formatBalanceLine accepts a plain number', () => {
  assert.equal(flows.formatBalanceLine(2000), 'Remaining balance: ₹2000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `COKARMA`): `npm test`
Expected: FAIL with "flows.formatBalanceLine is not a function"

- [ ] **Step 3: Implement `formatBalanceLine` in `flows.js`**

Add this function above the `module.exports` line:

```js
function formatBalanceLine(balance) {
  if (Number(balance) <= 0) return "You're all settled up!";
  return `Remaining balance: ₹${balance}`;
}
```

Update the `module.exports` line to:

```js
module.exports = {
  handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand,
  toWhatsAppChatId, extractAmountMatch, extractTxnId, extractPaymentDate,
  isScreenshotDateStale, screenshotAgeDays, formatBalanceLine,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 4 new tests, plus every existing test in `tests/flows.test.js`)

- [ ] **Step 5: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: add formatBalanceLine pure function"
```

---

### Task 2: Wire the balance line into the CONFIRM message

**Files:**
- Modify: `COKARMA/src/whatsapp/bot.js:518-533`

**Interfaces:**
- Consumes: `flows.formatBalanceLine` (Task 1); `balances.getBalanceByCustomerId(customerId): Promise<{balance: string, ...}|null>` (already exists in `src/ledger/balances.js:4-7`, already imported in `bot.js:12` as `balances`).
- Produces: nothing new for later tasks.

No automated test for this task — it's WhatsApp message-sending I/O, matching the established convention that `bot.js`'s I/O code has no unit tests (only the pure logic it calls into does, covered by Task 1). Verified manually.

- [ ] **Step 1: Update the CONFIRM branch in `handleAdminCommand`**

In `src/whatsapp/bot.js`, replace the `if (parsed.command === 'CONFIRM') { ... }` block (currently lines 518-533) with:

```js
    if (parsed.command === 'CONFIRM') {
      const updated = await claims.confirmClaim(fullId, waNumber);
      if (updated) {
        await safeSend(msg, `Claim #${parsed.claimId} confirmed.`);
        const customer = await customers.findById(updated.customer_id);
        if (customer) {
          const chatId = flows.toWhatsAppChatId(customer.phone_number);
          let balanceLine = '';
          try {
            const balance = await balances.getBalanceByCustomerId(customer.id);
            if (balance) balanceLine = `\n${flows.formatBalanceLine(balance.balance)}`;
          } catch (e) {
            logger.error('[WhatsApp] Failed to fetch balance for confirmation message', { customer: customer.phone_number, error: e.message });
          }
          try {
            await client.sendMessage(chatId, `✅ Your payment of ₹${updated.amount_claimed} has been confirmed. Thank you!${balanceLine}`);
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify customer of confirmation', { customer: customer.phone_number, error: e.message });
          }
        }
      } else {
        await safeSend(msg, `Claim #${parsed.claimId} was already reviewed.`);
      }
    } else {
```

(The trailing `} else {` reconnects to the existing `REJECT` branch immediately below it — do not duplicate it, just confirm it's still there after your edit.)

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Manual verification**

With the bot running and connected (`npm start`), using two allowlisted test numbers (one as customer, one as admin — see `TEST_MODE_ALLOWED_NUMBERS` in `.env`):
1. Report a payment that leaves a positive balance, then `CONFIRM` it from the admin number → the customer receives `✅ Your payment of ₹<amount> has been confirmed. Thank you!` followed by `Remaining balance: ₹<balance>` on the next line.
2. Report a payment that exactly clears the customer's remaining dues, then `CONFIRM` it → the customer receives the same confirmation, followed by `You're all settled up!`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/bot.js
git commit -m "feat: include updated balance in the CONFIRM customer message"
```

---

## Phase B — Extract `payment-ledger-core`

### Task 3: Scaffold the package and move the DB layer + migrations

**Files:**
- Create: `PKG/package.json`
- Create: `PKG/db.js`
- Create: `PKG/migrate.js`
- Move: `COKARMA/src/db/migrations/001_init.sql` → `PKG/migrations/001_init.sql`
- Move: `COKARMA/src/db/migrations/002_add_ocr_extracted_amount.sql` → `PKG/migrations/002_add_ocr_extracted_amount.sql`
- Move: `COKARMA/src/db/migrations/003_add_ocr_txn_id_and_date.sql` → `PKG/migrations/003_add_ocr_txn_id_and_date.sql`
- Remove: `COKARMA/src/db/db.js` (replaced by `PKG/db.js`)
- Test: `PKG/tests/db.test.js`, `PKG/.env.test`, `PKG/.env.test.example`

**Interfaces:**
- Produces: `require('payment-ledger-core/db')` → `{ pool, query, testConnection }` (same shape as the old `src/db/db.js`, minus any dependency on CoKarma's winston logger). `require('payment-ledger-core/migrate')` → `{ migrate(pool): Promise<void> }`. Task 4 onward requires from these paths.

- [ ] **Step 1: Create the package directory and manifest**

```bash
mkdir -p "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core/migrations"
```

Create `PKG/package.json`:

```json
{
  "name": "payment-ledger-core",
  "version": "1.0.0",
  "description": "Reusable customer ledger core (customers, dues, payment claims, balances, CSV/Excel dues import) for WhatsApp payment-reconciliation bots",
  "main": "db.js",
  "scripts": {
    "test": "node --test --test-concurrency=1"
  },
  "dependencies": {
    "csv-parse": "^5.5.6",
    "pg": "^8.11.5"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Create `PKG/db.js`**

This is the old `COKARMA/src/db/db.js` with two changes: no `../utils/logger` dependency (the package must not depend on the consuming app's logger — plain `console` output instead), and no CoKarma-specific `'cokarma_bridge'` default database name (each consumer must set `DB_NAME` explicitly).

```js
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[payment-ledger-core] Unexpected DB pool error:', err.message);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[payment-ledger-core] Query executed in ${Date.now() - start}ms, ${result.rowCount} rows`);
    }
    return result;
  } catch (err) {
    console.error('[payment-ledger-core] DB query error:', err.message, '| query:', text);
    throw err;
  }
};

const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW(), current_database()');
    console.log(`[payment-ledger-core] Database connected: ${result.rows[0].current_database}`);
    return true;
  } catch (err) {
    console.error('[payment-ledger-core] Database connection failed:', err.message);
    return false;
  }
};

module.exports = { pool, query, testConnection };
```

- [ ] **Step 3: Move the three existing migration files verbatim**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git mv "Clients /CoKarma/src/db/migrations/001_init.sql" "packages/payment-ledger-core/migrations/001_init.sql"
git mv "Clients /CoKarma/src/db/migrations/002_add_ocr_extracted_amount.sql" "packages/payment-ledger-core/migrations/002_add_ocr_extracted_amount.sql"
git mv "Clients /CoKarma/src/db/migrations/003_add_ocr_txn_id_and_date.sql" "packages/payment-ledger-core/migrations/003_add_ocr_txn_id_and_date.sql"
```

Expected: `git status` shows these three as renames, not separate add/delete.

- [ ] **Step 4: Remove the old `db.js` (superseded by `PKG/db.js`)**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git rm src/db/db.js
```

- [ ] **Step 5: Create `PKG/migrate.js`**

This is the migration runner, moved out of CoKarma's `scripts/migrate.js` so every consumer shares one implementation instead of copy-pasting it.

```js
const fs = require('fs');
const path = require('path');

async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length) {
      console.log(`Skipping already-applied migration: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying migration: ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
  }

  console.log('Migrations complete.');
}

module.exports = { migrate };
```

- [ ] **Step 6: Install the package's own dependencies**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm install
```

Expected: `node_modules/` and `package-lock.json` created inside `PKG`, containing `pg` and `csv-parse` (csv-parse is unused until Task 7 but declared now to match the final manifest — installing it now avoids a second `npm install` pass later).

- [ ] **Step 7: Set up the package's own test database and env files**

```bash
createdb payment_ledger_core_test
```

Create `PKG/.env.test.example`:

```
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_ledger_core_test
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
```

Create `PKG/.env.test` with the same content (this file is gitignored — see Step 9).

- [ ] **Step 8: Write and run the moved `db.test.js`**

Create `PKG/tests/db.test.js`:

```js
require('dotenv').config({ path: '.env.test' });
const test = require('node:test');
const assert = require('node:assert/strict');
const { testConnection, pool } = require('../db');

test('testConnection connects to the test database', async () => {
  const ok = await testConnection();
  assert.equal(ok, true);
});

test.after(async () => {
  await pool.end();
});
```

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm test
```
Expected: PASS (1 test)

- [ ] **Step 9: Add a `.gitignore` for the package**

Create `PKG/.gitignore`:

```
node_modules/
.env.test
```

- [ ] **Step 10: Verify the migration runner works against the fresh test DB**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
node -e "
require('dotenv').config({ path: '.env.test' });
const { pool } = require('./db');
const { migrate } = require('./migrate');
migrate(pool).then(() => pool.end());
"
```
Expected: `Applying migration: 001_init.sql`, `Applying migration: 002_add_ocr_extracted_amount.sql`, `Applying migration: 003_add_ocr_txn_id_and_date.sql`, then `Migrations complete.` — confirms `payment_ledger_core_test` now has the full CoKarma schema (including the still-CoKarma-named `cokarma_membership_id` column, which Task 5 renames).

- [ ] **Step 11: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/package.json" "packages/payment-ledger-core/db.js" \
  "packages/payment-ledger-core/migrate.js" "packages/payment-ledger-core/.gitignore" \
  "packages/payment-ledger-core/tests/db.test.js"
git commit -m "feat: scaffold payment-ledger-core package with db layer and migration runner"
```

(The three `git mv`'d migration files and the `git rm`'d `Clients /CoKarma/src/db/db.js` from Steps 3-4 are already staged by `git mv`/`git rm` — this commit picks them up together with the new files above. Run `git status` first if unsure what's staged.)

---

### Task 4: Move `claims.js` (no rename needed)

**Files:**
- Move: `COKARMA/src/ledger/claims.js` → `PKG/ledger/claims.js`
- Move: `COKARMA/tests/claims.test.js` → `PKG/tests/claims.test.js`
- Move: `COKARMA/tests/helpers/db.js` → `PKG/tests/helpers/db.js`

**Interfaces:**
- Consumes: `query` from `PKG/db.js` (Task 3).
- Produces: `require('payment-ledger-core/ledger/claims')` → same exports as before (`createClaim`, `findDuplicateUtr`, `findDuplicateTxnId`, `findClaimByIdPrefix`, `confirmClaim`, `rejectClaim`, `listPendingClaims`, `listStaleClaims`), unchanged behavior.

`claims.js` has zero CoKarma-specific naming (confirmed during design) — this is a pure relocation, no content changes to the module itself. Its test file needs the shared `tests/helpers/db.js` moved alongside it, since every ledger test file depends on `resetDb()`.

- [ ] **Step 1: Move the helper first (needed by the test file in this task and every later ledger test)**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
mkdir -p "packages/payment-ledger-core/tests/helpers"
git mv "Clients /CoKarma/tests/helpers/db.js" "packages/payment-ledger-core/tests/helpers/db.js"
```

Edit `PKG/tests/helpers/db.js` — the `require('../../src/db/db')` path from CoKarma no longer applies; the package's own `db.js` lives two levels up from `tests/helpers/`:

```js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { pool } = require('../../db');

async function resetDb() {
  await pool.query(
    'TRUNCATE payment_claims, dues, dues_imports, customers, admins RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, pool };
```

- [ ] **Step 2: Move `claims.js`**

```bash
git mv "Clients /CoKarma/src/ledger/claims.js" "packages/payment-ledger-core/ledger/claims.js"
```

Edit `PKG/ledger/claims.js` — only the top `require` line changes (`../db/db` → `../db`):

```js
const { query } = require('../db');
```

(The rest of the file — every function from `findDuplicateUtr` through the `module.exports` line — is unchanged. If your editor shows the full file, verify the only diff is this one `require` line.)

- [ ] **Step 3: Move the test file**

```bash
git mv "Clients /CoKarma/tests/claims.test.js" "packages/payment-ledger-core/tests/claims.test.js"
```

Edit `PKG/tests/claims.test.js` — update the two `require` paths at the top from `../src/ledger/...` and `../src/db/db` to the package-relative equivalents:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');
const claims = require('../ledger/claims');
const { query } = require('../db');
```

(Every test body below this — `makeCustomer` through the last `test(...)` block — is unchanged. `customers` is required here because `makeCustomer` calls `customers.createCustomer`; Task 5 moves that module next, so this require will resolve once Task 5 is done. Running this task's tests before Task 5 will fail on that missing file — that's expected and corrected by Task 5's own test run.)

- [ ] **Step 4: Commit (test run deferred to Task 5, once `customers.js` exists at its new path)**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/tests/helpers/db.js" "packages/payment-ledger-core/ledger/claims.js" \
  "packages/payment-ledger-core/tests/claims.test.js"
git commit -m "feat(payment-ledger-core): move claims module, test helper, and claims tests"
```

---

### Task 5: Move and rename `customers.js` + `balances.js` (`cokarma_membership_id` → `external_ref_id`)

**Files:**
- Move: `COKARMA/src/ledger/customers.js` → `PKG/ledger/customers.js`
- Move: `COKARMA/src/ledger/balances.js` → `PKG/ledger/balances.js`
- Move: `COKARMA/tests/customers.test.js` → `PKG/tests/customers.test.js`
- Move: `COKARMA/tests/balances.test.js` → `PKG/tests/balances.test.js`
- Move: `COKARMA/tests/balances-view.test.js` → `PKG/tests/balances-view.test.js`
- Create: `PKG/migrations/004_rename_membership_id_to_external_ref_id.sql`

**Interfaces:**
- Consumes: `query` from `PKG/db.js`.
- Produces: `require('payment-ledger-core/ledger/customers')` → same exports, but `linkMembershipId(customerId, refId)` now sets/reads `external_ref_id` instead of `cokarma_membership_id`. `require('payment-ledger-core/ledger/balances')` → same exports, `listUnlinkedCustomers()` now filters on `external_ref_id IS NULL`. Task 7 (`duesImport.js`) and Task 8 (CoKarma's `bot.js`/README) both reference the renamed column.

This is the schema-rename step flagged in the design's Security & Failsafes section — **read every step before running any of them**, this touches a live production table.

- [ ] **Step 1: Take a backup of the real CoKarma database before touching its schema**

```bash
pg_dump -U postgres -d cokarma_bridge -F c -f ~/Desktop/cokarma_bridge_backup_$(date +%Y%m%d_%H%M%S).dump
```

Expected: a `.dump` file appears on the Desktop, several KB or more (not 0 bytes). Do not proceed to Step 6 (applying the rename to the real `cokarma_bridge` database) until this file exists and is non-empty.

- [ ] **Step 2: Move `customers.js` and rewrite the membership-id references**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git mv "Clients /CoKarma/src/ledger/customers.js" "packages/payment-ledger-core/ledger/customers.js"
```

Replace the full contents of `PKG/ledger/customers.js` with:

```js
const { query } = require('../db');

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function findByPhone(phone) {
  const normalized = normalizePhone(phone);
  const { rows } = await query(
    `SELECT * FROM customers WHERE right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $1`,
    [normalized]
  );
  return rows[0] || null;
}

async function findById(customerId) {
  const { rows } = await query(`SELECT * FROM customers WHERE id = $1`, [customerId]);
  return rows[0] || null;
}

async function createCustomer({ name, phoneNumber }) {
  const { rows } = await query(
    `INSERT INTO customers (name, phone_number) VALUES ($1, $2) RETURNING *`,
    [name, phoneNumber]
  );
  return rows[0];
}

async function findByNameOrPhone(term) {
  const normalized = normalizePhone(term);
  const { rows } = await query(
    `SELECT * FROM customers
     WHERE LOWER(name) LIKE LOWER($1)
        OR right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $2
     LIMIT 5`,
    [`%${term}%`, normalized]
  );
  return rows;
}

async function linkExternalRefId(customerId, externalRefId) {
  const { rows } = await query(
    `UPDATE customers SET external_ref_id = $2 WHERE id = $1 RETURNING *`,
    [customerId, externalRefId]
  );
  return rows[0] || null;
}

module.exports = { normalizePhone, findByPhone, findById, createCustomer, findByNameOrPhone, linkExternalRefId };
```

(`linkMembershipId` is renamed to `linkExternalRefId` — Task 7's `duesImport.js` and Task 8's `bot.js` are updated to call the new name. There are no other callers in this codebase.)

- [ ] **Step 3: Move `balances.js` and update its one reference**

```bash
git mv "Clients /CoKarma/src/ledger/balances.js" "packages/payment-ledger-core/ledger/balances.js"
```

In `PKG/ledger/balances.js`, change the `require` path and the `listUnlinkedCustomers` query:

```js
const { query } = require('../db');
const { findByPhone, findByNameOrPhone } = require('./customers');

async function getBalanceByCustomerId(customerId) {
  const { rows } = await query('SELECT * FROM customer_balances WHERE customer_id = $1', [customerId]);
  return rows[0] || null;
}

async function getBalanceByPhone(phone) {
  const customer = await findByPhone(phone);
  if (!customer) return null;
  return getBalanceByCustomerId(customer.id);
}

async function searchBalances(term) {
  const matches = await findByNameOrPhone(term);
  const results = [];
  for (const customer of matches) {
    results.push(await getBalanceByCustomerId(customer.id));
  }
  return results;
}

async function listUnlinkedCustomers() {
  const { rows } = await query(
    `SELECT id, name, phone_number FROM customers WHERE external_ref_id IS NULL ORDER BY created_at ASC`
  );
  return rows;
}

module.exports = { getBalanceByCustomerId, getBalanceByPhone, searchBalances, listUnlinkedCustomers };
```

- [ ] **Step 4: Create the rename migration**

Create `PKG/migrations/004_rename_membership_id_to_external_ref_id.sql`:

```sql
ALTER TABLE customers RENAME COLUMN cokarma_membership_id TO external_ref_id;
```

(A single `ALTER TABLE ... RENAME COLUMN` is one DDL statement — Postgres executes DDL transactionally by default, so this either fully applies or fully rolls back; no explicit `BEGIN`/`COMMIT` needed.)

- [ ] **Step 5: Dry-run the migration against a scratch copy of the real database, not the real one**

```bash
createdb cokarma_bridge_scratch_test
pg_restore -U postgres -d cokarma_bridge_scratch_test ~/Desktop/cokarma_bridge_backup_*.dump
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cokarma_bridge_scratch_test', user: 'postgres' });
const { migrate } = require('./migrate');
migrate(pool).then(() => pool.end());
"
psql -U postgres -d cokarma_bridge_scratch_test -c "\d customers" | grep external_ref_id
dropdb cokarma_bridge_scratch_test
```
Expected: the `psql \d customers` output includes an `external_ref_id` line, and no `cokarma_membership_id` line — confirming the rename applies cleanly before it ever touches the real database. Only proceed to Step 6 once this passes.

- [ ] **Step 6: Apply the migration to the real databases**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
```
Expected: for each, `Applying migration: 004_rename_membership_id_to_external_ref_id.sql` then `Migrations complete.` Also run it against the package's own test DB, since Step 8 below needs it:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
node -e "
require('dotenv').config({ path: '.env.test' });
const { pool } = require('./db');
const { migrate } = require('./migrate');
migrate(pool).then(() => pool.end());
"
```

(`npm run migrate` in `COKARMA` still works unchanged at this point because Task 7 is what rewires `scripts/migrate.js` to call the package — until Task 7 lands, `COKARMA/scripts/migrate.js` still reads `src/db/migrations/`, which no longer has this file. **Do not run Step 6 until Task 7's `scripts/migrate.js` rewrite is done first — reorder: come back to this step after Task 7, or complete Task 7 Step 3 immediately before this step in your working session.** Track this: Step 6 has a hard dependency on Task 7 Step 3.)

- [ ] **Step 7: Move and update the customers/balances test files**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git mv "Clients /CoKarma/tests/customers.test.js" "packages/payment-ledger-core/tests/customers.test.js"
git mv "Clients /CoKarma/tests/balances.test.js" "packages/payment-ledger-core/tests/balances.test.js"
git mv "Clients /CoKarma/tests/balances-view.test.js" "packages/payment-ledger-core/tests/balances-view.test.js"
```

Replace the full contents of `PKG/tests/customers.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('createCustomer then findByPhone finds it regardless of formatting', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '919848358160' });
  const found = await customers.findByPhone('+91 98483 58160');
  assert.ok(found);
  assert.equal(found.name, 'Asha Rao');
});

test('findByPhone returns null for an unregistered number', async () => {
  const found = await customers.findByPhone('9999999999');
  assert.equal(found, null);
});

test('findByNameOrPhone matches by partial name, case-insensitive', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const results = await customers.findByNameOrPhone('asha');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Asha Rao');
});

test('linkExternalRefId sets external_ref_id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const updated = await customers.linkExternalRefId(created.id, 'CK-1001');
  assert.equal(updated.external_ref_id, 'CK-1001');
});

test('findById returns the customer by id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const found = await customers.findById(created.id);
  assert.equal(found.name, 'Asha Rao');
});

test('findById returns null for an unknown id', async () => {
  const found = await customers.findById('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});
```

In `PKG/tests/balances.test.js`, change the `require` paths and the one `linkMembershipId` call:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');
const balances = require('../ledger/balances');
const { query } = require('../db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('getBalanceByPhone returns computed balance for a registered customer', async () => {
  const customer = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  await query(`INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, 'July dues', 2000)`, [customer.id]);

  const balance = await balances.getBalanceByPhone('9848358160');
  assert.equal(Number(balance.total_due), 2000);
  assert.equal(Number(balance.total_confirmed), 0);
  assert.equal(Number(balance.balance), 2000);
});

test('getBalanceByPhone returns null for an unregistered number', async () => {
  const balance = await balances.getBalanceByPhone('9999999999');
  assert.equal(balance, null);
});

test('listUnlinkedCustomers only returns customers with no external ref id', async () => {
  const linked = await customers.createCustomer({ name: 'Linked', phoneNumber: '9111111111' });
  await customers.linkExternalRefId(linked.id, 'CK-1');
  await customers.createCustomer({ name: 'Unlinked', phoneNumber: '9222222222' });

  const unlinked = await balances.listUnlinkedCustomers();
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].name, 'Unlinked');
});
```

In `PKG/tests/balances-view.test.js`, only the `require` path changes:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const { query } = require('../db');
```

(The rest of that file's single test body is unchanged.)

- [ ] **Step 8: Update `claims.test.js`'s require path (deferred from Task 4) and run the whole package suite**

Task 4 already left `PKG/tests/claims.test.js` requiring `../ledger/customers` — that file now exists, so this test can finally run. Run the full package suite:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm test
```
Expected: PASS — all tests across `db.test.js`, `claims.test.js`, `customers.test.js`, `balances.test.js`, `balances-view.test.js`.

- [ ] **Step 9: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/ledger/customers.js" "packages/payment-ledger-core/ledger/balances.js" \
  "packages/payment-ledger-core/migrations/004_rename_membership_id_to_external_ref_id.sql" \
  "packages/payment-ledger-core/tests/customers.test.js" "packages/payment-ledger-core/tests/balances.test.js" \
  "packages/payment-ledger-core/tests/balances-view.test.js"
git commit -m "feat(payment-ledger-core): move customers/balances, rename cokarma_membership_id to external_ref_id"
```

---

### Task 6: Move and update `duesImport.js`

**Files:**
- Move: `COKARMA/src/imports/duesImport.js` → `PKG/imports/duesImport.js`
- Move: `COKARMA/tests/dues-import.test.js` → `PKG/tests/dues-import.test.js`
- Move: `COKARMA/tests/fixtures/dues-sample.csv` → `PKG/tests/fixtures/dues-sample.csv`

**Interfaces:**
- Consumes: `query` from `PKG/db.js`; `findByPhone` from `PKG/ledger/customers.js`.
- Produces: `require('payment-ledger-core/imports/duesImport')` → `{ parseDuesCsv, importDuesFromFile }`. The hardcoded `'CoKarma dues'` default description is removed — a row missing a description is now treated the same as a row missing a phone number (counted as unmatched, not inserted). `membershipId` in the parsed row shape is renamed to `externalRefId`. Task 9 (Phase C) extends this same file with `parseDuesXlsx` and a shared row-sanitization helper.

- [ ] **Step 1: Move the CSV fixture and test file**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
mkdir -p "packages/payment-ledger-core/tests/fixtures"
git mv "Clients /CoKarma/tests/fixtures/dues-sample.csv" "packages/payment-ledger-core/tests/fixtures/dues-sample.csv"
git mv "Clients /CoKarma/tests/dues-import.test.js" "packages/payment-ledger-core/tests/dues-import.test.js"
```

Replace the full contents of `PKG/tests/dues-import.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resetDb, pool } = require('./helpers/db');
const duesImport = require('../imports/duesImport');
const customers = require('../ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('parseDuesCsv reads rows into a normalized shape', () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const rows = duesImport.parseDuesCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].externalRefId, 'CK-1001');
  assert.equal(rows[0].amountDue, 5000);
});

test('importDuesFromFile creates new customers, links external ref ids, and flags unmatched rows', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 1);

  const asha = await customers.findByPhone('9848358160');
  assert.ok(asha);
  assert.equal(asha.external_ref_id, 'CK-1001');

  const ravi = await customers.findByPhone('+91 91111 11111');
  assert.ok(ravi);
  assert.equal(ravi.external_ref_id, 'CK-1002');
});

test('importDuesFromFile does not overwrite an existing external ref id', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const existing = await customers.findByPhone('9848358160');
  await customers.linkExternalRefId(existing.id, 'ALREADY-SET');

  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');

  const after = await customers.findByPhone('9848358160');
  assert.equal(after.external_ref_id, 'ALREADY-SET');
});
```

- [ ] **Step 2: Move `duesImport.js` and update it**

```bash
git mv "Clients /CoKarma/src/imports/duesImport.js" "packages/payment-ledger-core/imports/duesImport.js"
```

Replace the full contents of `PKG/imports/duesImport.js` with:

```js
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { query } = require('../db');
const { findByPhone } = require('../ledger/customers');

function parseDuesCsv(csvContent) {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((r) => ({
    phoneNumber: r.phone_number || r.phone || '',
    name: r.name || '',
    externalRefId: r.membership_id || r.external_ref_id || null,
    description: r.description || '',
    amountDue: parseFloat(r.amount_due || r.amount || '0'),
    dueDate: r.due_date || null,
  }));
}

async function importDuesFromFile(filePath, adminPhone) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseDuesCsv(content);

  const { rows: importRows } = await query(
    `INSERT INTO dues_imports (filename, imported_by, row_count) VALUES ($1, $2, $3) RETURNING id`,
    [filePath, adminPhone, rows.length]
  );
  const importBatchId = importRows[0].id;

  let unmatchedCount = 0;
  const unmatched = [];

  for (const row of rows) {
    if (!row.phoneNumber || !row.description || Number.isNaN(row.amountDue) || row.amountDue <= 0) {
      unmatchedCount++;
      unmatched.push(row);
      continue;
    }

    let customer = await findByPhone(row.phoneNumber);
    if (!customer) {
      const { rows: created } = await query(
        `INSERT INTO customers (name, phone_number, external_ref_id) VALUES ($1, $2, $3) RETURNING *`,
        [row.name || 'Unknown', row.phoneNumber, row.externalRefId]
      );
      customer = created[0];
    } else if (row.externalRefId && !customer.external_ref_id) {
      await query(`UPDATE customers SET external_ref_id = $2 WHERE id = $1`, [customer.id, row.externalRefId]);
    }

    await query(
      `INSERT INTO dues (customer_id, description, amount_due, due_date, import_batch_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [customer.id, row.description, row.amountDue, row.dueDate, importBatchId]
    );
  }

  await query(`UPDATE dues_imports SET unmatched_count = $2 WHERE id = $1`, [importBatchId, unmatchedCount]);

  return { importBatchId, totalRows: rows.length, unmatchedCount, unmatched };
}

module.exports = { parseDuesCsv, importDuesFromFile };
```

(Two behavior changes versus the original: `description` defaulting to `'CoKarma dues'` is gone — an empty description now makes a row unmatched, same as a missing phone number or invalid amount; and `membershipId` is renamed `externalRefId` throughout, matching Task 5's column rename.)

- [ ] **Step 3: Run the package test suite**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm test
```
Expected: PASS — all tests, including the 3 in `dues-import.test.js`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/imports/duesImport.js" "packages/payment-ledger-core/tests/dues-import.test.js" \
  "packages/payment-ledger-core/tests/fixtures/dues-sample.csv"
git commit -m "feat(payment-ledger-core): move dues import, rename membershipId to externalRefId, drop hardcoded description default"
```

---

### Task 7: Wire CoKarma to consume the package

**Files:**
- Modify: `COKARMA/package.json`
- Modify: `COKARMA/src/whatsapp/bot.js` (require paths + the two `PENDING_LINKS`/import branches that reference the old field name)
- Modify: `COKARMA/scripts/migrate.js`
- Modify: `COKARMA/scripts/seed-admin.js`
- Modify: `COKARMA/README.md`
- Remove: `COKARMA/src/ledger/` (now empty), `COKARMA/src/imports/` (now empty), `COKARMA/src/db/migrations/` (now empty)

**Interfaces:**
- Consumes: everything produced by Tasks 3-6.
- Produces: a working CoKarma bot running entirely on `payment-ledger-core`. This is also where Task 5's Step 6 (applying migration 004 to the real databases) actually becomes runnable — see the note there.

- [ ] **Step 1: Add the `file:` dependency and remove now-duplicated ones**

In `COKARMA/package.json`, remove `"pg": "^8.11.5"` and `"csv-parse": "^5.5.6"` from `"dependencies"` (both now live inside `payment-ledger-core`'s own manifest and get installed as its nested dependencies), and add:

```json
    "payment-ledger-core": "file:../../packages/payment-ledger-core",
```

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm install
```
Expected: `node_modules/payment-ledger-core` appears (a symlink to the package folder), and `node_modules/payment-ledger-core/node_modules/pg` (or hoisted to `node_modules/pg`) exists — `require('payment-ledger-core/db')` and `require('pg')` (used only inside the package, not by CoKarma directly) both resolve.

- [ ] **Step 2: Update requires in `bot.js`**

In `src/whatsapp/bot.js`, replace lines 9-13:

```js
const { query } = require('../db/db');
const customers = require('../ledger/customers');
const claims = require('../ledger/claims');
const balances = require('../ledger/balances');
const duesImport = require('../imports/duesImport');
```

with:

```js
const { query } = require('payment-ledger-core/db');
const customers = require('payment-ledger-core/ledger/customers');
const claims = require('payment-ledger-core/ledger/claims');
const balances = require('payment-ledger-core/ledger/balances');
const duesImport = require('payment-ledger-core/imports/duesImport');
```

- [ ] **Step 3: Rewrite `scripts/migrate.js` as a thin wrapper**

Replace the full contents of `COKARMA/scripts/migrate.js` with:

```js
require('dotenv').config();
const { pool } = require('payment-ledger-core/db');
const { migrate } = require('payment-ledger-core/migrate');

migrate(pool)
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 4: Update `scripts/seed-admin.js`'s require path**

In `COKARMA/scripts/seed-admin.js`, change:

```js
const { pool } = require('../src/db/db');
```

to:

```js
const { pool } = require('payment-ledger-core/db');
```

(No other change — this script's own `admins` table query is CoKarma-agnostic and stays as-is.)

- [ ] **Step 5: Now go back and complete Task 5 Step 6 (apply migration 004)**

Task 5 Step 6 was blocked on this task's Step 3 landing first. Run it now:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
```
Expected: `Applying migration: 004_rename_membership_id_to_external_ref_id.sql` then `Migrations complete.` for both.

- [ ] **Step 6: Remove the now-empty CoKarma source directories**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
rmdir src/ledger src/imports src/db/migrations
```
Expected: no error (all three are empty after Tasks 3-6's moves — if any command errors "Directory not empty," `ls` it and confirm every file inside was already moved by an earlier task before deleting).

- [ ] **Step 7: Update `README.md`**

In `COKARMA/README.md`, change:
- `` `PENDING LINKS` — list customers not yet linked to a CoKarma membership id `` → `` `PENDING LINKS` — list customers not yet linked to an external reference id ``

- [ ] **Step 8: Run the full CoKarma test suite**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm test
```
Expected: PASS — only `tests/flows.test.js` remains in CoKarma's own `tests/` directory at this point (everything else moved to the package in Tasks 4-6), and it requires nothing from the moved modules.

- [ ] **Step 9: Manual end-to-end smoke test**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm start
```
Expected: same startup sequence confirmed working earlier this session — OCR service ready, `[WhatsApp] Bot connected and ready!` — now running entirely through `payment-ledger-core`. Send a real `PAID` flow through to `CONFIRM` and check the balance line from Task 2 still appears correctly (`customer_balances` view is unaffected by the column rename, since it never referenced `cokarma_membership_id`).

- [ ] **Step 10: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add package.json package-lock.json src/whatsapp/bot.js scripts/migrate.js scripts/seed-admin.js README.md
git commit -m "feat: consume payment-ledger-core package instead of local ledger/db/imports modules"
```

---

## Phase C — Itemized Excel opening-balance import

### Task 8: `parseDuesXlsx` + formula-injection sanitization + row cap

**Files:**
- Modify: `PKG/package.json` (add `xlsx` dependency)
- Modify: `PKG/imports/duesImport.js`
- Test: `PKG/tests/dues-import.test.js`
- Test fixture: Create `PKG/tests/fixtures/dues-sample.xlsx` (generated by a one-off script, see Step 3)

**Interfaces:**
- Consumes: nothing new externally.
- Produces: `parseDuesXlsx(buffer: Buffer): Row[]` (same normalized row shape as `parseDuesCsv`); `sanitizeFormulaValue(value: string): string` (exported for Task 10's bot.js integration test/manual check, and reused internally by both parsers); `importDuesFromFile` now throws a plain `Error` when a file has more than 10,000 rows, with a message starting `"Import rejected:"`.

- [ ] **Step 1: Add and pin the `xlsx` dependency**

In `PKG/package.json`, add to `"dependencies"` (exact version, not a caret range — pinning a specific patched release rather than letting range resolution pick up an untested one is the safer default for a file-parsing library):

```json
    "xlsx": "0.18.5",
```

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm install
npm audit --production
```
Expected: `xlsx@0.18.5` installed; review the `npm audit` output — if it reports a critical/high vulnerability specific to `xlsx`, stop and re-check the currently-recommended pinned version before continuing (do not silently proceed past a flagged critical CVE in a file-parsing dependency).

- [ ] **Step 2: Add `parseDuesXlsx` and the shared sanitizer to `duesImport.js`**

Replace the full contents of `PKG/imports/duesImport.js` with:

```js
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { query } = require('../db');
const { findByPhone } = require('../ledger/customers');

const MAX_IMPORT_ROWS = 10000;

// Neutralizes CSV/Excel formula injection: a cell value starting with =, +,
// -, or @ is a formula in Excel/Sheets and could run arbitrary lookups or
// shell-outs (via legacy DDE) if an admin later opens exported/reported
// data in a spreadsheet app. Prefixing with a single quote forces it to be
// read back as inert text instead of a formula.
function sanitizeFormulaValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function normalizeDuesRow(r) {
  return {
    phoneNumber: String(r.phone_number || r.phone || '').trim(),
    name: sanitizeFormulaValue(String(r.name || '').trim()),
    externalRefId: sanitizeFormulaValue(String(r.membership_id || r.external_ref_id || '').trim()) || null,
    description: sanitizeFormulaValue(String(r.description || '').trim()),
    amountDue: parseFloat(r.amount_due || r.amount || '0'),
    dueDate: r.due_date || null,
  };
}

function parseDuesCsv(csvContent) {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  return records.map(normalizeDuesRow);
}

function parseDuesXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return records.map(normalizeDuesRow);
}

async function importDuesFromFile(filePath, adminPhone) {
  const buffer = fs.readFileSync(filePath);
  const isXlsx = filePath.toLowerCase().endsWith('.xlsx');
  const rows = isXlsx ? parseDuesXlsx(buffer) : parseDuesCsv(buffer.toString('utf8'));

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import rejected: ${rows.length} rows exceeds the ${MAX_IMPORT_ROWS}-row cap.`);
  }

  const { rows: importRows } = await query(
    `INSERT INTO dues_imports (filename, imported_by, row_count) VALUES ($1, $2, $3) RETURNING id`,
    [filePath, adminPhone, rows.length]
  );
  const importBatchId = importRows[0].id;

  let unmatchedCount = 0;
  const unmatched = [];

  for (const row of rows) {
    if (!row.phoneNumber || !row.description || Number.isNaN(row.amountDue) || row.amountDue <= 0) {
      unmatchedCount++;
      unmatched.push(row);
      continue;
    }

    let customer = await findByPhone(row.phoneNumber);
    if (!customer) {
      const { rows: created } = await query(
        `INSERT INTO customers (name, phone_number, external_ref_id) VALUES ($1, $2, $3) RETURNING *`,
        [row.name || 'Unknown', row.phoneNumber, row.externalRefId]
      );
      customer = created[0];
    } else if (row.externalRefId && !customer.external_ref_id) {
      await query(`UPDATE customers SET external_ref_id = $2 WHERE id = $1`, [customer.id, row.externalRefId]);
    }

    await query(
      `INSERT INTO dues (customer_id, description, amount_due, due_date, import_batch_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [customer.id, row.description, row.amountDue, row.dueDate, importBatchId]
    );
  }

  await query(`UPDATE dues_imports SET unmatched_count = $2 WHERE id = $1`, [importBatchId, unmatchedCount]);

  return { importBatchId, totalRows: rows.length, unmatchedCount, unmatched };
}

module.exports = { parseDuesCsv, parseDuesXlsx, importDuesFromFile, sanitizeFormulaValue };
```

- [ ] **Step 3: Generate the `.xlsx` test fixture**

There's no existing `.xlsx` fixture to hand-author (unlike the plain-text CSV fixture) — generate one with a throwaway script using the now-installed `xlsx` library:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
node -e "
const XLSX = require('xlsx');
const rows = [
  { name: 'Asha Rao', phone_number: '9848358160', membership_id: 'CK-1001', description: 'Opening balance - Invoice 1', amount_due: 3000, due_date: '2026-01-15' },
  { name: 'Asha Rao', phone_number: '9848358160', membership_id: 'CK-1001', description: 'Opening balance - Invoice 2', amount_due: 1500, due_date: '2026-02-15' },
  { name: 'Ravi Kumar', phone_number: '+91 91111 11111', membership_id: 'CK-1002', description: 'Opening balance', amount_due: 4500, due_date: '2026-01-20' },
];
const sheet = XLSX.utils.json_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Opening Balances');
XLSX.writeFile(workbook, 'tests/fixtures/dues-sample.xlsx');
console.log('wrote tests/fixtures/dues-sample.xlsx');
"
```
Expected: `wrote tests/fixtures/dues-sample.xlsx`, and `ls tests/fixtures/` shows the new file. This fixture models the itemized-per-customer shape from the design (Asha Rao has two separate line items, matching the second client's real Excel structure).

- [ ] **Step 4: Write the failing tests**

Add to `PKG/tests/dues-import.test.js`:

```js
test('parseDuesXlsx reads itemized multi-row-per-customer rows into the same normalized shape as CSV', () => {
  const fs = require('node:fs');
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'dues-sample.xlsx'));
  const rows = duesImport.parseDuesXlsx(buffer);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].externalRefId, 'CK-1001');
  assert.equal(rows[0].description, 'Opening balance - Invoice 1');
  assert.equal(rows[0].amountDue, 3000);
  assert.equal(rows[1].description, 'Opening balance - Invoice 2');
  assert.equal(rows[1].amountDue, 1500);
});

test('importDuesFromFile accepts an .xlsx file and creates one dues row per line item', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.xlsx');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 0);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 4500);
});

test('sanitizeFormulaValue neutralizes a leading =, +, -, or @', () => {
  assert.equal(duesImport.sanitizeFormulaValue('=cmd|calc'), "'=cmd|calc");
  assert.equal(duesImport.sanitizeFormulaValue('+1+1'), "'+1+1");
  assert.equal(duesImport.sanitizeFormulaValue('-1-1'), "'-1-1");
  assert.equal(duesImport.sanitizeFormulaValue('@SUM(1,1)'), "'@SUM(1,1)");
  assert.equal(duesImport.sanitizeFormulaValue('Asha Rao'), 'Asha Rao');
});

test('importDuesFromFile sanitizes a formula-injection attempt in the name field', async () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\n=HYPERLINK("http://evil"),9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const tmpPath = path.join(__dirname, 'fixtures', 'tmp-injection.csv');
  fs.writeFileSync(tmpPath, csv);
  await duesImport.importDuesFromFile(tmpPath, '9999900000');
  fs.unlinkSync(tmpPath);

  const customer = await customers.findByPhone('9848358160');
  assert.equal(customer.name.startsWith("'="), true);
});

test('importDuesFromFile rejects a file over the row cap', async () => {
  const header = 'name,phone_number,membership_id,description,amount_due,due_date\n';
  const row = 'Test User,9848358160,CK-1,dues,100,2026-07-05\n';
  const csv = header + row.repeat(10001);
  const tmpPath = path.join(__dirname, 'fixtures', 'tmp-toolarge.csv');
  fs.writeFileSync(tmpPath, csv);

  await assert.rejects(
    () => duesImport.importDuesFromFile(tmpPath, '9999900000'),
    /Import rejected: 10001 rows exceeds the 10000-row cap/
  );
  fs.unlinkSync(tmpPath);
});
```

Add `const fs = require('node:fs');` to the top of `PKG/tests/dues-import.test.js` alongside the other requires (needed by the last two tests above).

- [ ] **Step 5: Run test to verify the new tests fail**

Run: `npm test`
Expected: FAIL — `duesImport.parseDuesXlsx is not a function` (or similar) before Step 2's implementation; since Step 2 is written before this step in this task, instead run this to confirm the tests you just added actually exercise real behavior: temporarily comment out the `sanitizeFormulaValue` call sites in `normalizeDuesRow` and confirm the injection test fails, then restore them. (This step exists to catch a test that would pass even without the sanitizer — skip the manual sabotage-and-restore if you're confident in the assertions, but do run `npm test` at minimum to confirm all 5 new tests pass cleanly against the real implementation from Step 2.)

- [ ] **Step 6: Run test to verify it passes**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm test
```
Expected: PASS — all tests, including the 5 new ones.

- [ ] **Step 7: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/package.json" "packages/payment-ledger-core/package-lock.json" \
  "packages/payment-ledger-core/imports/duesImport.js" "packages/payment-ledger-core/tests/dues-import.test.js" \
  "packages/payment-ledger-core/tests/fixtures/dues-sample.xlsx"
git commit -m "feat(payment-ledger-core): add xlsx opening-balance import, formula-injection sanitization, row cap"
```

---

### Task 9: `IMPORT` command accepts `.xlsx`, with a file-size cap

**Files:**
- Modify: `COKARMA/src/whatsapp/bot.js:579-587` (the `IMPORT` branch in `handleAdminCommand`)
- Modify: `COKARMA/README.md`

**Interfaces:**
- Consumes: `duesImport.importDuesFromFile` (Task 8, already extended to detect `.xlsx` by extension).
- Produces: nothing new for later tasks.

No automated test — same I/O convention as the rest of `bot.js`. Verified manually.

- [ ] **Step 1: Fix the hardcoded `.csv` extension and add the size cap**

Replace the `if (parsed.command === 'IMPORT') { ... }` block (currently lines 579-587) with:

```js
  if (parsed.command === 'IMPORT') {
    if (!msg.hasMedia) { await safeSend(msg, 'Send the CSV or Excel file as an attachment with caption IMPORT.'); return; }
    const media = await msg.downloadMedia();
    const buffer = Buffer.from(media.data, 'base64');
    const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      await safeSend(msg, `Import rejected: file is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, over the 5MB limit.`);
      return;
    }
    const mimeToExt = { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv' };
    const ext = mimeToExt[media.mimetype] || 'csv';
    const fileName = path.join(PROOFS_DIR, `import-${Date.now()}.${ext}`);
    fs.writeFileSync(fileName, buffer);
    try {
      const result = await duesImport.importDuesFromFile(fileName, waNumber);
      await safeSend(msg, `Import complete: ${result.totalRows} rows, ${result.unmatchedCount} unmatched.`);
    } catch (e) {
      logger.error('[WhatsApp] Import failed', { error: e.message });
      await safeSend(msg, `Import failed: ${e.message}`);
    }
    return;
  }
```

(WhatsApp's own `whatsapp-web.js` attachment size limits already sit well under most media size ceilings in practice, but the explicit 5MB check here is the one called out in the design — it fires before any parsing is attempted, and independently of whatever WhatsApp itself allows.)

- [ ] **Step 2: Update the fallback "unknown command" message**

Change the last line of `handleAdminCommand` (currently `await safeSend(msg, 'Unknown command. Try PAID, PENDING, PENDING LINKS, BALANCE <name>, CONFIRM <id>, REJECT <id> <reason>, or IMPORT (with a CSV attachment).');`) to:

```js
  await safeSend(msg, 'Unknown command. Try PAID, PENDING, PENDING LINKS, BALANCE <name>, CONFIRM <id>, REJECT <id> <reason>, or IMPORT (with a CSV or Excel attachment).');
```

- [ ] **Step 3: Update `README.md`**

Change `` `IMPORT` — attach a CSV (columns: `name, phone_number, membership_id, description, amount_due, due_date`) to load dues `` to:

```
- `IMPORT` — attach a CSV or Excel (`.xlsx`) file (columns: `name, phone_number, membership_id, description, amount_due, due_date`) to load dues or opening balances. Files over 5MB are rejected.
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (this task touches no test files, confirming no syntax error was introduced)

- [ ] **Step 5: Manual verification**

With the bot running and connected:
1. Send a small `.xlsx` file with the same columns as the CSV import, captioned `IMPORT` → `Import complete: N rows, 0 unmatched.`
2. Send the existing CSV-based import again → still works exactly as before.
3. (Optional, skip if inconvenient) Send a file over 5MB → `Import rejected: file is X.XMB, over the 5MB limit.`, no rows inserted.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/bot.js README.md
git commit -m "feat: accept .xlsx attachments for IMPORT, enforce 5MB file size cap"
```

---

## Phase D — Import idempotency

### Task 10: Content-hash dedup with a `FORCE` override

**Files:**
- Create: `PKG/migrations/005_add_content_hash_to_dues_imports.sql`
- Modify: `PKG/imports/duesImport.js`
- Test: `PKG/tests/dues-import.test.js`

**Interfaces:**
- Produces: `importDuesFromFile(filePath, adminPhone, { force = false } = {})` → now returns `{ alreadyImported: true, previousImport: {filename, imported_at, row_count} }` instead of importing, when the file's content hash matches a prior successful import and `force` is not `true`. When `force: true`, import proceeds regardless.

- [ ] **Step 1: Create the migration**

Create `PKG/migrations/005_add_content_hash_to_dues_imports.sql`:

```sql
ALTER TABLE dues_imports ADD COLUMN content_hash text;
```

Apply it everywhere:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
node -e "
require('dotenv').config({ path: '.env.test' });
const { pool } = require('./db');
const { migrate } = require('./migrate');
migrate(pool).then(() => pool.end());
"
```
Expected: `Applying migration: 005_add_content_hash_to_dues_imports.sql` then `Migrations complete.` for all three databases.

- [ ] **Step 2: Write the failing tests**

Add to `PKG/tests/dues-import.test.js`:

```js
test('importDuesFromFile flags a repeat import of unchanged file content instead of re-importing', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const first = await duesImport.importDuesFromFile(filePath, '9999900000');
  assert.equal(first.alreadyImported, undefined);

  const second = await duesImport.importDuesFromFile(filePath, '9999900000');
  assert.equal(second.alreadyImported, true);
  assert.equal(second.previousImport.row_count, first.totalRows);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 5000); // not double-counted to 10000
});

test('importDuesFromFile with force:true re-imports unchanged content anyway', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');
  const forced = await duesImport.importDuesFromFile(filePath, '9999900000', { force: true });
  assert.equal(forced.alreadyImported, undefined);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 10000); // now double-counted intentionally
});

test('importDuesFromFile does not flag a different file as a repeat', async () => {
  const csvA = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const csvB = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,August dues,5000,2026-08-05\n';
  const pathA = path.join(__dirname, 'fixtures', 'tmp-a.csv');
  const pathB = path.join(__dirname, 'fixtures', 'tmp-b.csv');
  fs.writeFileSync(pathA, csvA);
  fs.writeFileSync(pathB, csvB);

  const first = await duesImport.importDuesFromFile(pathA, '9999900000');
  const second = await duesImport.importDuesFromFile(pathB, '9999900000');
  assert.equal(first.alreadyImported, undefined);
  assert.equal(second.alreadyImported, undefined);

  fs.unlinkSync(pathA);
  fs.unlinkSync(pathB);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `second.alreadyImported` is `undefined` instead of `true` (the file gets re-imported and dues get double-counted, since `content_hash` isn't checked yet).

- [ ] **Step 4: Implement the hash check in `importDuesFromFile`**

In `PKG/imports/duesImport.js`, add `const crypto = require('crypto');` to the top requires, then replace the `importDuesFromFile` function with:

```js
async function importDuesFromFile(filePath, adminPhone, { force = false } = {}) {
  const buffer = fs.readFileSync(filePath);
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

  if (!force) {
    const { rows: existing } = await query(
      `SELECT filename, imported_at, row_count FROM dues_imports WHERE content_hash = $1 ORDER BY imported_at DESC LIMIT 1`,
      [contentHash]
    );
    if (existing.length > 0) {
      return { alreadyImported: true, previousImport: existing[0] };
    }
  }

  const isXlsx = filePath.toLowerCase().endsWith('.xlsx');
  const rows = isXlsx ? parseDuesXlsx(buffer) : parseDuesCsv(buffer.toString('utf8'));

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import rejected: ${rows.length} rows exceeds the ${MAX_IMPORT_ROWS}-row cap.`);
  }

  const { rows: importRows } = await query(
    `INSERT INTO dues_imports (filename, imported_by, row_count, content_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [filePath, adminPhone, rows.length, contentHash]
  );
  const importBatchId = importRows[0].id;

  let unmatchedCount = 0;
  const unmatched = [];

  for (const row of rows) {
    if (!row.phoneNumber || !row.description || Number.isNaN(row.amountDue) || row.amountDue <= 0) {
      unmatchedCount++;
      unmatched.push(row);
      continue;
    }

    let customer = await findByPhone(row.phoneNumber);
    if (!customer) {
      const { rows: created } = await query(
        `INSERT INTO customers (name, phone_number, external_ref_id) VALUES ($1, $2, $3) RETURNING *`,
        [row.name || 'Unknown', row.phoneNumber, row.externalRefId]
      );
      customer = created[0];
    } else if (row.externalRefId && !customer.external_ref_id) {
      await query(`UPDATE customers SET external_ref_id = $2 WHERE id = $1`, [customer.id, row.externalRefId]);
    }

    await query(
      `INSERT INTO dues (customer_id, description, amount_due, due_date, import_batch_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [customer.id, row.description, row.amountDue, row.dueDate, importBatchId]
    );
  }

  await query(`UPDATE dues_imports SET unmatched_count = $2 WHERE id = $1`, [importBatchId, unmatchedCount]);

  return { importBatchId, totalRows: rows.length, unmatchedCount, unmatched };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/packages/payment-ledger-core"
npm test
```
Expected: PASS — all tests, including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions"
git add "packages/payment-ledger-core/migrations/005_add_content_hash_to_dues_imports.sql" \
  "packages/payment-ledger-core/imports/duesImport.js" "packages/payment-ledger-core/tests/dues-import.test.js"
git commit -m "feat(payment-ledger-core): flag repeat file imports by content hash, with a force override"
```

---

### Task 11: `IMPORT FORCE` admin command

**Files:**
- Modify: `COKARMA/src/whatsapp/flows.js` (`parseAdminCommand`)
- Test: `COKARMA/tests/flows.test.js`
- Modify: `COKARMA/src/whatsapp/bot.js:579-` (the `IMPORT` branch, again — passes `force` through and handles the `alreadyImported` result)
- Modify: `COKARMA/README.md`

**Interfaces:**
- Consumes: `duesImport.importDuesFromFile`'s new `{ force }` option and `alreadyImported`/`previousImport` return shape (Task 10).
- Produces: `parsed.force: boolean` on the `IMPORT` command, consumed by `bot.js`.

- [ ] **Step 1: Write the failing test**

Add to `COKARMA/tests/flows.test.js`:

```js
test('parseAdminCommand parses plain IMPORT with force false', () => {
  const result = flows.parseAdminCommand('IMPORT');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, false);
});

test('parseAdminCommand parses IMPORT FORCE with force true', () => {
  const result = flows.parseAdminCommand('IMPORT FORCE');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, true);
});

test('parseAdminCommand parses IMPORT FORCE case-insensitively', () => {
  const result = flows.parseAdminCommand('import force');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `COKARMA`): `npm test`
Expected: FAIL — `result.force` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Update `parseAdminCommand` in `flows.js`**

In `src/whatsapp/flows.js`, replace this line:

```js
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT' };
```

with:

```js
  if (/^import\s+force$/i.test(trimmed)) return { command: 'IMPORT', force: true };
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT', force: false };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 3 new tests, plus every existing test in `tests/flows.test.js`)

- [ ] **Step 5: Commit the flows.js change on its own**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: parse IMPORT FORCE admin command"
```

- [ ] **Step 6: Wire `force` and the `alreadyImported` result into `bot.js`**

Replace the `if (parsed.command === 'IMPORT') { ... }` block (written in Task 9) with:

```js
  if (parsed.command === 'IMPORT') {
    if (!msg.hasMedia) { await safeSend(msg, 'Send the CSV or Excel file as an attachment with caption IMPORT.'); return; }
    const media = await msg.downloadMedia();
    const buffer = Buffer.from(media.data, 'base64');
    const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      await safeSend(msg, `Import rejected: file is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, over the 5MB limit.`);
      return;
    }
    const mimeToExt = { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv' };
    const ext = mimeToExt[media.mimetype] || 'csv';
    const fileName = path.join(PROOFS_DIR, `import-${Date.now()}.${ext}`);
    fs.writeFileSync(fileName, buffer);
    try {
      const result = await duesImport.importDuesFromFile(fileName, waNumber, { force: parsed.force });
      if (result.alreadyImported) {
        await safeSend(msg, `This file was already imported on ${result.previousImport.imported_at} (${result.previousImport.row_count} rows). Reply IMPORT FORCE with the same attachment to import it again anyway.`);
        return;
      }
      await safeSend(msg, `Import complete: ${result.totalRows} rows, ${result.unmatchedCount} unmatched.`);
    } catch (e) {
      logger.error('[WhatsApp] Import failed', { error: e.message });
      await safeSend(msg, `Import failed: ${e.message}`);
    }
    return;
  }
```

- [ ] **Step 7: Update `README.md`**

Add a line after the existing `IMPORT` bullet:

```
- `IMPORT FORCE` — same as `IMPORT`, but re-imports even if this exact file was already imported before (normally blocked to prevent double-counting dues).
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Manual verification**

With the bot running and connected:
1. Send an import file, captioned `IMPORT` → succeeds normally.
2. Send the exact same file again, captioned `IMPORT` → `This file was already imported on <date> (<N> rows). Reply IMPORT FORCE with the same attachment to import it again anyway.` — no new dues rows created (check `BALANCE <name>` for one of the affected customers didn't change).
3. Send the same file again, captioned `IMPORT FORCE` → `Import complete: ...` — dues rows created a second time as intended.

- [ ] **Step 10: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/bot.js README.md
git commit -m "feat: block duplicate IMPORTs by content hash, add IMPORT FORCE override"
```

---

## Post-plan notes

- **Rate limiting on customer claim submission** was flagged in the design's Security & Failsafes section as explicitly deferred — a customer can still submit unlimited `PAID` claims today. Not built in this plan; a future iteration would cap concurrent pending claims per customer.
- **Bootstrapping the second client's actual repo** (copying CoKarma as a template, its own `.env`, its own WhatsApp session, its own message copy, running its own Excel opening-balance import before going live) is intentionally not a task in this plan — it happens once this plan's `payment-ledger-core` package exists and is stable, using the "New-client bootstrap flow" section of the design doc as the runbook. Trigger that as a separate, smaller plan when the second client is actually ready to onboard.
- If `xlsx@0.18.5`'s `npm audit` in Task 8 Step 1 turns up a blocking finding, the fallback is reading `.xlsx` via a stream-based alternative (e.g. `exceljs`) instead — not investigated here since it wasn't needed, but worth knowing the design isn't locked to SheetJS specifically.
