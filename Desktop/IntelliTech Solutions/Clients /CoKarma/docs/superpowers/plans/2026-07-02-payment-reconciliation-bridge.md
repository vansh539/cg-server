# CoKarma Payment Reconciliation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone WhatsApp bot + Postgres backend that lets CoKarma customers self-report payments (screenshot/UTR/cash), routes each claim to an admin for manual bank-verification, and maintains a per-customer dues/balance ledger — without requiring any integration into CoKarma's own systems.

**Architecture:** A single Node.js process (`src/whatsapp/bot.js`) running a `whatsapp-web.js` client handles all customer and admin conversation. Business logic (customer lookup, claims, balances, dues import) lives in plain, transport-agnostic modules under `src/ledger/` and `src/imports/`, so the bot file is a thin I/O layer that calls tested functions. PostgreSQL holds all state; `customer_balances` is a SQL view (never a stored/duplicated total) so balances can't drift from the underlying `dues`/`payment_claims` rows.

**Tech Stack:** Node.js 18+, Express-free (no HTTP surface needed yet), PostgreSQL (`pg`), `whatsapp-web.js` (unofficial, free, self-hosted — no Meta Cloud API, no per-message cost), `node-cron`, `csv-parse`, `winston`, PM2 for process management. Node's built-in `node:test` runner for automated tests (no test framework dependency).

## Global Constraints

- No paid messaging API or subscription — `whatsapp-web.js` only, per the approved design (see spec §"Why whatsapp-web.js over the official WhatsApp Cloud API").
- This is a standalone project, fully separate from the Jalan Group backend/DB/WhatsApp account — different client, different business. Do not add anything to `~/Desktop/JalanGroup-Complete/`.
- Development and manual testing happen on the developer's own WhatsApp number and a small `admins` table (dev number + up to two family test numbers). No hardcoded phone numbers anywhere in code — the linked WhatsApp account and the `admins` table rows are the only place numbers live, so swapping to the client's production number and removing test admins is an operational change, not a code change.
- Verification of payment claims is manual (an admin checks the real bank/UPI account) — no OCR, no automated bank-statement matching in this build.
- `customer_balances` must be implemented as a SQL view over `dues` and `payment_claims` using aggregated subqueries (not a direct multi-table join), to avoid a row fan-out bug that would silently inflate totals for any customer with more than one `dues` row and more than one `payment_claims` row.
- All money columns are `numeric(12,2)`, never floating point.

---

