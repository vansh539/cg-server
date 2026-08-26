# WhatsApp Staff Bot Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Aaral Marketing WhatsApp bot from a customer self-report/claim-review tool into a staff-only assistant: staff record payments by texting free-form messages ("Received 15000 payment from Shyam miyapur today"), fetch a customer's ledger on request, and OCR/customer self-service are removed entirely.

**Architecture:** Staff identity moves from the standalone `admins` phone table (kept, but repurposed to just business-activity broadcasts) to `dashboard_users.phone_number` (new column). A new pure-function parser module (`paymentIntent.js`, no I/O) extracts amount/date/method/customer-name-candidates from free text; `bot.js` orchestrates the multi-turn confirm/clarify flow using the existing `pendingConfirmations` state machine. Payment writes go through a `recordPayment` function lifted into the shared `payment-ledger-core` package so both the dashboard and the bot call identical code. Ledger PDFs stay dashboard-only (Puppeteer already lives there); the bot reaches them via a new secret-gated internal HTTP endpoint.

**Tech Stack:** Node.js (`node --test`, no test framework), Express, PostgreSQL (`pg`), `whatsapp-web.js`, new dependency `chrono-node` for date parsing.

**Spec:** `docs/superpowers/specs/2026-08-26-whatsapp-staff-bot-redesign-design.md`

## Global Constraints

- No external AI/LLM calls and no local model — parsing is deterministic (regex + `chrono-node`), per the spec's rejected-alternatives section.
- The `admins` table (shared `payment-ledger-core` schema, used by other clients) is never renamed, dropped, or repurposed — it keeps doing business-activity broadcasts exactly as today.
- Every payment write goes through `payment-ledger-core/ledger/payments.js`'s `recordPayment` — no second copy of that INSERT anywhere.
- Non-staff WhatsApp numbers are always silently ignored — no test-mode carve-out, no exceptions.
- A payment is never written to the ledger without an explicit `YES` from the staff member who reported it.
- The new dashboard-internal route must not be reachable without the shared secret — dashboard binds `0.0.0.0` for LAN access, so this is a real, not theoretical, exposure.
- All new PostgreSQL-backed tests use the existing `node --test` + real-Postgres-via-`resetDb` convention already established in `payment-ledger-core/tests/` and `dashboard/tests/` — no mocked DB.

---

## File Structure

```
packages/payment-ledger-core/
  ledger/payments.js          [NEW] recordPayment, lifted from dashboard
  tests/payments.test.js      [NEW]

dashboard/
  migrations-aaral/007_add_staff_phone.sql   [NEW]
  src/ledgerEntries.js        [NEW] fetchLedgerEntries, extracted from routes/ledger.js
  src/routes/ledger.js        [MODIFY] import fetchLedgerEntries instead of defining it
  src/routes/botInternal.js   [NEW] POST /internal/bot/ledger-pdf, secret-gated
  src/payments.js             [MODIFY] thin re-export of the shared recordPayment
  src/routes/users.js         [MODIFY] phone field, edit-phone route, hard-delete route
  public/users.html           [MODIFY] phone field, edit action, delete action
  server.js                   [MODIFY] mount botInternal router before requireSession
  tests/botInternal.test.js   [NEW]
  tests/users.test.js         [NEW]
  .env.example / .env.production / .env.test   [MODIFY] BOT_INTERNAL_SECRET

whatsapp-bot/
  ocr-service/                [DELETE] entire directory
  src/whatsapp/flows.js       [MODIFY] drop OCR + customer-flow helpers, trim parseAdminCommand
  src/whatsapp/paymentIntent.js  [NEW] pure parsing module
  src/whatsapp/bot.js         [MODIFY] staff-only gating, OCR removal, payment/ledger command wiring
  tests/flows.test.js         [MODIFY] drop OCR/customer-flow tests, add LEDGER test
  tests/paymentIntent.test.js [NEW]
  .env.example / .env.production / .env.test   [MODIFY] BOT_INTERNAL_SECRET, DASHBOARD_INTERNAL_URL, drop TEST_MODE_ALLOWED_NUMBERS
  .gitignore                  [MODIFY] drop ocr-service/ lines
  package.json                [MODIFY] add chrono-node, drop nothing (OCR had no npm dep)
```

---

### Task 1: Migration — `dashboard_users.phone_number`

**Files:**
- Create: `dashboard/migrations-aaral/007_add_staff_phone.sql`

**Interfaces:**
- Produces: a nullable, unique `phone_number` column on `dashboard_users`, consumed by Task 8 (Users page routes) and Task 12 (`resolveStaffUser` in bot.js).

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE dashboard_users ADD COLUMN phone_number text UNIQUE;
```

- [ ] **Step 2: Apply it to the test database and verify the column**

```bash
psql -h localhost -U postgres -d aaral_bridge_test -f "dashboard/migrations-aaral/007_add_staff_phone.sql"
psql -h localhost -U postgres -d aaral_bridge_test -c "\d dashboard_users"
```

Expected: `phone_number | text` appears in the column list, with a `dashboard_users_phone_number_key` UNIQUE constraint listed under Indexes.

- [ ] **Step 3: Verify the UNIQUE constraint is enforced**

```bash
psql -h localhost -U postgres -d aaral_bridge_test -c "
INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
VALUES ('dup1', 'x', 'Dup One', 'employee', '9999999999');
INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
VALUES ('dup2', 'x', 'Dup Two', 'employee', '9999999999');
"
```

Expected: the second INSERT fails with `duplicate key value violates unique constraint "dashboard_users_phone_number_key"`.

- [ ] **Step 4: Clean up the manual test rows and apply to local dev DB**

```bash
psql -h localhost -U postgres -d aaral_bridge_test -c "DELETE FROM dashboard_users WHERE username IN ('dup1','dup2');"
cd "dashboard" && npm run migrate
```

Expected: migrate output includes `Applying Aaral migration: 007_add_staff_phone.sql`.

- [ ] **Step 5: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/migrations-aaral/007_add_staff_phone.sql"
git commit -m "feat(aaral): add phone_number to dashboard_users for WhatsApp staff access"
```

---

### Task 2: Shared `recordPayment` in `payment-ledger-core`

**Files:**
- Create: `packages/payment-ledger-core/ledger/payments.js`
- Create: `packages/payment-ledger-core/tests/payments.test.js`
- Modify: `dashboard/src/payments.js`

**Interfaces:**
- Produces: `recordPayment({ customerId, amount, method, date, createdBy }) → Promise<paymentClaimRow>`, `VALID_METHODS = ['cash', 'gpay', 'bank_transfer']`, both from `payment-ledger-core/ledger/payments`. Consumed by Task 13 (bot's payment-recording flow) and by `dashboard/src/routes/payments.js` (already imports from `../payments`, unchanged call site).

- [ ] **Step 1: Write the failing test**

Create `packages/payment-ledger-core/tests/payments.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');
const balances = require('../ledger/balances');
const { recordPayment } = require('../ledger/payments');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('recordPayment inserts an immediately-confirmed claim and updates the balance', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });

  const payment = await recordPayment({
    customerId: customer.id, amount: 5000, method: 'gpay', date: '2026-07-19', createdBy: 'dashboard',
  });

  assert.equal(payment.status, 'confirmed');
  assert.equal(payment.proof_type, 'gpay');
  assert.equal(Number(payment.amount_claimed), 5000);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), -5000);
});

test('recordPayment accepts cash and bank_transfer methods', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });
  const cash = await recordPayment({ customerId: customer.id, amount: 100, method: 'cash', date: null, createdBy: 'dashboard' });
  const bank = await recordPayment({ customerId: customer.id, amount: 200, method: 'bank_transfer', date: null, createdBy: 'dashboard' });
  assert.equal(cash.proof_type, 'cash');
  assert.equal(bank.proof_type, 'bank_transfer');
});

test('recordPayment rejects an unknown method', async () => {
  const customer = await customers.createCustomer({ name: 'Anil Hardware', phoneNumber: '9812345672' });
  await assert.rejects(
    () => recordPayment({ customerId: customer.id, amount: 100, method: 'cheque', date: null, createdBy: 'dashboard' }),
    /method must be one of/
  );
});

test('recordPayment rejects a non-positive amount', async () => {
  const customer = await customers.createCustomer({ name: 'Deepak Cement', phoneNumber: '9812345673' });
  await assert.rejects(
    () => recordPayment({ customerId: customer.id, amount: 0, method: 'cash', date: null, createdBy: 'dashboard' }),
    /positive number/
  );
});

test('recordPayment requires a customerId', async () => {
  await assert.rejects(
    () => recordPayment({ customerId: null, amount: 100, method: 'cash', date: null, createdBy: 'dashboard' }),
    /customerId is required/
  );
});

test('recordPayment defaults createdBy to "system" when omitted', async () => {
  const customer = await customers.createCustomer({ name: 'Test Co', phoneNumber: '9812345699' });
  const payment = await recordPayment({ customerId: customer.id, amount: 100, method: 'cash', date: null });
  assert.equal(payment.reviewed_by, 'system');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "packages/payment-ledger-core" && npm test -- tests/payments.test.js
```

Expected: FAIL — `Cannot find module '../ledger/payments'`.

- [ ] **Step 3: Write the implementation**

Create `packages/payment-ledger-core/ledger/payments.js`:

```js
const { pool } = require('../db');

const VALID_METHODS = ['cash', 'gpay', 'bank_transfer'];

function resolveEffectiveDate(dateStr) {
  if (!dateStr) return null;
  const timeOfDay = new Date().toTimeString().split(' ')[0];
  return new Date(`${dateStr}T${timeOfDay}`);
}

async function recordPayment({ customerId, amount, method, date, createdBy }) {
  const amountNum = Number(amount);
  if (!customerId) throw new Error('customerId is required');
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('amount must be a positive number');
  if (!VALID_METHODS.includes(method)) throw new Error(`method must be one of: ${VALID_METHODS.join(', ')}`);

  const effectiveDate = resolveEffectiveDate(date);

  const { rows } = await pool.query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status, reviewed_by, reviewed_at, reported_at)
     VALUES ($1, $2, $3, 'confirmed', $4, COALESCE($5, now()), COALESCE($5, now())) RETURNING *`,
    [customerId, amountNum, method, createdBy || 'system', effectiveDate]
  );

  return rows[0];
}