### Task 1: Project scaffold and database connection

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.env.test.example`
- Create: `.gitignore`
- Create: `src/utils/logger.js`
- Create: `src/db/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `require('../src/db/db')` → `{ pool, query(text, params), testConnection() }`. `query` returns the raw `pg` result (`{ rows, rowCount }`). `testConnection()` resolves `true`/`false`.
- Produces: `require('../src/utils/logger')` → `{ logger }` (winston instance with `.info/.warn/.error/.debug`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "cokarma-payment-bridge",
  "version": "1.0.0",
  "description": "WhatsApp payment reconciliation bridge for CoKarma customer payments",
  "main": "src/whatsapp/bot.js",
  "scripts": {
    "start": "node src/whatsapp/bot.js",
    "migrate": "node scripts/migrate.js",
    "seed-admin": "node scripts/seed-admin.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "csv-parse": "^5.5.6",
    "dotenv": "^16.4.5",
    "node-cron": "^3.0.3",
    "pg": "^8.11.5",
    "puppeteer": "^21.5.0",
    "qrcode-terminal": "^0.12.0",
    "whatsapp-web.js": "^1.34.7",
    "winston": "^3.13.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cokarma_bridge
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
WA_SESSION_PATH=./wa-sessions
PROOFS_PATH=./proofs
CHROME_PATH=
```

- [ ] **Step 3: Create `.env.test.example`**

```
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cokarma_bridge_test
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.env
.env.test
wa-sessions/
proofs/
logs/
*.log
```

- [ ] **Step 5: Create `src/utils/logger.js`**

```js
const winston = require('winston');
const fs = require('fs');

if (!fs.existsSync('logs')) fs.mkdirSync('logs');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} ${level}: ${message}${extras}`;
        })
      ),
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

module.exports = { logger };
```

- [ ] **Step 6: Create `src/db/db.js`**

```js
const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'cokarma_bridge',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Query executed', { duration, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    logger.error('DB query error', { error: err.message, query: text });
    throw err;
  }
};

const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW(), current_database()');
    logger.info(`Database connected: ${result.rows[0].current_database}`);
    return true;
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    return false;
  }
};

module.exports = { pool, query, testConnection };
```

- [ ] **Step 7: Create test database**

Run: `createdb cokarma_bridge_test`
Expected: no output (or "database already exists" if re-run)

Copy `.env.test.example` to `.env.test` and adjust credentials if your local Postgres needs a password.

- [ ] **Step 8: Write the failing test**

Create `tests/db.test.js`:

```js
require('dotenv').config({ path: '.env.test' });
const test = require('node:test');
const assert = require('node:assert/strict');
const { testConnection, pool } = require('../src/db/db');

test('testConnection connects to the test database', async () => {
  const ok = await testConnection();
  assert.equal(ok, true);
});

test.after(async () => {
  await pool.end();
});
```

- [ ] **Step 9: Run test to verify it fails or passes**

Run: `npm install && npm test`
Expected: PASS (this test only needs `db.js` and a reachable Postgres — if it fails, fix `.env.test` credentials before continuing, since every later task depends on DB connectivity)

- [ ] **Step 10: Commit**

```bash
git add package.json .env.example .env.test.example .gitignore src/utils/logger.js src/db/db.js tests/db.test.js
git commit -m "chore: scaffold project with DB connection"
```

---

### Task 2: Database schema and customer_balances view

**Files:**
- Create: `src/db/migrations/001_init.sql`
- Create: `scripts/migrate.js`
- Test: `tests/balances-view.test.js`
- Test helper: `tests/helpers/db.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js` (Task 1).
- Produces: tables `customers`, `dues_imports`, `dues`, `payment_claims`, `admins`; view `customer_balances(customer_id, name, phone_number, total_due, total_confirmed, balance)`. All later tasks query these directly.
- Produces: `require('../tests/helpers/db')` → `{ resetDb() }` — truncates all tables, used by every subsequent test file's `beforeEach`.

- [ ] **Step 1: Create `src/db/migrations/001_init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone_number text NOT NULL UNIQUE,
  cokarma_membership_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dues_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0
);

CREATE TABLE dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  description text NOT NULL,
  amount_due numeric(12,2) NOT NULL,
  due_date date,
  import_batch_id uuid REFERENCES dues_imports(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  amount_claimed numeric(12,2) NOT NULL,
  proof_type text NOT NULL CHECK (proof_type IN ('screenshot', 'utr_text', 'cash')),
  proof_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
);

CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- customer_balances aggregates dues and payment_claims in separate subqueries
-- before joining. Joining the two one-to-many tables directly (dues and
-- payment_claims both joined straight to customers) would fan out into a
-- cross product per customer — e.g. 2 dues rows x 3 confirmed claims rows
-- = 6 joined rows — silently inflating both SUM()s. Subqueries pre-aggregate
-- each table to one row per customer before the join, so this can't happen.
CREATE VIEW customer_balances AS
SELECT
  c.id AS customer_id,
  c.name,
  c.phone_number,
  COALESCE(d.total_due, 0)::numeric(12,2) AS total_due,
  COALESCE(p.total_confirmed, 0)::numeric(12,2) AS total_confirmed,
  (COALESCE(d.total_due, 0) - COALESCE(p.total_confirmed, 0))::numeric(12,2) AS balance
FROM customers c
LEFT JOIN (
  SELECT customer_id, SUM(amount_due) AS total_due
  FROM dues
  GROUP BY customer_id
) d ON d.customer_id = c.id
LEFT JOIN (
  SELECT customer_id, SUM(amount_claimed) AS total_confirmed
  FROM payment_claims
  WHERE status = 'confirmed'
  GROUP BY customer_id
) p ON p.customer_id = c.id;
```

- [ ] **Step 2: Create `scripts/migrate.js`**

```js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/db');

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
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
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Apply the migration to both databases**

Run:
```bash
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
```
Expected: `Applying migration: 001_init.sql` then `Migrations complete.` for both.

- [ ] **Step 4: Create `tests/helpers/db.js`**

```js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { pool } = require('../../src/db/db');

async function resetDb() {
  await pool.query(
    'TRUNCATE payment_claims, dues, dues_imports, customers, admins RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, pool };
```

- [ ] **Step 5: Write the failing test**

Create `tests/balances-view.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const { query } = require('../src/db/db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('customer_balances does not fan out when a customer has multiple dues and multiple confirmed claims', async () => {
  const { rows: [customer] } = await query(
    `INSERT INTO customers (name, phone_number) VALUES ('Test Customer', '9999900001') RETURNING id`
  );

  await query(`INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, 'Due A', 1000), ($1, 'Due B', 500)`, [customer.id]);

  await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status)
     VALUES ($1, 600, 'utr_text', 'confirmed'), ($1, 400, 'utr_text', 'confirmed'), ($1, 200, 'utr_text', 'pending')`,
    [customer.id]
  );

  const { rows: [balance] } = await query('SELECT * FROM customer_balances WHERE customer_id = $1', [customer.id]);

  assert.equal(Number(balance.total_due), 1500);
  assert.equal(Number(balance.total_confirmed), 1000);
  assert.equal(Number(balance.balance), 500);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS — if `total_due` shows `3000` or `total_confirmed` shows `2000`, the view has the fan-out bug; re-check Step 1's subquery structure.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/001_init.sql scripts/migrate.js tests/helpers/db.js tests/balances-view.test.js
git commit -m "feat: add database schema and fan-out-safe customer_balances view"
```

---

### Task 3: Customers module

**Files:**
- Create: `src/ledger/customers.js`
- Test: `tests/customers.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`.
- Produces: `require('../src/ledger/customers')` →
  - `normalizePhone(phone: string): string` — last 10 digits only.
  - `findByPhone(phone: string): Promise<Customer|null>`
  - `createCustomer({ name, phoneNumber }): Promise<Customer>`
  - `findByNameOrPhone(term: string): Promise<Customer[]>` (max 5 matches)
  - `linkMembershipId(customerId: string, membershipId: string): Promise<Customer|null>`
  - `Customer` shape: `{ id, name, phone_number, cokarma_membership_id, created_at }`

- [ ] **Step 1: Write the failing test**

Create `tests/customers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../src/ledger/customers');

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

test('linkMembershipId sets cokarma_membership_id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const updated = await customers.linkMembershipId(created.id, 'CK-1001');
  assert.equal(updated.cokarma_membership_id, 'CK-1001');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/ledger/customers'"

- [ ] **Step 3: Create `src/ledger/customers.js`**

```js
const { query } = require('../db/db');

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

async function linkMembershipId(customerId, membershipId) {
  const { rows } = await query(
    `UPDATE customers SET cokarma_membership_id = $2 WHERE id = $1 RETURNING *`,
    [customerId, membershipId]
  );
  return rows[0] || null;
}

module.exports = { normalizePhone, findByPhone, createCustomer, findByNameOrPhone, linkMembershipId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 4 tests in `customers.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/customers.js tests/customers.test.js
git commit -m "feat: add customers module with phone-normalized lookup"
```

---

### Task 4: Balances module

**Files:**
- Create: `src/ledger/balances.js`
- Test: `tests/balances.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`; `findByPhone`, `findByNameOrPhone` from `src/ledger/customers.js` (Task 3); `customer_balances` view (Task 2).
- Produces: `require('../src/ledger/balances')` →
  - `getBalanceByCustomerId(customerId): Promise<Balance|null>`
  - `getBalanceByPhone(phone): Promise<Balance|null>`
  - `searchBalances(term): Promise<Balance[]>`
  - `listUnlinkedCustomers(): Promise<{id, name, phone_number}[]>`
  - `Balance` shape: `{ customer_id, name, phone_number, total_due, total_confirmed, balance }`

- [ ] **Step 1: Write the failing test**

Create `tests/balances.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../src/ledger/customers');
const balances = require('../src/ledger/balances');
const { query } = require('../src/db/db');

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

test('listUnlinkedCustomers only returns customers with no membership id', async () => {
  const linked = await customers.createCustomer({ name: 'Linked', phoneNumber: '9111111111' });
  await customers.linkMembershipId(linked.id, 'CK-1');
  await customers.createCustomer({ name: 'Unlinked', phoneNumber: '9222222222' });

  const unlinked = await balances.listUnlinkedCustomers();
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].name, 'Unlinked');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/ledger/balances'"

- [ ] **Step 3: Create `src/ledger/balances.js`**

```js
const { query } = require('../db/db');
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
    `SELECT id, name, phone_number FROM customers WHERE cokarma_membership_id IS NULL ORDER BY created_at ASC`
  );
  return rows;
}

module.exports = { getBalanceByCustomerId, getBalanceByPhone, searchBalances, listUnlinkedCustomers };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 3 tests in `balances.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/balances.js tests/balances.test.js
git commit -m "feat: add balances module"
```

---

### Task 5: Payment claims module

**Files:**
- Create: `src/ledger/claims.js`
- Test: `tests/claims.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`.
- Produces: `require('../src/ledger/claims')` →
  - `createClaim({ customerId, amountClaimed, proofType, proofReference }): Promise<{ claim: Claim, duplicateOf: Claim|null }>`
  - `findDuplicateUtr(proofReference): Promise<Claim|null>`
  - `findClaimByIdPrefix(prefix: string): Promise<{id}[]>` (0, 1, or many matches — caller must handle ambiguity)
  - `confirmClaim(claimId: string, adminPhone: string): Promise<Claim|null>` (null if not found or not pending)
  - `rejectClaim(claimId: string, adminPhone: string, reason: string|null): Promise<Claim|null>`
  - `listPendingClaims(): Promise<ClaimWithCustomer[]>`
  - `listStaleClaims(hours: number): Promise<ClaimWithCustomer[]>`
  - `Claim` shape: `{ id, customer_id, amount_claimed, proof_type, proof_reference, status, reported_at, reviewed_by, reviewed_at, review_note }`
  - `ClaimWithCustomer` shape: `Claim` fields plus `name`, `phone_number`

- [ ] **Step 1: Write the failing test**

Create `tests/claims.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../src/ledger/customers');
const claims = require('../src/ledger/claims');
const { query } = require('../src/db/db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

async function makeCustomer(phone = '9848358160') {
  return customers.createCustomer({ name: 'Asha Rao', phoneNumber: phone });
}

test('createClaim inserts a pending claim with no duplicate', async () => {
  const customer = await makeCustomer();
  const { claim, duplicateOf } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345',
  });
  assert.equal(claim.status, 'pending');
  assert.equal(Number(claim.amount_claimed), 1500);
  assert.equal(duplicateOf, null);
});

test('createClaim flags a duplicate UTR against an existing claim', async () => {
  const customer = await makeCustomer();
  await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });

  const other = await makeCustomer('9111111111');
  const { duplicateOf } = await claims.createClaim({ customerId: other.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });

  assert.ok(duplicateOf);
  assert.equal(duplicateOf.proof_reference, 'UTR12345');
});

test('confirmClaim moves a pending claim to confirmed and records the reviewer', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const updated = await claims.confirmClaim(claim.id, '9999900000');
  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.reviewed_by, '9999900000');
});

test('confirmClaim returns null when the claim is already reviewed', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });
  await claims.confirmClaim(claim.id, '9999900000');

  const secondAttempt = await claims.confirmClaim(claim.id, '9999900000');
  assert.equal(secondAttempt, null);
});

test('rejectClaim moves a pending claim to rejected with a note', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const updated = await claims.rejectClaim(claim.id, '9999900000', 'amount mismatch');
  assert.equal(updated.status, 'rejected');
  assert.equal(updated.review_note, 'amount mismatch');
});

test('findClaimByIdPrefix matches on the leading characters of the uuid', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const matches = await claims.findClaimByIdPrefix(claim.id.slice(0, 8));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, claim.id);
});

test('listPendingClaims only returns pending claims, oldest first', async () => {
  const customer = await makeCustomer();
  const first = await claims.createClaim({ customerId: customer.id, amountClaimed: 100, proofType: 'cash', proofReference: null });
  const second = await claims.createClaim({ customerId: customer.id, amountClaimed: 200, proofType: 'cash', proofReference: null });
  await claims.confirmClaim(second.claim.id, '9999900000');

  const pending = await claims.listPendingClaims();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, first.claim.id);
  assert.equal(pending[0].name, 'Asha Rao');
});

test('listStaleClaims only returns pending claims older than the given hours', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 100, proofType: 'cash', proofReference: null });
  await query(`UPDATE payment_claims SET reported_at = now() - interval '2 days' WHERE id = $1`, [claim.id]);

  const stale = await claims.listStaleClaims(24);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, claim.id);

  const notStale = await claims.listStaleClaims(72);
  assert.equal(notStale.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/ledger/claims'"

- [ ] **Step 3: Create `src/ledger/claims.js`**

```js
const { query } = require('../db/db');

async function findDuplicateUtr(proofReference) {
  if (!proofReference) return null;
  const { rows } = await query(
    `SELECT * FROM payment_claims WHERE proof_type = 'utr_text' AND proof_reference = $1`,
    [proofReference]
  );
  return rows[0] || null;
}

async function createClaim({ customerId, amountClaimed, proofType, proofReference }) {
  const duplicate = proofType === 'utr_text' ? await findDuplicateUtr(proofReference) : null;

  const { rows } = await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, proof_reference)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [customerId, amountClaimed, proofType, proofReference || null]
  );

  return { claim: rows[0], duplicateOf: duplicate };
}