module.exports = { recordPayment, resolveEffectiveDate, VALID_METHODS };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "packages/payment-ledger-core" && npm test -- tests/payments.test.js
```

Expected: PASS, all 6 tests.

- [ ] **Step 5: Replace `dashboard/src/payments.js` with a re-export**

Replace the entire contents of `dashboard/src/payments.js` with:

```js
module.exports = require('payment-ledger-core/ledger/payments');
```

- [ ] **Step 6: Run dashboard's existing test as a regression check**

```bash
cd dashboard && npm test -- tests/payments.test.js
```

Expected: PASS, all 5 existing tests still pass unchanged (they import `recordPayment` from `../src/payments`, which now re-exports the shared function).

- [ ] **Step 7: Commit**

```bash
git add "Desktop/IntelliTech Solutions/packages/payment-ledger-core/ledger/payments.js" \
        "Desktop/IntelliTech Solutions/packages/payment-ledger-core/tests/payments.test.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/payments.js"
git commit -m "refactor(payment-ledger-core): lift recordPayment into the shared package"
```

---

### Task 3: `paymentIntent.js` — amount extraction

**Files:**
- Create: `whatsapp-bot/src/whatsapp/paymentIntent.js`
- Create: `whatsapp-bot/tests/paymentIntent.test.js`

**Interfaces:**
- Produces: `extractAmount(text) → number|null`. Consumed by `parsePaymentMessage` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `whatsapp-bot/tests/paymentIntent.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAmount } = require('../src/whatsapp/paymentIntent');

test('extractAmount finds a plain bare number', () => {
  assert.equal(extractAmount('Received 15000 payment from Shyam'), 15000);
});

test('extractAmount finds a currency-prefixed amount with commas', () => {
  assert.equal(extractAmount('Got ₹5,000 cash from Ramesh'), 5000);
});

test('extractAmount finds an Rs.-prefixed amount', () => {
  assert.equal(extractAmount('paid Rs.2500 today'), 2500);
});

test('extractAmount handles a decimal amount', () => {
  assert.equal(extractAmount('1234.50 received'), 1234.5);
});

test('extractAmount returns null when no amount-shaped number is present', () => {
  assert.equal(extractAmount('no amount mentioned here'), null);
});

test('extractAmount ignores small bare numbers under the 100 floor', () => {
  assert.equal(extractAmount('table 5 paid nothing'), null);
});