async function findClaimByIdPrefix(prefix) {
  const { rows } = await query(
    `SELECT id FROM payment_claims WHERE id::text LIKE $1 ORDER BY reported_at DESC LIMIT 5`,
    [`${prefix.toLowerCase()}%`]
  );
  return rows;
}

async function confirmClaim(claimId, adminPhone) {
  const { rows } = await query(
    `UPDATE payment_claims
     SET status = 'confirmed', reviewed_by = $2, reviewed_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [claimId, adminPhone]
  );
  return rows[0] || null;
}

async function rejectClaim(claimId, adminPhone, reason) {
  const { rows } = await query(
    `UPDATE payment_claims
     SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [claimId, adminPhone, reason || null]
  );
  return rows[0] || null;
}

async function listPendingClaims() {
  const { rows } = await query(
    `SELECT pc.*, c.name, c.phone_number
     FROM payment_claims pc
     JOIN customers c ON c.id = pc.customer_id
     WHERE pc.status = 'pending'
     ORDER BY pc.reported_at ASC`
  );
  return rows;
}

async function listStaleClaims(hours) {
  const { rows } = await query(
    `SELECT pc.*, c.name, c.phone_number
     FROM payment_claims pc
     JOIN customers c ON c.id = pc.customer_id
     WHERE pc.status = 'pending' AND pc.reported_at < now() - ($1 || ' hours')::interval
     ORDER BY pc.reported_at ASC`,
    [hours]
  );
  return rows;
}

module.exports = {
  createClaim, findDuplicateUtr, findClaimByIdPrefix,
  confirmClaim, rejectClaim, listPendingClaims, listStaleClaims,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 8 tests in `claims.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/claims.js tests/claims.test.js
git commit -m "feat: add payment claims module with duplicate-UTR detection"
```

---

### Task 6: Dues import module

**Files:**
- Create: `src/imports/duesImport.js`
- Test: `tests/dues-import.test.js`
- Test fixture: `tests/fixtures/dues-sample.csv`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`; `findByPhone` from `src/ledger/customers.js` (Task 3).
- Produces: `require('../src/imports/duesImport')` →
  - `parseDuesCsv(csvContent: string): DuesRow[]`
  - `importDuesFromFile(filePath: string, adminPhone: string): Promise<{ importBatchId, totalRows, unmatchedCount, unmatched: DuesRow[] }>`
  - `DuesRow` shape: `{ phoneNumber, name, membershipId, description, amountDue, dueDate }`

- [ ] **Step 1: Create the test fixture `tests/fixtures/dues-sample.csv`**

```csv
name,phone_number,membership_id,description,amount_due,due_date
Asha Rao,9848358160,CK-1001,July 2026 membership,5000,2026-07-05
Ravi Kumar,+91 91111 11111,CK-1002,July 2026 membership,4500,2026-07-05
Bad Row,,CK-1003,July 2026 membership,3000,2026-07-05
```

- [ ] **Step 2: Write the failing test**

Create `tests/dues-import.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resetDb, pool } = require('./helpers/db');
const duesImport = require('../src/imports/duesImport');
const customers = require('../src/ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('parseDuesCsv reads rows into a normalized shape', () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const rows = duesImport.parseDuesCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].membershipId, 'CK-1001');
  assert.equal(rows[0].amountDue, 5000);
});

test('importDuesFromFile creates new customers, links membership ids, and flags unmatched rows', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 1);

  const asha = await customers.findByPhone('9848358160');
  assert.ok(asha);
  assert.equal(asha.cokarma_membership_id, 'CK-1001');

  const ravi = await customers.findByPhone('+91 91111 11111');
  assert.ok(ravi);
  assert.equal(ravi.cokarma_membership_id, 'CK-1002');
});

test('importDuesFromFile does not overwrite an existing membership id', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const existing = await customers.findByPhone('9848358160');
  await customers.linkMembershipId(existing.id, 'ALREADY-SET');

  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');

  const after = await customers.findByPhone('9848358160');
  assert.equal(after.cokarma_membership_id, 'ALREADY-SET');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/imports/duesImport'"

- [ ] **Step 4: Create `src/imports/duesImport.js`**

```js
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { query } = require('../db/db');
const { findByPhone } = require('../ledger/customers');

function parseDuesCsv(csvContent) {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((r) => ({
    phoneNumber: r.phone_number || r.phone || '',
    name: r.name || '',
    membershipId: r.membership_id || r.cokarma_membership_id || null,
    description: r.description || 'CoKarma dues',
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
    if (!row.phoneNumber || Number.isNaN(row.amountDue) || row.amountDue <= 0) {
      unmatchedCount++;
      unmatched.push(row);
      continue;
    }

    let customer = await findByPhone(row.phoneNumber);
    if (!customer) {
      const { rows: created } = await query(
        `INSERT INTO customers (name, phone_number, cokarma_membership_id) VALUES ($1, $2, $3) RETURNING *`,
        [row.name || 'Unknown', row.phoneNumber, row.membershipId]
      );
      customer = created[0];
    } else if (row.membershipId && !customer.cokarma_membership_id) {
      await query(`UPDATE customers SET cokarma_membership_id = $2 WHERE id = $1`, [customer.id, row.membershipId]);
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

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests in `dues-import.test.js`, plus all earlier test files still passing)

- [ ] **Step 6: Commit**

```bash
git add src/imports/duesImport.js tests/dues-import.test.js tests/fixtures/dues-sample.csv
git commit -m "feat: add dues CSV import with membership-id linking"
```

---

### Task 7: Conversation flow parser (pure functions)

**Files:**
- Create: `src/whatsapp/flows.js`
- Test: `tests/flows.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no I/O, no DB).
- Produces: `require('../src/whatsapp/flows')` →
  - `handleRegistrationName(text): { ok: true, name } | { ok: false, error }`
  - `handleAmountReply(text): { ok: true, amount: number } | { ok: false, error }`
  - `handleProofReply(text, hasMedia: boolean): { ok: true, proofType: 'screenshot'|'utr_text'|'cash', proofReference: string|null } | { ok: false, error }`
  - `parseAdminCommand(text): { command: 'CONFIRM'|'REJECT'|'PENDING'|'PENDING_LINKS'|'BALANCE'|'IMPORT'|'UNKNOWN', claimId?, reason?, query? }`

This module is called by `src/whatsapp/bot.js` (Tasks 8-9) but has no dependency on it — it never touches the database or the WhatsApp client, which is what makes it unit-testable without a running bot or database.

- [ ] **Step 1: Write the failing test**