test('extractAmount picks the largest bare candidate when several are present and none is currency-marked', () => {
  assert.equal(extractAmount('15000 from Shyam, previous balance was 8000'), 15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: FAIL — `Cannot find module '../src/whatsapp/paymentIntent'`.

- [ ] **Step 3: Write the implementation**

Create `whatsapp-bot/src/whatsapp/paymentIntent.js`:

```js
// Parses a free-text staff message ("Received 15000 payment from Shyam
// miyapur today") into amount/date/method/customer-name-candidates. Pure
// functions only -- no DB, no I/O -- so bot.js is the only place that talks
// to Postgres or WhatsApp. Mirrors flows.js's existing pure/impure split.

function extractAmount(text) {
  const cleaned = String(text || '');

  const currencyMarked = cleaned.match(
    /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr|rupees?)/i
  );
  if (currencyMarked) {
    const raw = (currencyMarked[1] || currencyMarked[2]).replace(/,/g, '');
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }

  // No currency marker -- fall back to the largest bare number with at
  // least 3 digits. Payment amounts in this business are never single- or
  // double-digit, so this floor keeps stray small numbers (a customer's
  // door number, a quantity) out of consideration.
  const bareNumbers = cleaned.match(/\d[\d,]*(?:\.\d{1,2})?/g) || [];
  const candidates = bareNumbers
    .map((n) => parseFloat(n.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 100);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

module.exports = { extractAmount };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/paymentIntent.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/tests/paymentIntent.test.js"
git commit -m "feat(aaral-bot): add extractAmount for free-text payment messages"
```

---

### Task 4: `paymentIntent.js` — date extraction via `chrono-node`

**Files:**
- Modify: `whatsapp-bot/package.json` (add `chrono-node`)
- Modify: `whatsapp-bot/src/whatsapp/paymentIntent.js`
- Modify: `whatsapp-bot/tests/paymentIntent.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractDateInfo(text, referenceDate = new Date()) → { iso: 'YYYY-MM-DD', matchedText: string|null }`. Consumed by `parsePaymentMessage` (Task 6), which uses `matchedText` to mask the date out of the string before amount/method/name extraction run.

- [ ] **Step 1: Add the dependency**

```bash
cd "whatsapp-bot" && npm install chrono-node@^2.7.7
```

- [ ] **Step 2: Write the failing test**

Append to `whatsapp-bot/tests/paymentIntent.test.js`:

```js
const { extractDateInfo } = require('../src/whatsapp/paymentIntent');

const REF = new Date('2026-08-26T12:00:00');

test('extractDateInfo defaults to the reference date when nothing is mentioned', () => {
  const result = extractDateInfo('Received 15000 from Shyam', REF);
  assert.equal(result.iso, '2026-08-26');
  assert.equal(result.matchedText, null);
});

test('extractDateInfo parses "today"', () => {
  const result = extractDateInfo('Received 15000 from Shyam today', REF);
  assert.equal(result.iso, '2026-08-26');
});

test('extractDateInfo parses "yesterday"', () => {
  const result = extractDateInfo('Received 15000 from Shyam yesterday', REF);
  assert.equal(result.iso, '2026-08-25');
});

test('extractDateInfo parses an explicit dd-mm-yyyy date', () => {
  const result = extractDateInfo('Received 15000 from Shyam on 15-06-2026', REF);
  assert.equal(result.iso, '2026-06-15');
});

test('extractDateInfo parses "15th Aug"', () => {
  const result = extractDateInfo('Received 15000 from Shyam on 15th Aug', REF);
  assert.equal(result.iso, '2026-08-15');
});

test('extractDateInfo parses "3 days ago"', () => {
  const result = extractDateInfo('Received 15000 from Shyam 3 days ago', REF);
  assert.equal(result.iso, '2026-08-23');
});

test('extractDateInfo returns the matched substring so it can be masked out', () => {
  const result = extractDateInfo('Received 15000 from Shyam yesterday', REF);
  assert.equal(result.matchedText, 'yesterday');
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: FAIL — `extractDateInfo is not a function`.

- [ ] **Step 4: Write the implementation**

Add to `whatsapp-bot/src/whatsapp/paymentIntent.js` (below `extractAmount`, above `module.exports`):

```js
const chrono = require('chrono-node');

function toIsoDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractDateInfo(text, referenceDate = new Date()) {
  const results = chrono.parse(String(text || ''), referenceDate, { forwardDate: false });
  if (results.length === 0) {
    return { iso: toIsoDate(referenceDate), matchedText: null };
  }
  const best = results[0];
  return { iso: toIsoDate(best.date()), matchedText: best.text };
}
```

Update the `module.exports` line to:

```js
module.exports = { extractAmount, extractDateInfo, toIsoDate };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: PASS, all 14 tests (7 from Task 3 + 7 new).

- [ ] **Step 6: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/package.json" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/package-lock.json" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/paymentIntent.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/tests/paymentIntent.test.js"
git commit -m "feat(aaral-bot): add chrono-node date extraction for payment messages"
```

---

### Task 5: `paymentIntent.js` — payment method extraction

**Files:**
- Modify: `whatsapp-bot/src/whatsapp/paymentIntent.js`
- Modify: `whatsapp-bot/tests/paymentIntent.test.js`

**Interfaces:**
- Produces: `extractMethod(text) → 'cash'|'gpay'|'bank_transfer'|null`. Consumed by `parsePaymentMessage` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `whatsapp-bot/tests/paymentIntent.test.js`:

```js
const { extractMethod } = require('../src/whatsapp/paymentIntent');

test('extractMethod recognizes cash', () => {
  assert.equal(extractMethod('received 5000 cash from Ramesh'), 'cash');
});

test('extractMethod recognizes gpay and its spelling variants', () => {
  assert.equal(extractMethod('5000 via gpay from Shyam'), 'gpay');
  assert.equal(extractMethod('5000 via g pay from Shyam'), 'gpay');
  assert.equal(extractMethod('5000 via UPI from Shyam'), 'gpay');
});

test('extractMethod recognizes bank transfer and its abbreviations', () => {
  assert.equal(extractMethod('bank transfer of 5000'), 'bank_transfer');
  assert.equal(extractMethod('NEFT 5000 from X'), 'bank_transfer');
  assert.equal(extractMethod('5000 IMPS from X'), 'bank_transfer');
});

test('extractMethod returns null when no method keyword is present', () => {
  assert.equal(extractMethod('just received payment from Shyam'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: FAIL — `extractMethod is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `whatsapp-bot/src/whatsapp/paymentIntent.js` (below `extractDateInfo`, above `module.exports`):

```js
const METHOD_KEYWORDS = [
  { method: 'gpay', pattern: /\b(g\s*pay|gpay|upi|phonepe|paytm)\b/i },
  { method: 'bank_transfer', pattern: /\b(bank\s*transfer|neft|imps|rtgs|bank)\b/i },
  { method: 'cash', pattern: /\bcash\b/i },
];

function extractMethod(text) {
  const cleaned = String(text || '');
  for (const { method, pattern } of METHOD_KEYWORDS) {
    if (pattern.test(cleaned)) return method;
  }
  return null;
}
```

Update `module.exports` to:

```js
module.exports = { extractAmount, extractDateInfo, extractMethod, toIsoDate };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: PASS, all 19 tests.

- [ ] **Step 5: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/paymentIntent.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/tests/paymentIntent.test.js"
git commit -m "feat(aaral-bot): add payment method extraction"
```

---

### Task 6: `paymentIntent.js` — customer name candidates + resolution + `parsePaymentMessage`

**Files:**
- Modify: `whatsapp-bot/src/whatsapp/paymentIntent.js`
- Modify: `whatsapp-bot/tests/paymentIntent.test.js`

**Interfaces:**
- Consumes: `extractAmount`, `extractDateInfo`, `extractMethod` (this file, Tasks 3-5).
- Produces:
  - `extractNameCandidatePhrases(text) → string[]` (longest-first, deduped).
  - `resolveCustomerFromText(candidatePhrases, findByNameOrPhone) → Promise<customerRow[]>` (async, ranked by longest matched phrase; `findByNameOrPhone` is injected so this is testable without a DB).
  - `parsePaymentMessage(text, referenceDate = new Date()) → { amount, date, method, candidatePhrases }`.
  - These three plus the Task 3-5 exports are consumed by `bot.js`'s `handlePaymentReport` (Task 13). `resolveCustomerFromText` is called there with the real `payment-ledger-core/ledger/customers`'s `findByNameOrPhone`.

- [ ] **Step 1: Write the failing tests**

Append to `whatsapp-bot/tests/paymentIntent.test.js`:

```js
const { extractNameCandidatePhrases, resolveCustomerFromText, parsePaymentMessage } = require('../src/whatsapp/paymentIntent');

test('extractNameCandidatePhrases drops stopwords, amounts, and produces word + adjacent-pair candidates', () => {
  const phrases = extractNameCandidatePhrases('Received 15000 payment from Shyam miyapur today');
  assert.ok(phrases.includes('Shyam'));
  assert.ok(phrases.includes('miyapur'));
  assert.ok(phrases.includes('Shyam miyapur'));
  assert.ok(!phrases.some((p) => p.toLowerCase().includes('received')));
  assert.ok(!phrases.some((p) => p.toLowerCase().includes('today')));
  assert.ok(!phrases.includes('15000'));
});

test('extractNameCandidatePhrases orders longer phrases first', () => {
  const phrases = extractNameCandidatePhrases('paid 5000 to Shyam Kumar');
  assert.equal(phrases[0], 'Shyam Kumar');
});

async function fakeFindByNameOrPhone(term) {
  const db = [
    { id: '1', name: 'Shyam Miyapur Traders' },
    { id: '2', name: 'Shyam Kumar' },
    { id: '3', name: 'Ramesh Stores' },
  ];
  const lower = term.toLowerCase();
  return db.filter((c) => c.name.toLowerCase().includes(lower));
}

test('resolveCustomerFromText resolves an unambiguous two-word match uniquely', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Shyam miyapur today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '1');
});

test('resolveCustomerFromText surfaces both candidates on an ambiguous single-word match', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Shyam today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 2);
});

test('resolveCustomerFromText returns an empty array when nothing matches', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Nobody today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 0);
});

test('parsePaymentMessage masks the matched date text out before amount/method/name extraction', () => {
  const result = parsePaymentMessage('Received 15000 payment from Shyam miyapur on 15-06-2026', new Date('2026-08-26'));
  assert.equal(result.amount, 15000);
  assert.equal(result.date, '2026-06-15');
  assert.ok(result.candidatePhrases.includes('Shyam'));
  assert.ok(!result.candidatePhrases.some((p) => p.includes('15-06-2026')));
});

test('parsePaymentMessage extracts method alongside amount/date/name', () => {
  const result = parsePaymentMessage('Received 5000 cash from Ramesh today', new Date('2026-08-26'));
  assert.equal(result.amount, 5000);
  assert.equal(result.method, 'cash');
  assert.ok(result.candidatePhrases.includes('Ramesh'));
});

test('parsePaymentMessage returns a null amount when the message has none', () => {
  const result = parsePaymentMessage('hello there', new Date('2026-08-26'));
  assert.equal(result.amount, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: FAIL — `extractNameCandidatePhrases is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `whatsapp-bot/src/whatsapp/paymentIntent.js` (below `extractMethod`, above `module.exports`):

```js
const STOPWORDS = new Set([
  'received', 'payment', 'paid', 'pay', 'from', 'today', 'yesterday', 'cash',
  'gpay', 'g', 'pay', 'upi', 'bank', 'transfer', 'rs', 'inr', 'rupees',
  'rupee', 'of', 'the', 'a', 'an', 'via', 'on', 'for', 'amount', 'balance',
  'ledger', 'got', 'payments', 'money', 'sent', 'and', 'with', 'him', 'her',
  'them', 'done', 'settled', 'tomorrow', 'morning', 'evening', 'neft',
  'imps', 'rtgs', 'phonepe', 'paytm',
]);

function extractNameCandidatePhrases(text) {
  const words = String(text || '')
    .replace(/[₹,]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(Boolean)
    .filter((w) => !/^\d+$/.test(w))
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));

  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    phrases.push(words[i]);
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  // Longest phrases first, so a two-word match is preferred over its
  // single-word substring resolving to the same or a different customer.
  return [...new Set(phrases)].sort((a, b) => b.length - a.length);
}

async function resolveCustomerFromText(candidatePhrases, findByNameOrPhone) {
  const seen = new Map();
  for (const phrase of candidatePhrases) {
    if (phrase.length < 2) continue;
    const matches = await findByNameOrPhone(phrase);
    for (const customer of matches) {
      const existing = seen.get(customer.id);
      if (!existing || phrase.length > existing.matchedPhrase.length) {
        seen.set(customer.id, { customer, matchedPhrase: phrase });
      }
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.matchedPhrase.length - a.matchedPhrase.length)
    .map((entry) => entry.customer);
}

function parsePaymentMessage(text, referenceDate = new Date()) {
  const raw = String(text || '');
  const dateInfo = extractDateInfo(raw, referenceDate);
  const masked = dateInfo.matchedText ? raw.replace(dateInfo.matchedText, ' ') : raw;
  return {
    amount: extractAmount(masked),
    date: dateInfo.iso,
    method: extractMethod(masked),
    candidatePhrases: extractNameCandidatePhrases(masked),
  };
}
```

Update `module.exports` to:

```js
module.exports = {
  extractAmount, extractDateInfo, extractMethod,
  extractNameCandidatePhrases, resolveCustomerFromText, parsePaymentMessage,
  toIsoDate,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "whatsapp-bot" && npm test -- tests/paymentIntent.test.js
```

Expected: PASS, all 27 tests.

- [ ] **Step 5: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/paymentIntent.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/tests/paymentIntent.test.js"
git commit -m "feat(aaral-bot): add customer-name candidate matching and parsePaymentMessage"
```

---

### Task 7: Dashboard internal endpoint — `POST /internal/bot/ledger-pdf`

**Files:**
- Create: `dashboard/src/ledgerEntries.js`
- Modify: `dashboard/src/routes/ledger.js`
- Create: `dashboard/src/routes/botInternal.js`
- Modify: `dashboard/server.js`
- Create: `dashboard/tests/botInternal.test.js`
- Modify: `dashboard/.env.example`, `dashboard/.env.production`, `dashboard/.env.test`

**Interfaces:**
- Produces: `fetchLedgerEntries(customerId)` now lives in `dashboard/src/ledgerEntries.js` (unchanged behavior). `POST /internal/bot/ledger-pdf` — body `{ customerId }`, header `X-Bot-Internal-Secret`, returns `{ ok: true, pdfBase64, filename, balanceLine }` or 401/404.
- Consumed by: the bot's `LEDGER` command handler (Task 12).

- [ ] **Step 1: Extract `fetchLedgerEntries` into its own module**

Create `dashboard/src/ledgerEntries.js` with the exact function currently defined inline in `dashboard/src/routes/ledger.js` (lines 14-53):

```js
const { query } = require('payment-ledger-core/db');

// Invoice-type entries also carry `items` (particulars/qty/rate from
// invoice_items) so the statement can show what was actually bought, not
// just an "Invoice #N" line -- the customer's own copy has no other way to
// see that breakdown without asking the office to look up the invoice.
async function fetchLedgerEntries(customerId) {
  const { rows } = await query(
    `SELECT 'invoice' AS type, d.id, d.description AS label, d.amount_due AS amount, d.created_at AS occurred_at,
            d.invoice_id, d.voided
     FROM dues d
     WHERE d.customer_id = $1
     UNION ALL
     SELECT 'payment' AS type, id, proof_type AS label, amount_claimed AS amount, reported_at AS occurred_at,
            invoice_id, (status = 'voided') AS voided
     FROM payment_claims WHERE customer_id = $1 AND status IN ('confirmed', 'voided')
     ORDER BY occurred_at ASC`,
    [customerId]
  );

  const invoiceIds = [...new Set(
    rows.filter((row) => row.type === 'invoice' && row.invoice_id).map((row) => row.invoice_id)
  )];
  let itemsByInvoice = {};
  if (invoiceIds.length) {
    const { rows: itemRows } = await query(
      `SELECT invoice_id, particulars, qty, rate FROM invoice_items
       WHERE invoice_id = ANY($1::uuid[]) ORDER BY s_no ASC`,
      [invoiceIds]
    );
    itemsByInvoice = itemRows.reduce((acc, item) => {
      (acc[item.invoice_id] = acc[item.invoice_id] || []).push(item);
      return acc;
    }, {});
  }

  let running = 0;
  return rows.map((row) => {
    if (!row.voided) running += row.type === 'invoice' ? Number(row.amount) : -Number(row.amount);
    const items = row.type === 'invoice' && row.invoice_id ? (itemsByInvoice[row.invoice_id] || []) : [];
    return { ...row, runningBalance: running, items };
  });
}

module.exports = { fetchLedgerEntries };
```

- [ ] **Step 2: Point `routes/ledger.js` at the extracted module**

In `dashboard/src/routes/ledger.js`:
- Delete the `async function fetchLedgerEntries(customerId) { ... }` block (lines 14-53) entirely.
- Add near the top, alongside the other requires: `const { fetchLedgerEntries } = require('../ledgerEntries');`

- [ ] **Step 3: Regression-check the existing ledger tests**

```bash
cd dashboard && npm test -- tests/ledgerTemplate.test.js
```

Expected: PASS (this extraction is a pure move, no behavior change; the route's own send-ledger-whatsapp path isn't covered by an existing automated test, so this is checked live in Task 15's final verification too).

- [ ] **Step 4: Write the failing test for the new internal route**

Create `dashboard/tests/botInternal.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');

// Mounts only the router under test in a bare Express app -- NOT
// require('../server'), which calls app.listen(PORT, '0.0.0.0', ...) as a
// module-load side effect (it's not gated behind require.main === module
// the way whatsapp-bot's entry point is), so requiring it here would try
// to bind the real dashboard port during every test run. This matches the
// rest of this codebase's actual test convention (business-logic functions
// called directly, never through a live HTTP server) as closely as
// possible while still exercising the secret-header middleware, which is
// the one genuinely new request-layer behavior in this task.
process.env.BOT_INTERNAL_SECRET = 'test-internal-secret';
const botInternalRouter = require('../src/routes/botInternal');

function buildTestApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(botInternalRouter);
  return testApp;
}

test.after(async () => { await pool.end(); });
test.beforeEach(resetDb);

function postJson(baseUrl, path, body, headers) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('rejects a request with no secret header', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345670' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(baseUrl, '/internal/bot/ledger-pdf', { customerId: customer.id }, {});
  assert.equal(res.status, 401);
  server.close();
});

test('rejects a request with the wrong secret header', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345671' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(baseUrl, '/internal/bot/ledger-pdf', { customerId: customer.id }, { 'X-Bot-Internal-Secret': 'wrong' });
  assert.equal(res.status, 401);
  server.close();
});

test('returns a 404 for an unknown customer with the correct secret', async () => {
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(
    baseUrl, '/internal/bot/ledger-pdf',
    { customerId: '00000000-0000-0000-0000-000000000000' },
    { 'X-Bot-Internal-Secret': 'test-internal-secret' }
  );
  assert.equal(res.status, 404);
  server.close();
});

test('returns a PDF for a real customer with the correct secret', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345672' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(
    baseUrl, '/internal/bot/ledger-pdf',
    { customerId: customer.id },
    { 'X-Bot-Internal-Secret': 'test-internal-secret' }
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.pdfBase64.length > 0);
  assert.ok(data.filename.includes('Shyam'));
  assert.match(data.balanceLine, /Shyam Miyapur Traders/);
  server.close();
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd dashboard && npm test -- tests/botInternal.test.js
```

Expected: FAIL — 404s on `/internal/bot/ledger-pdf` (route doesn't exist yet).

- [ ] **Step 6: Write the implementation**

Create `dashboard/src/routes/botInternal.js`:

```js
// Routes reachable only by the WhatsApp bot process on this same machine
// (or another process holding BOT_INTERNAL_SECRET), never by a dashboard
// session. Mounted in server.js BEFORE requireSession, alongside auth.js.
//
// Dashboard binds 0.0.0.0 for the office LAN, so a route here is reachable
// by anything on that WiFi -- the secret header is the actual gate, not the
// network binding.
const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const { fetchLedgerEntries } = require('../ledgerEntries');
const { renderLedgerPdf } = require('../ledgerPdf');
const { sanitize } = require('../invoiceFilename');
const { formatIndian, formatDate } = require('../chittiTemplate');

const router = express.Router();

function requireBotSecret(req, res, next) {
  const provided = req.get('X-Bot-Internal-Secret');
  if (!process.env.BOT_INTERNAL_SECRET || provided !== process.env.BOT_INTERNAL_SECRET) {
    return res.status(401).json({ ok: false, error: 'Not authorized' });
  }
  next();
}

router.post('/internal/bot/ledger-pdf', requireBotSecret, async (req, res) => {
  try {
    const { customerId } = req.body;
    const balance = await balances.getBalanceByCustomerId(customerId);
    if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

    const entries = await fetchLedgerEntries(customerId);
    const customer = { name: balance.name, phone_number: balance.phone_number, balance: balance.balance };
    const pdfBuffer = await renderLedgerPdf({ customer, entries });
    const filename = `Ledger-${sanitize(customer.name) || 'Customer'}.pdf`;
    const balanceLine = `${customer.name} — balance as of ${formatDate()}: ₹${formatIndian(customer.balance)}`;

    res.json({ ok: true, pdfBase64: pdfBuffer.toString('base64'), filename, balanceLine });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 7: Mount the router in `server.js`, before `requireSession`**

In `dashboard/server.js`, immediately after `app.use('/api', require('./src/routes/auth'));` and before `app.use(requireSession);`, add:

```js
app.use(require('./src/routes/botInternal'));
```

- [ ] **Step 8: Add `BOT_INTERNAL_SECRET` to the env files**

In `dashboard/.env.test`, add:
```
BOT_INTERNAL_SECRET=test-internal-secret
```

In `dashboard/.env.production`, add (placeholder, never a real committed secret — same convention as `BACKUP_ENCRYPTION_PASSPHRASE`):
```
# Shared secret the WhatsApp bot presents to reach the /internal/bot/* routes.
# Must match the same value in whatsapp-bot/.env.production. Set directly on
# the office PC, never commit the real value.
BOT_INTERNAL_SECRET=__SET_A_STRONG_SHARED_SECRET__
```

Create/update `dashboard/.env.example` with the same placeholder line (if `.env.example` doesn't already exist for dashboard, skip this — dashboard uses `.env.production` as its documented template per existing convention; only add to `.env.example` if that file already exists).

- [ ] **Step 9: Run test to verify it passes**

```bash
cd dashboard && npm test -- tests/botInternal.test.js
```

Expected: PASS, all 4 tests.

- [ ] **Step 10: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/ledgerEntries.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/routes/ledger.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/routes/botInternal.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/server.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/tests/botInternal.test.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/.env.test" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/.env.production"
git commit -m "feat(aaral-dashboard): add secret-gated internal ledger-pdf endpoint for the bot"
```

---

### Task 8: Dashboard Users page — backend (phone field, edit, hard delete)

**Files:**
- Modify: `dashboard/src/routes/users.js`
- Create: `dashboard/tests/users.test.js`

**Interfaces:**
- Produces: `POST /api/users` now requires `phoneNumber`; `PATCH /api/users/:id/phone` (new); `DELETE /api/users/:id` (new, hard delete, blocked if `activity_log` has rows for that user or if it's the last active admin).
- Consumed by: the Users page frontend (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/users.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const { query } = require('payment-ledger-core/db');
const { logActivity } = require('../src/activityLog');

test.after(async () => { await pool.end(); });
test.beforeEach(resetDb);

async function createAdminAndSession(displayName = 'Admin One') {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('password123', 10);
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
    [`admin_${Date.now()}`, hash, displayName, `9${Date.now()}`.slice(0, 10)]
  );
  return rows[0].id;
}

// The routes are session-gated in production, but this test suite hits the
// route module directly through supertest-less raw fetch is awkward for
// session cookies, so the route-level behavior that doesn't depend on
// session identity (validation, delete-blocking) is exercised via direct
// SQL setup + a stub Express app mounting just this router, matching the
// existing dashboard test convention of testing route logic without a full
// login round-trip.
const express = require('express');
const usersRouter = require('../src/routes/users');

function buildTestApp(sessionUser) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, _res, next) => { req.session = { user: sessionUser }; next(); });
  testApp.use('/api', usersRouter);
  return testApp;
}

test('POST /users requires a phone number', async () => {
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'newemp', password: 'password123', displayName: 'New Emp', role: 'employee' }),
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.match(data.error, /phone/i);
  testServer.close();
});

test('POST /users creates a user with a phone number', async () => {
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'newemp2', password: 'password123', displayName: 'New Emp Two', role: 'employee', phoneNumber: '9812300001' }),
  });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.user.phone_number, '9812300001');
  testServer.close();
});