Create `tests/flows.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const flows = require('../src/whatsapp/flows');

test('handleRegistrationName rejects names under 2 characters', () => {
  assert.equal(flows.handleRegistrationName('A').ok, false);
});

test('handleRegistrationName accepts and trims a valid name', () => {
  const result = flows.handleRegistrationName('  Asha Rao  ');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Asha Rao');
});

test('handleAmountReply parses a plain number', () => {
  const result = flows.handleAmountReply('5000');
  assert.equal(result.ok, true);
  assert.equal(result.amount, 5000);
});

test('handleAmountReply strips currency symbols and commas', () => {
  const result = flows.handleAmountReply('₹5,000');
  assert.equal(result.ok, true);
  assert.equal(result.amount, 5000);
});

test('handleAmountReply rejects non-numeric or zero input', () => {
  assert.equal(flows.handleAmountReply('abc').ok, false);
  assert.equal(flows.handleAmountReply('0').ok, false);
  assert.equal(flows.handleAmountReply('-5').ok, false);
});

test('handleProofReply classifies media as a screenshot', () => {
  const result = flows.handleProofReply('', true);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'screenshot');
});

test('handleProofReply classifies CASH (case-insensitive)', () => {
  const result = flows.handleProofReply('cash', false);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'cash');
});

test('handleProofReply classifies an alphanumeric reference as utr_text, uppercased', () => {
  const result = flows.handleProofReply('utr123abc', false);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'utr_text');
  assert.equal(result.proofReference, 'UTR123ABC');
});

test('handleProofReply rejects unrecognizable input', () => {
  const result = flows.handleProofReply('idk maybe later', false);
  assert.equal(result.ok, false);
});

test('parseAdminCommand parses CONFIRM with an id', () => {
  assert.deepEqual(flows.parseAdminCommand('CONFIRM ab12cd34'), { command: 'CONFIRM', claimId: 'ab12cd34' });
});

test('parseAdminCommand parses REJECT with an id and reason', () => {
  assert.deepEqual(
    flows.parseAdminCommand('REJECT ab12cd34 wrong amount'),
    { command: 'REJECT', claimId: 'ab12cd34', reason: 'wrong amount' }
  );
});

test('parseAdminCommand parses REJECT with no reason', () => {
  assert.deepEqual(flows.parseAdminCommand('REJECT ab12cd34'), { command: 'REJECT', claimId: 'ab12cd34', reason: null });
});

test('parseAdminCommand parses PENDING LINKS distinctly from PENDING', () => {
  assert.deepEqual(flows.parseAdminCommand('pending'), { command: 'PENDING' });
  assert.deepEqual(flows.parseAdminCommand('pending links'), { command: 'PENDING_LINKS' });
});

test('parseAdminCommand parses BALANCE with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('balance Asha Rao'), { command: 'BALANCE', query: 'Asha Rao' });
});

test('parseAdminCommand parses IMPORT and unknown text', () => {
  assert.deepEqual(flows.parseAdminCommand('import'), { command: 'IMPORT' });
  assert.deepEqual(flows.parseAdminCommand('hello there'), { command: 'UNKNOWN' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/whatsapp/flows'"

- [ ] **Step 3: Create `src/whatsapp/flows.js`**

```js
function handleRegistrationName(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length < 2) {
    return { ok: false, error: 'Please tell me your name (at least 2 characters).' };
  }
  return { ok: true, name: trimmed };
}

function handleAmountReply(text) {
  const cleaned = (text || '').trim().replace(/[₹,]/g, '');
  const amount = parseFloat(cleaned);
  if (Number.isNaN(amount) || amount <= 0) {
    return { ok: false, error: 'Please reply with a valid amount, e.g. 5000' };
  }
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

function handleProofReply(text, hasMedia) {
  if (hasMedia) {
    return { ok: true, proofType: 'screenshot', proofReference: null };
  }
  const trimmed = (text || '').trim();
  if (/^cash$/i.test(trimmed)) {
    return { ok: true, proofType: 'cash', proofReference: null };
  }
  if (/^[a-zA-Z0-9]{6,30}$/.test(trimmed)) {
    return { ok: true, proofType: 'utr_text', proofReference: trimmed.toUpperCase() };
  }
  return { ok: false, error: 'Please send a screenshot, type your UPI reference/UTR number, or reply CASH.' };
}

function parseAdminCommand(text) {
  const trimmed = (text || '').trim();
  let m;

  if ((m = trimmed.match(/^confirm\s+(\S+)$/i))) return { command: 'CONFIRM', claimId: m[1] };
  if ((m = trimmed.match(/^reject\s+(\S+)\s+(.+)$/i))) return { command: 'REJECT', claimId: m[1], reason: m[2].trim() };
  if ((m = trimmed.match(/^reject\s+(\S+)$/i))) return { command: 'REJECT', claimId: m[1], reason: null };
  if (/^pending links$/i.test(trimmed)) return { command: 'PENDING_LINKS' };
  if (/^pending$/i.test(trimmed)) return { command: 'PENDING' };
  if ((m = trimmed.match(/^balance\s+(.+)$/i))) return { command: 'BALANCE', query: m[1].trim() };
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT' };

  return { command: 'UNKNOWN' };
}

module.exports = { handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 15 tests in `flows.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: add pure conversation/command flow parser"
```

---

### Task 8: WhatsApp bot core (connection, reliability, admin check)

**Files:**
- Create: `src/whatsapp/bot.js`
- Create: `scripts/seed-admin.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`; `logger` from `src/utils/logger.js`.
- Produces (module-level, used by Task 9): `client` (the `whatsapp-web.js` `Client` instance), `safeSend(msg, text)`, `resolveWaNumber(msg)`, `isAdmin(waNumber)`, `notifyAdmins(text)`, `setPending(waNumber, type, data)`, `clearPending(waNumber)`, `pendingConfirmations` (Map).

This task reuses the exact stability fixes already proven in the Jalan Group bot (`~/Desktop/JalanGroup-Complete/backend/src/whatsapp/bot.js`): Chrome/Singleton-lock cleanup on startup and exit, a spoofed modern Chrome user-agent (wwebjs's default UA is rejected by current WhatsApp Web), `webVersionCache`, a keepalive poll to stop headless Chrome from throttling, and `safeSend` using `client.sendMessage` (not `msg.reply`, which hangs on `@lid`-format contacts) with a hard timeout that exits the process so PM2 restarts it.

There is no automated test for this task — it requires a live WhatsApp connection. Verification is manual (Step 5 below), matching the precedent already established for the Jalan Group bot's conversational layer.

- [ ] **Step 1: Create `scripts/seed-admin.js`**

```js
require('dotenv').config();
const { pool } = require('../src/db/db');

async function main() {
  const [phoneNumber, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ') || 'Admin';

  if (!phoneNumber) {
    console.error('Usage: node scripts/seed-admin.js <phone_number> <name>');
    process.exit(1);
  }

  await pool.query(
    `INSERT INTO admins (phone_number, name, active) VALUES ($1, $2, true)
     ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name, active = true`,
    [phoneNumber, name]
  );
  console.log(`Admin seeded: ${name} (${phoneNumber})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Seed yourself (and any test numbers) as admins**

Run: `node scripts/seed-admin.js <your-10-digit-number> "Vansh"`
Expected: `Admin seeded: Vansh (<your-number>)`

Repeat for the family test numbers you plan to use.

- [ ] **Step 3: Create `src/whatsapp/bot.js`**

```js
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logger } = require('../utils/logger');
const { query } = require('../db/db');

const SESSION_DIR = process.env.WA_SESSION_PATH || './wa-sessions';
const PROOFS_DIR = process.env.PROOFS_PATH || './proofs';
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

// ── Chrome Cleanup ─────────────────────────────────────────────
// Kills orphaned Chrome and wipes stale Singleton/lock files that make the
// next launch hang forever. Same fix as the Jalan Group bot — must run at
// both STARTUP and EXIT.
function chromeCleanup() {
  const sessionDir = path.resolve(SESSION_DIR, 'session');
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore', shell: true }); } catch (_) {}
    try {
      if (fs.existsSync(sessionDir)) {
        for (const f of fs.readdirSync(sessionDir)) {
          if (f.startsWith('Singleton') || f === 'DevToolsActivePort') {
            try { fs.unlinkSync(path.join(sessionDir, f)); } catch (_) {}
          }
        }
      }
      const lock = path.join(sessionDir, 'Default', 'LOCK');
      if (fs.existsSync(lock)) try { fs.unlinkSync(lock); } catch (_) {}
    } catch (_) {}
  } else {
    try { execSync('pkill -9 -f "wa-sessions" 2>/dev/null || true', { stdio: 'ignore' }); } catch (_) {}
    try {
      execSync(
        `find "${sessionDir}" -maxdepth 1 \\( -name "Singleton*" -o -name "DevToolsActivePort" \\) -delete 2>/dev/null || true`,
        { stdio: 'ignore' }
      );
      execSync(`rm -f "${path.join(sessionDir, 'Default', 'LOCK')}" 2>/dev/null || true`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

if (require.main === module) {
  chromeCleanup();
  process.on('exit', chromeCleanup);
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
}

const startupWatchdog = setTimeout(() => {
  logger.error('[WhatsApp] Startup watchdog: not ready after 3 min — exiting for PM2 restart');
  process.exit(1);
}, 3 * 60 * 1000);

// ── Bot State ──────────────────────────────────────────────────
const pendingConfirmations = new Map();
const clearPending = (waNumber) => pendingConfirmations.delete(waNumber);
const setPending = (waNumber, type, data) => {
  pendingConfirmations.set(waNumber, { type, data, expiry: Date.now() + 10 * 60 * 1000 });
};

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  restartOnAuthFail: true,
  puppeteer: {
    executablePath: process.env.CHROME_PATH || (
      process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ),
    headless: true,
    timeout: 60000,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      `--user-agent=Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
    ],
  },
  webVersionCache: { type: 'local', strict: false },
});