test('PATCH /users/:id/phone updates the phone number', async () => {
  const adminId = await createAdminAndSession();
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users/${adminId}/phone`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '9812399999' }),
  });
  const data = await res.json();
  assert.equal(data.ok, true);
  const { rows } = await query('SELECT phone_number FROM dashboard_users WHERE id = $1', [adminId]);
  assert.equal(rows[0].phone_number, '9812399999');
  testServer.close();
});

test('PATCH /users/:id/phone rejects a duplicate phone number', async () => {
  const firstId = await createAdminAndSession('First Admin');
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('second_admin', 'x', 'Second Admin', 'employee', '9812311111') RETURNING id`
  );
  const secondId = rows[0].id;
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users/${firstId}/phone`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '9812311111' }),
  });
  assert.equal(res.status, 400);
  void secondId;
  testServer.close();
});

test('DELETE /users/:id removes a user with no activity history', async () => {
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('throwaway', 'x', 'Throwaway', 'employee', '9812322222') RETURNING id`
  );
  const targetId = rows[0].id;
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users/${targetId}`, { method: 'DELETE' });
  const data = await res.json();
  assert.equal(data.ok, true);
  const { rows: remaining } = await query('SELECT 1 FROM dashboard_users WHERE id = $1', [targetId]);
  assert.equal(remaining.length, 0);
  testServer.close();
});

test('DELETE /users/:id refuses a user with activity history', async () => {
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('has_history', 'x', 'Has History', 'employee', '9812333333') RETURNING id`
  );
  const targetId = rows[0].id;
  const fakeReq = { session: { user: { id: targetId, username: 'has_history', display_name: 'Has History' } } };
  await logActivity(fakeReq, 'recorded payment', 'test activity');

  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users/${targetId}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
  const { rows: stillThere } = await query('SELECT 1 FROM dashboard_users WHERE id = $1', [targetId]);
  assert.equal(stillThere.length, 1);
  testServer.close();
});