// ── Resolve real phone number from an incoming message ─────────
async function resolveWaNumber(msg) {
  try {
    const contact = await msg.getContact();
    if (contact) {
      if (contact.id && contact.id.server === 'c.us') {
        return contact.id.user;
      }
      const num = String(contact.number || '').replace(/\D/g, '');
      if (num.length >= 10 && num.length <= 15) return num;
    }
  } catch (e) {
    logger.warn('[WhatsApp] getContact failed: ' + e.message);
  }
  if (msg.from.includes('@lid')) {
    return msg.from.replace('@lid', '').replace(/\D/g, '');
  }
  return msg.from.replace('@c.us', '').replace(/\D/g, '');
}

// ── Safe send: sendMessage (not reply) avoids LID-address hangs ────
async function safeSend(msg, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.error('[WhatsApp] safeSend timeout — exiting for PM2 restart');
      process.exit(1);
    }, 60000);
    client.sendMessage(msg.from, text)
      .then((r) => { clearTimeout(timer); resolve(r); })
      .catch(() => {
        msg.reply(text)
          .then((r) => { clearTimeout(timer); resolve(r); })
          .catch((e) => { clearTimeout(timer); reject(e); });
      });
  });
}

async function isAdmin(waNumber) {
  const { rows } = await query(
    `SELECT 1 FROM admins
     WHERE active = true
       AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [waNumber]
  );
  return rows.length > 0;
}

async function notifyAdmins(text) {
  const { rows } = await query('SELECT phone_number FROM admins WHERE active = true');
  for (const { phone_number } of rows) {
    const chatId = phone_number.replace(/\D/g, '') + '@c.us';
    try {
      await client.sendMessage(chatId, text);
    } catch (e) {
      logger.error('[WhatsApp] Failed to notify admin', { admin: phone_number, error: e.message });
    }
  }
}

client.on('qr', (qr) => {
  logger.info('[WhatsApp] Scan QR code to connect:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  clearTimeout(startupWatchdog);
  logger.info('[WhatsApp] Bot connected and ready!');
  setInterval(async () => {
    try { await client.getState(); } catch (_) {}
  }, 15000);
});

client.on('disconnected', (reason) => {
  logger.warn(`[WhatsApp] Disconnected: ${reason} — will auto-reconnect via restartOnAuthFail`);
});

client.on('auth_failure', (msg) => {
  logger.error('[WhatsApp] Auth failure:', msg);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[WhatsApp] Unhandled rejection — exiting for PM2 restart:', { error: reason?.message || String(reason) });
  process.exit(1);
});

if (require.main === module) {
  client.initialize();
}

module.exports = {
  client, safeSend, resolveWaNumber, isAdmin, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
};
```

- [ ] **Step 4: Install Chrome path if needed**

If you're on macOS with Chrome installed at the default path, no action needed. Otherwise set `CHROME_PATH` in `.env` to your Chrome executable.

- [ ] **Step 5: Manual verification — connect the bot**

Run: `npm start`
Expected: a QR code prints in the terminal. Scan it with WhatsApp on your phone (Linked Devices → Link a Device). Within a few seconds, the log should show `[WhatsApp] Bot connected and ready!`. Leave it running — the next task adds message handling.

- [ ] **Step 6: Commit**

```bash
git add src/whatsapp/bot.js scripts/seed-admin.js
git commit -m "feat: add WhatsApp bot core with proven reliability fixes"
```

---

### Task 9: Wire registration, payment-report, and admin commands into the message handler

**Files:**
- Modify: `src/whatsapp/bot.js` (add a `client.on('message', ...)` handler and its helper functions)

**Interfaces:**
- Consumes: everything from Task 8 (`client`, `safeSend`, `resolveWaNumber`, `isAdmin`, `notifyAdmins`, `pendingConfirmations`, `setPending`, `clearPending`, `PROOFS_DIR`); `flows` (Task 7); `customers` (Task 3); `claims` (Task 5); `balances` (Task 4); `duesImport` (Task 6).
- Produces: nothing new for later tasks — this is the top of the call chain.

No automated test — this wires already-tested pure logic (`flows.js`) and already-tested DB modules together via live WhatsApp I/O. Verified manually with the developer's own number as a customer and the seeded admin numbers.

- [ ] **Step 1: Add requires to the top of `src/whatsapp/bot.js`**

Add these lines after the existing `require('../db/db')` line:

```js
const customers = require('../ledger/customers');
const claims = require('../ledger/claims');
const balances = require('../ledger/balances');
const duesImport = require('../imports/duesImport');
const flows = require('./flows');
```

- [ ] **Step 2: Append the message handler and its helpers before the `if (require.main === module)` block**

Insert this before the existing `if (require.main === module) { client.initialize(); }` line:

```js
client.on('message', async (msg) => {
  try {
    if (msg.from.includes('@g.us') || msg.isStatus) return;

    const waNumber = await resolveWaNumber(msg);
    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    const admin = await isAdmin(waNumber);

    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, pending, text);
      return;
    }

    if (admin) {
      const parsed = flows.parseAdminCommand(text);
      await handleAdminCommand(msg, waNumber, parsed);
      return;
    }

    const customer = await customers.findByPhone(waNumber);
    if (!customer) {
      setPending(waNumber, 'registration_name', {});
      await safeSend(msg, "Welcome! I don't have you registered yet. What's your name?");
      return;
    }

    if (/^paid$/i.test(text)) {
      setPending(waNumber, 'awaiting_amount', { customerId: customer.id });
      await safeSend(msg, 'Got it — how much did you pay?');
      return;
    }

    await safeSend(msg, `Hi ${customer.name}! Reply *PAID* any time you make a payment to CoKarma.`);
  } catch (e) {
    logger.error('[WhatsApp] message handler error', { error: e.message });
  }
});

async function handlePendingReply(msg, waNumber, pending, text) {
  if (pending.type === 'registration_name') {
    const result = flows.handleRegistrationName(text);
    if (!result.ok) { await safeSend(msg, result.error); return; }
    const customer = await customers.createCustomer({ name: result.name, phoneNumber: waNumber });
    clearPending(waNumber);
    await safeSend(msg, `Thanks, ${customer.name}! You're registered. Reply *PAID* any time you make a payment to CoKarma.`);
    return;
  }

  if (pending.type === 'awaiting_amount') {
    const result = flows.handleAmountReply(text);
    if (!result.ok) { await safeSend(msg, result.error); return; }
    setPending(waNumber, 'awaiting_proof', { customerId: pending.data.customerId, amount: result.amount });
    await safeSend(msg, 'Now send a screenshot of the payment, type the UPI reference/UTR number, or reply CASH if you paid cash.');
    return;
  }

  if (pending.type === 'awaiting_proof') {
    const result = flows.handleProofReply(text, msg.hasMedia);
    if (!result.ok) { await safeSend(msg, result.error); return; }

    let proofReference = result.proofReference;
    if (result.proofType === 'screenshot') {
      const media = await msg.downloadMedia();
      const ext = (media.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
      const fileName = `${Date.now()}-${waNumber}.${ext}`;
      fs.writeFileSync(path.join(PROOFS_DIR, fileName), media.data, 'base64');
      proofReference = fileName;
    }

    const { claim, duplicateOf } = await claims.createClaim({
      customerId: pending.data.customerId,
      amountClaimed: pending.data.amount,
      proofType: result.proofType,
      proofReference,
    });
    clearPending(waNumber);

    const shortId = claim.id.slice(0, 8);
    await safeSend(msg, `Thanks! Your payment of ₹${pending.data.amount} has been recorded (claim #${shortId}) and is pending verification.`);

    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`
    );
    return;
  }
}

async function handleAdminCommand(msg, waNumber, parsed) {
  if (parsed.command === 'CONFIRM' || parsed.command === 'REJECT') {
    const matches = await claims.findClaimByIdPrefix(parsed.claimId);
    if (matches.length === 0) { await safeSend(msg, `No claim found matching "${parsed.claimId}".`); return; }
    if (matches.length > 1) { await safeSend(msg, `Multiple claims match "${parsed.claimId}" — use more characters.`); return; }

    const fullId = matches[0].id;
    if (parsed.command === 'CONFIRM') {
      const updated = await claims.confirmClaim(fullId, waNumber);
      await safeSend(msg, updated ? `Claim #${parsed.claimId} confirmed.` : `Claim #${parsed.claimId} was already reviewed.`);
    } else {
      const updated = await claims.rejectClaim(fullId, waNumber, parsed.reason);
      await safeSend(msg, updated ? `Claim #${parsed.claimId} rejected.` : `Claim #${parsed.claimId} was already reviewed.`);
    }
    return;
  }

  if (parsed.command === 'PENDING') {
    const rows = await claims.listPendingClaims();
    if (rows.length === 0) { await safeSend(msg, 'No pending claims.'); return; }
    const lines = rows.map((r) => `#${r.id.slice(0, 8)} ${r.name} (${r.phone_number}) ₹${r.amount_claimed} [${r.proof_type}]`);
    await safeSend(msg, `Pending claims:\n${lines.join('\n')}`);
    return;
  }

  if (parsed.command === 'PENDING_LINKS') {
    const rows = await balances.listUnlinkedCustomers();
    if (rows.length === 0) { await safeSend(msg, 'No unlinked customers.'); return; }
    const lines = rows.map((r) => `${r.name} (${r.phone_number})`);
    await safeSend(msg, `Unlinked customers:\n${lines.join('\n')}`);
    return;
  }

  if (parsed.command === 'BALANCE') {
    const results = await balances.searchBalances(parsed.query);
    if (results.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    const lines = results.map((r) => `${r.name}: due ₹${r.total_due}, confirmed ₹${r.total_confirmed}, balance ₹${r.balance}`);
    await safeSend(msg, lines.join('\n'));
    return;
  }

  if (parsed.command === 'IMPORT') {
    if (!msg.hasMedia) { await safeSend(msg, 'Send the CSV file as an attachment with caption IMPORT.'); return; }
    const media = await msg.downloadMedia();
    const fileName = path.join(PROOFS_DIR, `import-${Date.now()}.csv`);
    fs.writeFileSync(fileName, Buffer.from(media.data, 'base64'));
    const result = await duesImport.importDuesFromFile(fileName, waNumber);
    await safeSend(msg, `Import complete: ${result.totalRows} rows, ${result.unmatchedCount} unmatched.`);
    return;
  }

  await safeSend(msg, 'Unknown command. Try PAID, PENDING, PENDING LINKS, BALANCE <name>, CONFIRM <id>, REJECT <id> <reason>, or IMPORT (with a CSV attachment).');
}
```

- [ ] **Step 3: Manual verification — full customer flow**

With the bot running (`npm start`) and connected:
1. Message the bot from an unregistered test number → expect the name prompt → reply with a name → expect the registration confirmation.
2. Reply `PAID` → expect the amount prompt → reply `5000` → expect the proof prompt → reply `CASH` → expect the claim confirmation.
3. From your seeded admin number, expect to have received the "New payment claim" notification with a `#<shortId>`.

- [ ] **Step 4: Manual verification — admin commands**

From the admin number: send `PENDING` (should list the claim from Step 3), `CONFIRM <shortId>` (should confirm it), `BALANCE <name>` (should show the updated balance), `PENDING LINKS` (should list the unlinked test customer).

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/bot.js
git commit -m "feat: wire registration, payment reporting, and admin commands into the bot"
```

---

### Task 10: Stale-claims digest

**Files:**
- Modify: `src/whatsapp/bot.js` (add a `node-cron` job)

**Interfaces:**
- Consumes: `claims.listStaleClaims(hours)` (Task 5, already tested); `notifyAdmins` (Task 8).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the cron require**

Add near the top of `src/whatsapp/bot.js`, after the other requires:

```js
const cron = require('node-cron');
```

- [ ] **Step 2: Add the scheduled job**

Insert this right after the `handleAdminCommand` function definition (still before the `if (require.main === module)` block):

```js
// Daily 9 AM IST digest of claims that have sat pending for 24h+
if (require.main === module) {
  cron.schedule('0 9 * * *', async () => {
    const stale = await claims.listStaleClaims(24);
    if (stale.length === 0) return;
    const lines = stale.map((r) => `#${r.id.slice(0, 8)} ${r.name} (${r.phone_number}) ₹${r.amount_claimed} — reported ${r.reported_at}`);
    await notifyAdmins(`⏰ ${stale.length} claim(s) pending review for 24h+:\n${lines.join('\n')}`);
  }, { timezone: 'Asia/Kolkata' });
}
```

- [ ] **Step 3: Manual verification**

Create a test claim, then run:
```bash
node -e "
require('dotenv').config();
const { query, pool } = require('./src/db/db');
query(\"UPDATE payment_claims SET reported_at = now() - interval '2 days' WHERE status = 'pending'\").then(() => pool.end());
"
```
Temporarily change the cron expression to `* * * * *` (every minute), restart `npm start`, confirm the admin number receives the digest within a minute, then change the expression back to `'0 9 * * *'`.

- [ ] **Step 4: Commit**

```bash
git add src/whatsapp/bot.js
git commit -m "feat: add daily stale-claims digest for admins"
```

---

### Task 11: Process management and deployment docs

**Files:**
- Create: `ecosystem.config.js`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing new — this packages Tasks 1-10 for deployment.

- [ ] **Step 1: Create `ecosystem.config.js`**

```js
module.exports = {
  apps: [
    {
      name: 'cokarma-bridge',
      script: 'src/whatsapp/bot.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 30000,
      max_restarts: 5,
      min_uptime: '30s',
    },
  ],
};
```

- [ ] **Step 2: Create `README.md`**

```markdown
# CoKarma Payment Reconciliation Bridge

A WhatsApp bot that lets CoKarma customers self-report payments (screenshot,
UPI reference, or cash) and routes each claim to an admin for manual bank
verification, maintaining a per-customer dues/balance ledger — without any
integration into CoKarma's own systems.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Postgres credentials.
3. Create the database: `createdb cokarma_bridge`
4. Run migrations: `npm run migrate`
5. Seed at least one admin: `node scripts/seed-admin.js <phone> "<name>"`
6. Start the bot: `npm start` (or `pm2 start ecosystem.config.js` for production)
7. Scan the printed QR code with WhatsApp (Linked Devices → Link a Device)

## Customer commands

- Any message from an unregistered number triggers a one-time name prompt.
- `PAID` starts the guided payment-report flow (amount, then proof).

## Admin commands

- `CONFIRM <claim-id>` / `REJECT <claim-id> [reason]`
- `PENDING` — list open claims
- `PENDING LINKS` — list customers not yet linked to a CoKarma membership id
- `BALANCE <name or phone>` — look up a customer's dues/paid/balance
- `IMPORT` — attach a CSV (columns: `name, phone_number, membership_id, description, amount_due, due_date`) to load dues

## Testing

`npm test` runs against `cokarma_bridge_test` (see `.env.test.example`).
Run `createdb cokarma_bridge_test && DB_NAME=cokarma_bridge_test npm run migrate` once before the first test run.

## Moving to the client's production number

Nothing in the code references a specific phone number. To switch from the
developer's number to the client's:
1. Stop the bot: `pm2 stop cokarma-bridge`
2. Delete the session: `rm -rf wa-sessions/`
3. Remove test admins: update the `admins` table (`active = false` or delete the rows)
4. Seed the client's real admin number(s): `node scripts/seed-admin.js <phone> "<name>"`
5. Restart: `pm2 start cokarma-bridge` and scan the new QR with the client's WhatsApp
```

- [ ] **Step 3: Manual verification**

Run: `pm2 start ecosystem.config.js && pm2 logs cokarma-bridge --lines 30`
Expected: logs show Chrome cleanup, then the QR prompt (or `Bot connected and ready!` if a session already exists from Task 8-9 testing).

- [ ] **Step 4: Commit**

```bash
git add ecosystem.config.js README.md
git commit -m "chore: add PM2 config and deployment README"
```

---

## Post-plan notes (not part of this build)

- **Getting an actual dues list from CoKarma** is an operational step for the client/admin, not a code task — the `IMPORT` command exists and is tested; it just needs a real CSV.
- **Web dashboard**: `confirmClaim`/`rejectClaim`/`listPendingClaims`/`searchBalances` are already transport-agnostic functions in `src/ledger/`, so a future Express HTTP layer can call them directly without touching this code.
- **Official WhatsApp Cloud API migration**: out of scope per the cost constraint; if ever needed, the transport-specific code is isolated to `src/whatsapp/bot.js` — the `src/ledger/`, `src/imports/`, and `src/whatsapp/flows.js` modules would be unaffected.
- **No explicit cancel/reset command**: a customer or admin stuck mid-flow (e.g. wrong amount typed) has to wait out the 10-minute `pendingConfirmations` expiry rather than typing something like `0` or `MENU` to bail out immediately, unlike the Jalan Group bot's pattern. Low-risk given the short expiry, but worth adding as a quick follow-up if it proves annoying in practice.
- **`EDIT <id> <amount>` admin shortcut**: noted in the design as a likely v1.1 addition (to correct a claim instead of reject-and-resubmit); intentionally left out of this plan since it's not needed for a working v1.