test('DELETE /users/:id refuses to delete the last active admin', async () => {
  const adminId = await createAdminAndSession('Only Admin');
  const testApp = buildTestApp({ username: 'admin1', role: 'admin' });
  const testServer = testApp.listen(0);
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const res = await fetch(`${url}/api/users/${adminId}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
  testServer.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard && npm test -- tests/users.test.js
```

Expected: FAIL — phone-required validation missing, `/phone` and DELETE routes 404.

- [ ] **Step 3: Write the implementation**

Replace `dashboard/src/routes/users.js` in full with:

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');
const { logActivity } = require('../activityLog');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 6;

router.get('/users', requireAdmin, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, username, display_name, role, active, phone_number, created_at FROM dashboard_users ORDER BY created_at'
  );
  res.json({ ok: true, users: rows });
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role, phoneNumber } = req.body;
    if (!username || !password || !displayName || !['admin', 'employee'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Username, password, display name, and a valid role are required' });
    }
    if (!phoneNumber || !phoneNumber.trim()) {
      return res.status(400).json({ ok: false, error: 'A phone number is required so this person can use the WhatsApp bot' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, role, active, phone_number, created_at`,
      [username.trim().toLowerCase(), hash, displayName.trim(), role, phoneNumber.trim()]
    );
    await logActivity(req, 'added user', `${displayName.trim()} (${role})`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'dashboard_users_username_key') {
      return res.status(400).json({ ok: false, error: 'That username is already taken' });
    }
    if (err.code === '23505' && err.constraint === 'dashboard_users_phone_number_key') {
      return res.status(400).json({ ok: false, error: 'That phone number is already assigned to another user' });
    }
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.patch('/users/:id/phone', requireAdmin, async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber || !phoneNumber.trim()) {
    return res.status(400).json({ ok: false, error: 'A phone number is required' });
  }
  try {
    const { rows } = await query(
      'UPDATE dashboard_users SET phone_number = $1 WHERE id = $2 RETURNING display_name',
      [phoneNumber.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
    await logActivity(req, 'updated phone number for', rows[0].display_name);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ ok: false, error: 'That phone number is already assigned to another user' });
    }
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    'UPDATE dashboard_users SET password_hash = $1 WHERE id = $2 RETURNING display_name',
    [hash, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  await logActivity(req, 'reset password for', rows[0].display_name);
  res.json({ ok: true });
});

// Toggling a user's active flag can lock everyone out if it removes the
// last admin able to log back in and undo it, so that specific case is
// refused outright rather than trusting whoever's clicking to notice.
router.post('/users/:id/toggle-active', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT role, active, display_name FROM dashboard_users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  const target = rows[0];

  if (target.role === 'admin' && target.active) {
    const { rows: activeAdmins } = await query(
      `SELECT id FROM dashboard_users WHERE role = 'admin' AND active = true`
    );
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ ok: false, error: 'Cannot deactivate the last active admin' });
    }
  }

  await query('UPDATE dashboard_users SET active = $1 WHERE id = $2', [!target.active, req.params.id]);
  await logActivity(req, target.active ? 'deactivated user' : 'activated user', target.display_name);
  res.json({ ok: true, active: !target.active });
});

// Real removal, not deactivation. Safe at the DB level either way --
// activity_log.user_id is ON DELETE SET NULL and invoices/dues store
// created_by/voided_by as plain text, not a foreign key -- but a user with
// real activity_log history should be deactivated, not erased, so that
// history stays attributable to a name in the UI rather than orphaning
// silently. Same "can't remove the last active admin" guard as deactivate.
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT role, active, display_name FROM dashboard_users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  const target = rows[0];

  if (target.role === 'admin' && target.active) {
    const { rows: activeAdmins } = await query(
      `SELECT id FROM dashboard_users WHERE role = 'admin' AND active = true`
    );
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ ok: false, error: 'Cannot delete the last active admin' });
    }
  }

  const { rows: historyRows } = await query(
    'SELECT 1 FROM activity_log WHERE user_id = $1 LIMIT 1', [req.params.id]
  );
  if (historyRows.length) {
    return res.status(400).json({ ok: false, error: 'This user has activity history — deactivate instead of deleting' });
  }

  await query('DELETE FROM dashboard_users WHERE id = $1', [req.params.id]);
  await logActivity(req, 'deleted user', target.display_name);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd dashboard && npm test -- tests/users.test.js
```

Expected: PASS, all 7 tests.

- [ ] **Step 5: Regression-check other route tests aren't affected**

```bash
cd dashboard && npm test
```

Expected: all existing suites still pass (this task only added fields/routes, didn't change any existing route's shape besides adding `phone_number` to the `GET /users` payload).

- [ ] **Step 6: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/routes/users.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/tests/users.test.js"
git commit -m "feat(aaral-dashboard): add phone number, edit-phone, and hard delete to Users page backend"
```

---

### Task 9: Dashboard Users page — frontend

**Files:**
- Modify: `dashboard/public/users.html`

**Interfaces:**
- Consumes: `POST /api/users` (now requires `phoneNumber`), `PATCH /api/users/:id/phone`, `DELETE /api/users/:id` (all from Task 8).
- No new automated test — this codebase has no browser/e2e test harness; UI changes here are verified live, matching the established convention (every prior dashboard UI feature in this project was "verified live via..." rather than automated). Manual verification steps are given instead.

- [ ] **Step 1: Add the phone field to the Add User modal**

In `dashboard/public/users.html`, inside the `#addUserModal` div, add a field-group between the "Role" select and the error div:

```html
<div class="field-group">
  <label>Phone number</label>
  <input type="text" id="newPhone" autocomplete="off" placeholder="e.g. 9812345678">
</div>
```

- [ ] **Step 2: Wire the phone field into the create-user request and reset**

In the `<script>` block, update `openAddUserModal` to also reset the new field, and the `saveAddUser` click handler to send it:

```js
const newPhone = document.getElementById('newPhone');
```

Add `newPhone.value = '';` inside `openAddUserModal()`.

Add `phoneNumber: newPhone.value.trim(),` to the JSON body in the `saveAddUser` handler's `fetch` call.

- [ ] **Step 3: Show phone number in the table and add an Edit Phone action**

Update the table header to add a Phone column:

```html
<thead><tr><th>Name</th><th>Username</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
```

Update the row-building code in `load()` to add a phone cell and an edit-phone button:

```js
tr.innerHTML = `
  <td>${u.display_name}</td>
  <td>${u.username}</td>
  <td>${u.phone_number || '<span style="color:var(--ink-muted)">not set</span>'}</td>
  <td><span class="role-badge ${u.role}">${u.role}</span></td>
  <td>${u.active ? '' : '<span class="inactive-badge">Deactivated</span>'}</td>
  <td>
    <div class="row-actions">
      <button data-edit-phone-id="${u.id}" data-edit-phone-name="${u.display_name.replace(/"/g, '&quot;')}" data-edit-phone-current="${(u.phone_number || '').replace(/"/g, '&quot;')}">Edit phone</button>
      <button data-reset-id="${u.id}" data-reset-name="${u.display_name.replace(/"/g, '&quot;')}">Reset password</button>
      <button class="danger" data-toggle-id="${u.id}">${u.active ? 'Deactivate' : 'Activate'}</button>
      <button class="danger" data-delete-id="${u.id}" data-delete-name="${u.display_name.replace(/"/g, '&quot;')}">Delete</button>
    </div>
  </td>`;
```

- [ ] **Step 4: Add an Edit Phone modal, mirroring the existing Reset Password modal**

Add after the `#resetModal` div:

```html
<div class="modal-backdrop" id="editPhoneModal">
  <div class="modal-box">
    <h3>Edit Phone Number</h3>
    <div class="field-group">
      <label>Phone number for <strong id="editPhoneForName"></strong></label>
      <input type="text" id="editPhoneValue" autocomplete="off">
    </div>
    <div id="editPhoneError" style="color:var(--rust); font-size:0.85rem; margin-bottom:0.4rem;"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="cancelEditPhone" type="button">Cancel</button>
      <button class="btn-primary" id="confirmEditPhone" type="button">Save</button>
    </div>
  </div>
</div>
```

Add corresponding script, mirroring the reset-password pattern:

```js
const editPhoneModal = document.getElementById('editPhoneModal');
const editPhoneValue = document.getElementById('editPhoneValue');
const editPhoneError = document.getElementById('editPhoneError');
let pendingEditPhoneId = null;

function openEditPhoneModal(id, name, current) {
  pendingEditPhoneId = id;
  document.getElementById('editPhoneForName').textContent = name;
  editPhoneValue.value = current || '';
  editPhoneError.textContent = '';
  editPhoneModal.classList.add('open');
  editPhoneValue.focus();
}
function closeEditPhoneModal() { editPhoneModal.classList.remove('open'); pendingEditPhoneId = null; }

document.getElementById('cancelEditPhone').addEventListener('click', closeEditPhoneModal);
editPhoneModal.addEventListener('click', (e) => { if (e.target === editPhoneModal) closeEditPhoneModal(); });

document.getElementById('confirmEditPhone').addEventListener('click', async () => {
  if (!pendingEditPhoneId) return;
  const res = await fetch(`/api/users/${pendingEditPhoneId}/phone`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: editPhoneValue.value.trim() }),
  });
  const data = await res.json();
  if (!data.ok) { editPhoneError.textContent = data.error; return; }
  closeEditPhoneModal();
  load();
});
```

- [ ] **Step 5: Wire the row click handler for both new buttons**

Update the existing `rowsEl.addEventListener('click', ...)` handler to add two more branches at the top:

```js
rowsEl.addEventListener('click', (e) => {
  const editPhoneBtn = e.target.closest('[data-edit-phone-id]');
  if (editPhoneBtn) {
    openEditPhoneModal(editPhoneBtn.dataset.editPhoneId, editPhoneBtn.dataset.editPhoneName, editPhoneBtn.dataset.editPhoneCurrent);
    return;
  }
  const deleteBtn = e.target.closest('[data-delete-id]');
  if (deleteBtn) {
    if (!confirm(`Permanently delete ${deleteBtn.dataset.deleteName}? This cannot be undone.`)) return;
    fetch(`/api/users/${deleteBtn.dataset.deleteId}`, { method: 'DELETE' })
      .then((res) => res.json())
      .then((data) => { if (!data.ok) alert(data.error); load(); });
    return;
  }
  const resetBtn = e.target.closest('[data-reset-id]');
  if (resetBtn) {
    openResetModal(resetBtn.dataset.resetId, resetBtn.dataset.resetName);
    return;
  }
  const toggleBtn = e.target.closest('[data-toggle-id]');
  if (toggleBtn) {
    fetch(`/api/users/${toggleBtn.dataset.toggleId}/toggle-active`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => { if (!data.ok) alert(data.error); load(); });
  }
});
```

- [ ] **Step 6: Manual verification**

Start the dashboard locally (`cd dashboard && npm start`), log in as an admin, open `/users.html`, and confirm:
1. Add User now requires a phone number (submitting without one shows the server's error message).
2. A newly-added user's phone shows in the table.
3. "Edit phone" opens a modal, saves, and the table updates.
4. Editing to a phone number already used by another user shows a clear duplicate error.
5. "Delete" on a fresh user (no activity) removes them after confirmation.
6. "Delete" on a user with activity history shows the "deactivate instead" error and the row stays.
7. "Delete" on the only active admin shows the last-admin error.

- [ ] **Step 7: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/users.html"
git commit -m "feat(aaral-dashboard): add phone number, edit, and delete to Users page UI"
```

---

### Task 10: Remove OCR entirely

**Files:**
- Delete: `whatsapp-bot/ocr-service/` (entire directory)
- Modify: `whatsapp-bot/src/whatsapp/bot.js`
- Modify: `whatsapp-bot/src/whatsapp/flows.js`
- Modify: `whatsapp-bot/tests/flows.test.js`
- Modify: `whatsapp-bot/.gitignore`

**Interfaces:**
- No new interfaces — this task only removes code. `flows.js` still exports `parseAdminCommand`, `toWhatsAppChatId`, `formatBalanceLine` afterward (unchanged shapes); the OCR-only exports (`extractAmountMatch`, `extractTxnId`, `extractPaymentDate`, `isScreenshotDateStale`, `screenshotAgeDays`) are removed, and nothing outside `flows.js`/`flows.test.js` references them (confirmed: only `bot.js`'s now-being-removed `awaiting_proof` handler used them).

- [ ] **Step 1: Delete the OCR service directory**

```bash
rm -rf "whatsapp-bot/ocr-service"
```

- [ ] **Step 2: Remove OCR-only functions from `flows.js`**

In `whatsapp-bot/src/whatsapp/flows.js`, delete these functions in full: `extractAmountMatch`, `extractTxnId`, `MONTH_INDEX`, `extractPaymentDate`, `isScreenshotDateStale`, `screenshotAgeDays`. (These will be fully removed as part of Task 11 along with the rest of the customer-flow helpers — this step can be done together with Task 11's flows.js edit if you're working sequentially; listed here so the OCR-removal task is self-contained if done independently.)

- [ ] **Step 3: Remove OCR code from `bot.js`**

In `whatsapp-bot/src/whatsapp/bot.js`, remove:
- The `OCR_SERVICE_PORT`, `OCR_SERVICE_URL`, `OCR_SERVICE_DIR` constants and the comment block above them (original lines 44-55).
- `OCR_VENV_PYTHON`, `OCR_SERVER_SCRIPT`, `ocrServiceProcess`, `startOcrService`, `waitForOcrService`, `stopOcrService`, `stopOcrServiceSync` (original lines 245-306).
- The `startOcrService()` call and `stopOcrServiceSync()` call inside the `if (require.main === module)` block (original lines 341-342) — replace with just `chromeCleanup();` and the four `process.on(...)` handlers calling `process.exit(0)` directly instead of `stopOcrService().then(...)`:

```js
if (require.main === module) {
  chromeCleanup();
  process.on('exit', () => { chromeCleanup(); });
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
  process.on('SIGHUP', () => { logger.info('[WhatsApp] SIGHUP — clean exit'); process.exit(0); });
  process.on('SIGQUIT', () => { logger.info('[WhatsApp] SIGQUIT — clean exit'); process.exit(0); });
}
```
- The `waitForOcrService().catch(...).then(() => connection.start())` chain at the bottom (original lines 1000-1002) — replace with a direct call:

```js
connection.start()
  .then((result) => {
    if (!result.ok) {
      logger.error('[WhatsApp] Initial connect failed — service stays up, retry scheduled', { error: result.error });
    }
  })
  .catch((e) => logger.error('[WhatsApp] Startup threw unexpectedly', { error: e.message }));
```
- The two `process.on('unhandledRejection', ...)` / `process.on('uncaughtException', ...)` handlers (original lines 623-640) currently call `stopOcrService().then(() => process.exit(1))` — change both to `process.exit(1)` directly.
- Update the stale comment at original lines 499-503 ("Puppeteer installs its own SIGINT/SIGTERM/SIGHUP handlers... our own handlers' async OCR-worker shutdown below") to drop the OCR-specific wording:

```js
    // Puppeteer installs its own SIGINT/SIGTERM/SIGHUP handlers by default
    // that call process.exit() directly and synchronously, which would race
    // ahead of our own signal handlers above. Disabling Puppeteer's handlers
    // here means our own handlers are the only thing driving process exit.
```
(The rest of Task 10's `awaiting_proof` OCR-fetch removal happens as part of Task 11, since that whole handler is being deleted there — see Task 11 Step 1.)

- [ ] **Step 4: Remove OCR-specific tests from `flows.test.js`**

In `whatsapp-bot/tests/flows.test.js`, delete every test from `test('extractAmountMatch finds a currency-prefixed amount that matches', ...)` through `test('extractPaymentDate rejects a calendar-impossible day-month combination', ...)` and the four `isScreenshotDateStale` tests, plus the leading `extractTxnId` tests. (Full removal reconciled with Task 11's broader test-file rewrite — see Task 11 Step 4 for the complete resulting file.)

- [ ] **Step 5: Remove the now-dead `.gitignore` entries**

In `whatsapp-bot/.gitignore`, delete the two lines:
```
ocr-service/venv/
ocr-service/__pycache__/
```

- [ ] **Step 6: Verify nothing else references the removed OCR pieces**

```bash
cd "whatsapp-bot" && grep -rn "ocr\|OCR" src/ --include="*.js" 2>/dev/null
```

Expected: no output (this check is re-run again at the end of Task 11, after the rest of the OCR-adjacent code — the `awaiting_proof` handler itself — is also gone).

- [ ] **Step 7: Commit**

This step's file changes are committed together with Task 11 (both touch `flows.js` and `flows.test.js` in overlapping ways) — see Task 11 Step 6 for the combined commit.

---

### Task 11: Remove customer self-report flow, claim-review commands, daily digest, and `TEST_MODE_ALLOWED_NUMBERS`

**Files:**
- Modify: `whatsapp-bot/src/whatsapp/flows.js` (final state)
- Modify: `whatsapp-bot/src/whatsapp/bot.js`
- Modify: `whatsapp-bot/tests/flows.test.js` (final state)
- Modify: `whatsapp-bot/.env.example`, `whatsapp-bot/.env.production`

**Interfaces:**
- Produces: `flows.js`'s final export set — `{ parseAdminCommand, toWhatsAppChatId, formatBalanceLine }`, with `parseAdminCommand` now recognizing `BALANCE`, `LEDGER`, `IMPORT` only. Consumed by Task 12/13's `bot.js` rewrite.

- [ ] **Step 1: Rewrite `flows.js` to its final, trimmed state**

Replace `whatsapp-bot/src/whatsapp/flows.js` in full with:

```js
function parseAdminCommand(text) {
  const trimmed = (text || '').trim();
  let m;

  if ((m = trimmed.match(/^balance\s+(.+)$/i))) return { command: 'BALANCE', query: m[1].trim() };
  if ((m = trimmed.match(/^ledger\s+(.+)$/i))) return { command: 'LEDGER', query: m[1].trim() };
  if (/^import\s+force$/i.test(trimmed)) return { command: 'IMPORT', force: true };
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT', force: false };

  return { command: 'UNKNOWN' };
}

function toWhatsAppChatId(phoneNumber) {
  let digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return `${digits}@c.us`;
}

function formatBalanceLine(balance) {
  if (Number(balance) <= 0) return "You're all settled up!";
  return `Remaining balance: ₹${balance}`;
}

module.exports = { parseAdminCommand, toWhatsAppChatId, formatBalanceLine };
```

- [ ] **Step 2: Rewrite `flows.test.js` to match**

Replace `whatsapp-bot/tests/flows.test.js` in full with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const flows = require('../src/whatsapp/flows');

test('parseAdminCommand parses BALANCE with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('balance Asha Rao'), { command: 'BALANCE', query: 'Asha Rao' });
});

test('parseAdminCommand parses LEDGER with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('ledger Asha Rao'), { command: 'LEDGER', query: 'Asha Rao' });
});

test('parseAdminCommand parses IMPORT and unknown text', () => {
  assert.deepEqual(flows.parseAdminCommand('import'), { command: 'IMPORT', force: false });
  assert.deepEqual(flows.parseAdminCommand('hello there'), { command: 'UNKNOWN' });
});

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

test('toWhatsAppChatId prepends 91 to a bare 10-digit number', () => {
  assert.equal(flows.toWhatsAppChatId('9848358160'), '919848358160@c.us');
});

test('toWhatsAppChatId normalizes a number with country code and formatting', () => {
  assert.equal(flows.toWhatsAppChatId('+91 98483 58160'), '919848358160@c.us');
});

test('toWhatsAppChatId does not crash on null/undefined/empty input', () => {
  assert.equal(flows.toWhatsAppChatId(''), '@c.us');
  assert.equal(flows.toWhatsAppChatId(null), '@c.us');
  assert.equal(flows.toWhatsAppChatId(undefined), '@c.us');
});

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

- [ ] **Step 3: Run flows tests to verify they pass**

```bash
cd "whatsapp-bot" && npm test -- tests/flows.test.js
```

Expected: PASS, all 13 tests.

- [ ] **Step 4: Remove customer-flow and claim-review code from `bot.js`**

This is the largest single edit. Remove, in full, from `whatsapp-bot/src/whatsapp/bot.js`:
- The `TEST_MODE_ALLOWED_NUMBERS` constant and its defining comment (original lines 34-42).
- The `isAdmin` function (original lines 568-576) — replaced by `resolveStaffUser` in Task 12.
- The customer-registration branch, `PAID` branch, `HELP` branch, and fallback message inside `handleIncomingMessage` — the whole function is rewritten in Task 12/13.
- `handleSelfSentMessage` — rewritten in Task 12.
- The `registration_name`, `awaiting_amount`, `awaiting_proof` branches inside `handlePendingReply` (original lines 725-827), including all OCR-fetch code inside the `awaiting_proof` branch.
- The `CONFIRM`/`REJECT` block, `PENDING` block, `PENDING_LINKS` block inside `handleAdminCommand` (original lines 829-916) — `BALANCE` and `IMPORT` blocks are kept (moved into the renamed `handleStaffCommand` in Task 12), a new `LEDGER` block is added in Task 12.
- The daily 9am digest `cron.schedule(...)` block at the bottom (original lines 948-956).
- `require('node-cron')` at the top, since nothing uses it anymore after the digest is removed.

(The exact replacement content for `handleIncomingMessage`, `handleSelfSentMessage`, `handleAdminCommand`→`handleStaffCommand`, and `handlePendingReply` is written fresh in Task 12 and Task 13 — this task's job is establishing that none of the old customer/claim-review code survives into that rewrite.)

- [ ] **Step 5: Remove `TEST_MODE_ALLOWED_NUMBERS` from env files**

In `whatsapp-bot/.env.example`, delete:
```
# Comma-separated phone numbers (any format). While set, ONLY these numbers
# (plus seeded admins) can get any reply from the bot at all -- everyone
# else is silently ignored. Use this while testing on a real/personal
# number. Leave empty/unset in production.
TEST_MODE_ALLOWED_NUMBERS=
```
Do the same in `whatsapp-bot/.env.production` if that line is present there too.

- [ ] **Step 6: Commit the combined Task 10 + Task 11 flows.js/flows.test.js/gitignore/OCR-deletion changes**

(bot.js's actual rewritten content lands in Task 12/13's commits — this commit covers the flows.js trim, the OCR directory deletion, and the env file cleanup, which are all self-consistent on their own even before bot.js catches up in the next tasks.)

```bash
git add -u "whatsapp-bot/ocr-service" 2>/dev/null
git rm -r --cached "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/ocr-service" 2>/dev/null
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/flows.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/tests/flows.test.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/.gitignore" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/.env.example" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/.env.production"
git commit -m "feat(aaral-bot): drop OCR and customer self-report flow (flows.js, tests, ocr-service)"
```

---

### Task 12: `resolveStaffUser`, staff-only gating, and the `LEDGER` command

**Files:**
- Modify: `whatsapp-bot/src/whatsapp/bot.js`
- Modify: `whatsapp-bot/.env.example`, `whatsapp-bot/.env.production`

**Interfaces:**
- Consumes: `flows.parseAdminCommand` (Task 11), `balances.getBalanceByCustomerId`/`searchBalances` (already imported, `payment-ledger-core/ledger/balances`).
- Produces: `resolveStaffUser(waNumber) → Promise<{id, role, displayName}|null>`, `handleStaffCommand(msg, waNumber, staff, parsed)` (renamed from `handleAdminCommand`, now covering `BALANCE`/`IMPORT`/`LEDGER`), a `handleIncomingMessage`/`handleSelfSentMessage` pair gated on `resolveStaffUser` instead of `isAdmin`. Consumed by Task 13, which adds the payment-report branch these functions fall through to.

- [ ] **Step 1: Add `resolveStaffUser`, replacing `isAdmin`**

In `whatsapp-bot/src/whatsapp/bot.js`, where `isAdmin` used to be, add:

```js
async function resolveStaffUser(waNumber) {
  const { rows } = await query(
    `SELECT id, role, display_name FROM dashboard_users
     WHERE active = true
       AND phone_number IS NOT NULL
       AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [waNumber]
  );
  if (!rows.length) return null;
  return { id: rows[0].id, role: rows[0].role, displayName: rows[0].display_name };
}
```

- [ ] **Step 2: Rewrite `handleIncomingMessage`**

```js
async function handleIncomingMessage(msg) {
  try {
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const waNumber = await resolveWaNumber(msg);
    const staff = await resolveStaffUser(waNumber);
    if (!staff) return; // non-staff numbers are always silently ignored, no exceptions

    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, staff, pending, text);
      return;
    }

    const parsed = flows.parseAdminCommand(text);
    if (parsed.command !== 'UNKNOWN') {
      await handleStaffCommand(msg, waNumber, staff, parsed);
      return;
    }

    await handlePaymentReport(msg, waNumber, staff, text);
  } catch (e) {
    logger.error('[WhatsApp] message handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}
```

- [ ] **Step 3: Rewrite `handleSelfSentMessage`**

```js
async function handleSelfSentMessage(msg) {
  try {
    if (!msg.fromMe) return;
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const waNumber = client.info.wid.user;
    const staff = await resolveStaffUser(waNumber);
    if (!staff) return;

    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, staff, pending, text);
      return;
    }

    const parsed = flows.parseAdminCommand(text);
    if (parsed.command !== 'UNKNOWN') {
      await handleStaffCommand(msg, waNumber, staff, parsed);
      return;
    }

    await handlePaymentReport(msg, waNumber, staff, text);
  } catch (e) {
    logger.error('[WhatsApp] message_create handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}
```

- [ ] **Step 4: Rename `handleAdminCommand` to `handleStaffCommand`, keep `BALANCE`/`IMPORT`, add `LEDGER`**

```js
async function handleStaffCommand(msg, waNumber, staff, parsed) {
  if (parsed.command === 'BALANCE') {
    const results = await balances.searchBalances(parsed.query);
    if (results.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    const lines = results.map((r) => `${r.name}: due ₹${r.total_due}, confirmed ₹${r.total_confirmed}, balance ₹${r.balance}`);
    await safeSend(msg, lines.join('\n'));
    return;
  }

  if (parsed.command === 'LEDGER') {
    const matches = await customers.findByNameOrPhone(parsed.query);
    if (matches.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    if (matches.length > 1) {
      const lines = matches.map((c, i) => `${i + 1}. ${c.name}`);
      await safeSend(msg, `Multiple customers match "${parsed.query}":\n${lines.join('\n')}\nSend LEDGER with the exact name.`);
      return;
    }
    await sendLedgerPdf(msg, matches[0]);
    return;
  }

  if (parsed.command === 'IMPORT') {
    if (staff.role !== 'admin') { await safeSend(msg, 'Only an admin can run IMPORT.'); return; }
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

  await safeSend(msg, 'Unknown command. Try BALANCE <name>, LEDGER <name>, IMPORT, or report a payment like: received 5000 from Ramesh.');
}
```

- [ ] **Step 5: Add `sendLedgerPdf`, calling the dashboard's internal endpoint**

```js
const DASHBOARD_INTERNAL_URL = process.env.DASHBOARD_INTERNAL_URL || 'http://127.0.0.1:3400';

async function sendLedgerPdf(msg, customer) {
  try {
    const res = await fetch(`${DASHBOARD_INTERNAL_URL}/internal/bot/ledger-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Internal-Secret': process.env.BOT_INTERNAL_SECRET || '' },
      body: JSON.stringify({ customerId: customer.id }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      await safeSend(msg, `Could not fetch the ledger: ${body.error || res.statusText}`);
      return;
    }
    const data = await res.json();
    const media = new MessageMedia('application/pdf', data.pdfBase64, data.filename);
    await client.sendMessage(msg.from, media, { caption: data.balanceLine });
  } catch (e) {
    logger.error('[WhatsApp] Failed to fetch/send ledger PDF', { error: e.message });
    await safeSend(msg, 'Could not reach the dashboard to fetch the ledger — try again shortly.');
  }
}
```

- [ ] **Step 6: Update `module.exports`**

Change the exports block to drop `isAdmin` and add `resolveStaffUser`:

```js
module.exports = {
  makeClient, safeSend, resolveWaNumber, resolveStaffUser, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
  buildConnection, startNotifyServer, WA_CONTRACT,
  getConnection: () => connection,
```

(leave the remainder of the exports object exactly as it was after this line — this task doesn't touch what follows).

- [ ] **Step 7: Add the new env vars**

In `whatsapp-bot/.env.example`, add:

```
# Where to reach the dashboard's internal-only bot routes (same machine
# unless DASHBOARD_INTERNAL_URL is overridden).
DASHBOARD_INTERNAL_URL=http://127.0.0.1:3400
# Must match the same value in dashboard/.env.production. Set directly on
# the office PC, never commit the real value.
BOT_INTERNAL_SECRET=__SET_A_STRONG_SHARED_SECRET__
```

Add the same two lines to `whatsapp-bot/.env.production`.

- [ ] **Step 8: Manual verification note**

`resolveStaffUser`, `handleIncomingMessage`, `handleSelfSentMessage`, `handleStaffCommand`, and `sendLedgerPdf` are WhatsApp-client/HTTP orchestration glue with no automated test in this codebase today (the existing `isAdmin`/`handleAdminCommand` they replace were never unit-tested either — this codebase verifies bot.js's message-routing live, during deployment, which is what Task 15's final checklist covers). The parsing/matching logic they call (`paymentIntent.js`) is fully unit-tested in Tasks 3-6.

- [ ] **Step 9: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/bot.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/.env.example" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/.env.production"
git commit -m "feat(aaral-bot): staff-only access via dashboard_users, add LEDGER command"
```

---

### Task 13: Wire the full payment-recording flow

**Files:**
- Modify: `whatsapp-bot/src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `paymentIntent.parsePaymentMessage`, `paymentIntent.resolveCustomerFromText`, `paymentIntent.extractMethod` (Tasks 3-6), `customers.findByNameOrPhone` (already imported), `require('payment-ledger-core/ledger/payments').recordPayment` (Task 2), `balances.getBalanceByCustomerId` (already imported).
- Produces: `handlePaymentReport(msg, waNumber, staff, text)` and three new `handlePendingReply` branches (`awaiting_customer_clarification`, `awaiting_payment_method`, `awaiting_payment_confirm`).

- [ ] **Step 1: Import `paymentIntent` and the shared `recordPayment`**

At the top of `whatsapp-bot/src/whatsapp/bot.js`, alongside the other requires:

```js
const paymentIntent = require('./paymentIntent');
const { recordPayment } = require('payment-ledger-core/ledger/payments');
```

- [ ] **Step 2: Write `handlePaymentReport`**

```js
function buildConfirmSummary({ amount, date, method, customerName, balanceAfter }) {
  const methodLabel = { cash: 'Cash', gpay: 'GPay', bank_transfer: 'Bank Transfer' }[method];
  const balanceNote = balanceAfter !== null ? ` — balance will become ₹${balanceAfter}` : '';
  return `Record ₹${amount} from ${customerName}, dated ${date}, ${methodLabel}${balanceNote}. Reply YES to confirm, NO to cancel.`;
}

async function presentPaymentConfirm(msg, waNumber, draft) {
  const balance = await balances.getBalanceByCustomerId(draft.customerId).catch(() => null);
  const currentBalance = balance ? Number(balance.balance) : 0;
  const balanceAfter = balance ? currentBalance - Number(draft.amount) : null;
  setPending(waNumber, 'awaiting_payment_confirm', { ...draft, balanceAfter });
  await safeSend(msg, buildConfirmSummary({ ...draft, balanceAfter }));
}

async function handlePaymentReport(msg, waNumber, staff, text) {
  const parsed = paymentIntent.parsePaymentMessage(text);

  if (parsed.amount === null) {
    await safeSend(msg, 'Unknown command. Try BALANCE <name>, LEDGER <name>, IMPORT, or report a payment like: received 5000 from Ramesh.');
    return;
  }

  const candidates = await paymentIntent.resolveCustomerFromText(parsed.candidatePhrases, customers.findByNameOrPhone);

  if (candidates.length === 0) {
    setPending(waNumber, 'awaiting_customer_clarification', {
      amount: parsed.amount, date: parsed.date, method: parsed.method, mode: 'ask_name',
    });
    await safeSend(msg, `I couldn't match a customer in that message. What's the exact registered name?`);
    return;
  }

  if (candidates.length > 1) {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.name}`);
    setPending(waNumber, 'awaiting_customer_clarification', {
      amount: parsed.amount, date: parsed.date, method: parsed.method, mode: 'pick',
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
    });
    await safeSend(msg, `Multiple customers match:\n${lines.join('\n')}\nReply with a number.`);
    return;
  }

  const draft = {
    amount: parsed.amount, date: parsed.date, method: parsed.method,
    customerId: candidates[0].id, customerName: candidates[0].name,
  };

  if (!draft.method) {
    setPending(waNumber, 'awaiting_payment_method', draft);
    await safeSend(msg, 'Cash, GPay, or Bank?');
    return;
  }

  await presentPaymentConfirm(msg, waNumber, draft);
}
```

- [ ] **Step 3: Update `handlePendingReply`'s signature and add the three new branches**

Task 12 rewrote every call site to invoke `handlePendingReply(msg, waNumber, staff, pending, text)` — the function declaration itself must be updated to match, or `staff`/`pending`/`text` will silently shift by one positional argument. Change:

```js
async function handlePendingReply(msg, waNumber, pending, text) {
```

to:

```js
async function handlePendingReply(msg, waNumber, staff, pending, text) {
```

Then add these three branches at the top of its body (the old `registration_name`/`awaiting_amount`/`awaiting_proof` branches were already deleted in Task 11 Step 4, so the body is currently empty aside from the signature):

```js
  if (pending.type === 'awaiting_customer_clarification') {
    if (pending.data.mode === 'pick') {
      const index = parseInt(text, 10);
      const picked = Number.isInteger(index) ? pending.data.candidates[index - 1] : null;
      if (!picked) { await safeSend(msg, `Reply with a number from 1 to ${pending.data.candidates.length}.`); return; }
      const draft = { amount: pending.data.amount, date: pending.data.date, method: pending.data.method, customerId: picked.id, customerName: picked.name };
      clearPending(waNumber);
      if (!draft.method) { setPending(waNumber, 'awaiting_payment_method', draft); await safeSend(msg, 'Cash, GPay, or Bank?'); return; }
      await presentPaymentConfirm(msg, waNumber, draft);
      return;
    }

    // mode === 'ask_name'
    const matches = await customers.findByNameOrPhone(text.trim());
    if (matches.length !== 1) {
      await safeSend(msg, matches.length === 0
        ? `Still no match for "${text.trim()}". What's the exact registered name?`
        : `Multiple customers match "${text.trim()}" — try a more specific name.`);
      return;
    }
    const draft = { amount: pending.data.amount, date: pending.data.date, method: pending.data.method, customerId: matches[0].id, customerName: matches[0].name };
    clearPending(waNumber);
    if (!draft.method) { setPending(waNumber, 'awaiting_payment_method', draft); await safeSend(msg, 'Cash, GPay, or Bank?'); return; }
    await presentPaymentConfirm(msg, waNumber, draft);
    return;
  }

  if (pending.type === 'awaiting_payment_method') {
    const method = paymentIntent.extractMethod(text);
    if (!method) { await safeSend(msg, 'Please reply Cash, GPay, or Bank.'); return; }
    const draft = { ...pending.data, method };
    clearPending(waNumber);
    await presentPaymentConfirm(msg, waNumber, draft);
    return;
  }

  if (pending.type === 'awaiting_payment_confirm') {
    if (/^no$/i.test(text.trim())) {
      clearPending(waNumber);
      await safeSend(msg, 'Cancelled — nothing recorded.');
      return;
    }
    if (!/^yes$/i.test(text.trim())) {
      await safeSend(msg, 'Reply YES to confirm or NO to cancel.');
      return;
    }

    clearPending(waNumber);
    const { amount, date, method, customerId, customerName, balanceAfter } = pending.data;
    const payment = await recordPayment({ customerId, amount, method, date, createdBy: `whatsapp:${staff.displayName}` });
    await safeSend(msg, `Recorded ₹${payment.amount_claimed} from ${customerName}.`);

    try {
      const customer = await customers.findById(customerId);
      if (customer) {
        const balanceLine = balanceAfter !== null ? ` Balance: ₹${balanceAfter}` : '';
        await client.sendMessage(flows.toWhatsAppChatId(customer.phone_number), `Payment received: ₹${payment.amount_claimed} on ${date}.${balanceLine}`);
      }
    } catch (e) {
      logger.error('[WhatsApp] Failed to notify customer of recorded payment', { error: e.message });
    }
    return;
  }
```

Place these three blocks at the top of `handlePendingReply`'s body, before its (now-empty, since Task 11 removed the old branches) fall-through.

- [ ] **Step 4: Manual verification note**

Same as Task 12 Step 8 — this orchestration has no automated test in this codebase's established convention; `paymentIntent.js`'s decision logic underneath it is fully covered by Tasks 3-6's 27 unit tests. Live verification happens in Task 15.

- [ ] **Step 5: Commit**

```bash
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/bot.js"
git commit -m "feat(aaral-bot): wire the free-text payment-recording flow end to end"
```

---

### Task 14: Final env/cleanup pass

**Files:**
- Modify: `whatsapp-bot/deploy` references (if any remain) — verify only
- Verify: `dashboard/.env.example` (create if the codebase convention expects one; skip if not)

**Interfaces:** none new.

- [ ] **Step 1: Confirm the deploy sync script needs no changes**

```bash
cat "deploy/sync-to-deploy-repo.sh"
```

Expected: the script rsyncs `whatsapp-bot/` wholesale (minus `node_modules`/`.env`/`wa-sessions`/etc. via its exclude list) — since `ocr-service/` no longer exists on disk after Task 10, nothing further to change here.

- [ ] **Step 2: Grep for any remaining OCR/TEST_MODE_ALLOWED_NUMBERS/isAdmin/handleAdminCommand references across both apps**

```bash
grep -rn "ocr\|OCR\|TEST_MODE_ALLOWED_NUMBERS\|handleAdminCommand" \
  "whatsapp-bot/src" "whatsapp-bot/tests" "whatsapp-bot/.env.example" "whatsapp-bot/.env.production" \
  --include="*.js" --include="*.env*" 2>/dev/null
grep -rn "isAdmin" "whatsapp-bot/src" --include="*.js" 2>/dev/null
```

Expected: no output from either command (the earlier `isAdmin` check in Task 10 Step 6 only covered OCR; this repeats it plus the others now that bot.js is fully rewritten).

- [ ] **Step 3: Fix anything the grep surfaces, then commit if changes were needed**

```bash
git add -A "whatsapp-bot"
git commit -m "chore(aaral-bot): final cleanup pass after OCR/self-report removal" --allow-empty
```

(Use `--allow-empty` only if Step 2 found nothing to change and this commit would otherwise be empty — otherwise omit the flag.)

---

### Task 15: Full regression + deployment checklist

**Files:** none (verification only).

- [ ] **Step 1: Run every automated test suite**

```bash
cd "packages/payment-ledger-core" && npm test
cd "../../Clients /Aaral Marketing/dashboard" && npm test
cd "../whatsapp-bot" && npm test
```

Expected: all green — `payment-ledger-core` (existing suites + new `payments.test.js`), `dashboard` (existing suites + new `botInternal.test.js` + `users.test.js`), `whatsapp-bot` (`connection.test.js` untouched + rewritten `flows.test.js` + new `paymentIntent.test.js`, 27+ tests).

- [ ] **Step 2: Start both apps locally and smoke-test manually**

```bash
cd "dashboard" && npm start &
cd "whatsapp-bot" && npm start
```

With a real phone number added to a `dashboard_users` row (via the Users page, Task 9) and `BOT_INTERNAL_SECRET`/`DASHBOARD_INTERNAL_URL` set in both local `.env` files:
1. Text `BALANCE <a real customer name>` from that staff number → get a balance line back.
2. Text `LEDGER <a real customer name>` → get a PDF back.
3. Text a free-form payment report ("Received 500 cash from <test customer> today") → get the confirm summary, reply YES → confirm the payment lands in `payment_claims` (via the dashboard UI or a direct query) and the *test customer's own* WhatsApp number (use a real test number, not a live customer) receives the plain-text confirmation.
4. Text from a phone number NOT in `dashboard_users` → confirm total silence (no reply at all).
5. Confirm `PAID`/`HELP` from any number produce no special behavior anymore (fall through to the parser, which will report "no amount found" since those words alone don't parse as a payment).

- [ ] **Step 3: Document the still-open item this doesn't close on its own**

This redesign is a good opportunity to finally close the long-standing "real end-to-end WhatsApp send never independently confirmed" item from the project history — Step 2.3 above, watched on a real phone, closes it. Note the outcome back to the project's memory/notes once done.

- [ ] **Step 4: Deploy-repo sync reminder**

This plan's changes span three directories that all need to reach the deploy repo together: `dashboard/`, `whatsapp-bot/`, and the vendored `payment-ledger-core/` copy (the shared package's `ledger/payments.js` addition must ship with both apps, since both now depend on it). Run the existing `deploy/sync-to-deploy-repo.sh` and the office-PC deploy runbook (git pull → `npm install --omit=dev` in both `dashboard/` and `whatsapp-bot/` → `npm run migrate` in `dashboard/` for migration 007 → `pm2 restart aaral-dashboard aaral-bridge` → `pm2 save`) as a follow-up once this plan's tasks are all merged — not part of this plan's automated steps, since it requires the real office PC.
