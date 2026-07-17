# Customer Ledger + WhatsApp Invoice Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invoice persistence + a per-customer ledger (running balance, manual old-balance/cash-paid entries) to the Narayani Steels billing tool, then a decoupled WhatsApp sender so a recorded invoice can be sent to a customer on demand.

**Architecture:** Phase 1 mirrors the Stock module exactly — a synchronous JSON-file store (`app/ledgerStore.js`, atomic writes, computed-not-stored balance) behind new `/api/ledger/*` Express routes, three new pages (`ledger.html`, `customer.html`, `invoice.html`), and a targeted Chitti integration (customer picker, Record Invoice button) in `final-invoice-NS.html`. Phase 2 adds a wholly separate always-running `whatsapp-web.js` process (`whatsapp-bot/`) that the billing server talks to over a local HTTP call, plus server-side PDF rendering of the invoice.

**Tech Stack:** Phase 1 — plain Express + cors, no new dependencies, Node's built-in `node --test` for unit/integration tests (matching Stock's setup exactly). Phase 2 — `whatsapp-web.js` is a new dependency (the one exception to "no new deps," flagged explicitly in Task 7), plus headless Chrome for server-side PDF rendering (already used elsewhere in this project for verification, now invoked programmatically).

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-07-17-customer-ledger-whatsapp-design.md`.
- Only Invoice/Chitti creates ledger entries. Quotation and Delivery Challan are untouched by this entire plan.
- Ledger customers are opt-in only — no auto-creation from typed invoice fields.
- **Double-counting invariant (critical):** an invoice's ledger `due` entry amount is `sub+lab+weigh+freight+unload+gst+others` — **never** including Old Balance. Old Balance is informational display only, sourced live from the ledger, never re-added as a new due.
- `app/data/ledger.json` holds real financial data — add it to the same gitignore coverage as `app/data/stock.json` (already gitignored as a directory: `Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/` — confirm this covers `ledger.json` too before assuming a new gitignore line is needed).
- No new npm dependencies in Phase 1. Phase 2 adds `whatsapp-web.js` — flagged explicitly, install with the offline-shop-PC deployment constraint in mind (same reasoning that kept Stock on JSON instead of SQLite).
- Root files (`ledger.html`, `customer.html`, `invoice.html`, `final-invoice-NS.html`) are source of truth, synced to `app/public/` via `cp` before each task's verification, matching Stock's established convention.
- Project root for all paths below: `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /` (note the trailing spaces in "Clients /" and "Narayani Steels /" — copy exactly).
- Do not touch invoice calculation logic (GST, totals, row-padding) — only read from it when building the ledger payload.

---

## Phase 1: Invoice persistence + Customer Ledger

### Task 1: `ledgerStore.js` — JSON-backed data layer

**Files:**
- Create: `app/ledgerStore.js`
- Create: `app/ledgerStore.test.js`

**Interfaces:**
- Consumes: nothing (foundational task, same shape as `app/stockStore.js`).
- Produces (used by Task 2):
  - `createStore(filePath: string) => Store`, exported via `module.exports = { createStore }`.
  - `Store.init(): void`
  - `Store.listCustomers(): {id, name, phone, createdAt, balance}[]`
  - `Store.getCustomer(id): {..., balance}` — throws `Error('Customer not found')`.
  - `Store.addCustomer({name, phone}): {..., balance: 0}` — throws `Error('Customer name is required')`, `Error('Phone number is required')`, `Error('Phone number must contain digits only')`.
  - `Store.listEntries(customerId): {id, customerId, type, amount, reason, invoiceId, note, at}[]` (chronological ascending, oldest first — by construction, no sort needed) — throws `Error('Customer not found')`.
  - `Store.addOldBalance(customerId, amount, note?): entry` — throws `Error('Customer not found')`, `Error('Amount must be a positive number')`.
  - `Store.addCashPaid(customerId, amount, note?): entry` — same errors.
  - `Store.getInvoice(id): {id, invoiceNo, customerId, date, mobile, lorry, items, sub, lab, weigh, freight, unload, gst, others, total, createdAt}` — throws `Error('Invoice not found')`.
  - `Store.createInvoice({customerId, date, mobile, lorry, items, sub, lab, weigh, freight, unload, gst, others, advance}): invoice` — throws `Error('Customer not found')`, `Error('Items are required')`. Creates the invoice, one `due` entry (`amount = sub+lab+weigh+freight+unload+gst+others`, `reason: 'invoice'`), and if `advance > 0` one `payment` entry (`reason: 'advance'`).

- [ ] **Step 1: Write the failing test file**

Create `app/ledgerStore.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./ledgerStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-ledger-'));
  return path.join(dir, 'ledger.json');
}

test('starts with no customers', () => {
  const store = createStore(tempFile());
  assert.deepEqual(store.listCustomers(), []);
});

test('addCustomer validates name and phone', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.addCustomer({ name: '', phone: '9876543210' }), /Customer name is required/);
  assert.throws(() => store.addCustomer({ name: 'Lakshmi Steel', phone: '' }), /Phone number is required/);
  assert.throws(() => store.addCustomer({ name: 'Lakshmi Steel', phone: 'abc123' }), /Phone number must contain digits only/);

  const cust = store.addCustomer({ name: 'Lakshmi Steel', phone: '9876543210' });
  assert.equal(cust.name, 'Lakshmi Steel');
  assert.equal(cust.balance, 0);
  assert.equal(store.listCustomers().length, 1);
});

test('getCustomer throws for unknown id', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.getCustomer('cust_ghost'), /Customer not found/);
});

test('createInvoice posts a due entry equal to charges only, never including old balance', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Lakshmi Steel', phone: '9876543210' });

  const invoice = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '9876543210', lorry: 'TS08AB1234',
    items: [{ q: '500', name: 'MS Angle', p: '20', r: '52' }],
    sub: 26000, lab: 200, weigh: 0, freight: 0, unload: 0, gst: 4716, others: 0, advance: 0,
  });

  assert.equal(invoice.invoiceNo, 1);
  assert.equal(invoice.total, 26000 + 200 + 4716); // sub+lab+gst only — no old balance in this total

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'due');
  assert.equal(entries[0].reason, 'invoice');
  assert.equal(entries[0].amount, 26000 + 200 + 4716);
  assert.equal(entries[0].invoiceId, invoice.id);

  assert.equal(store.getCustomer(cust.id).balance, 26000 + 200 + 4716);
});

test('createInvoice with advance also posts a separate payment entry', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Test Buyer', phone: '9998887776' });

  const invoice = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '', lorry: '',
    items: [{ q: '100', name: 'TMT Bar', p: '10', r: '55' }],
    sub: 5500, lab: 40, weigh: 0, freight: 0, unload: 0, gst: 998, others: 0, advance: 2000,
  });

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reason, 'invoice');   // pushed first, chronologically first
  assert.equal(entries[1].reason, 'advance');
  assert.equal(entries[1].type, 'payment');
  assert.equal(entries[1].amount, 2000);
  assert.equal(entries[1].invoiceId, invoice.id);

  assert.equal(store.getCustomer(cust.id).balance, (5500 + 40 + 998) - 2000);
});

test('createInvoice rejects an unknown customer and requires items', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.createInvoice({ customerId: 'cust_ghost', items: [{ q: '1', name: 'x', p: '1', r: '1' }], sub: 1 }),
    /Customer not found/
  );
  const cust = store.addCustomer({ name: 'Empty Items Co', phone: '1112223334' });
  assert.throws(() => store.createInvoice({ customerId: cust.id, items: [] }), /Items are required/);
});

test('addOldBalance posts a due entry with reason old-balance; addCashPaid posts a payment', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Backfill Co', phone: '5556667778' });

  store.addOldBalance(cust.id, 15000, 'Pre-system dues');
  assert.equal(store.getCustomer(cust.id).balance, 15000);

  store.addCashPaid(cust.id, 5000, 'Cash collected in shop');
  assert.equal(store.getCustomer(cust.id).balance, 10000);

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reason, 'old-balance');
  assert.equal(entries[0].type, 'due');
  assert.equal(entries[1].reason, 'cash-paid');
  assert.equal(entries[1].type, 'payment');
});

test('addOldBalance and addCashPaid reject non-positive amounts and unknown customers', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Validation Co', phone: '4443332221' });
  assert.throws(() => store.addOldBalance(cust.id, 0), /Amount must be a positive number/);
  assert.throws(() => store.addCashPaid(cust.id, -5), /Amount must be a positive number/);
  assert.throws(() => store.addOldBalance('cust_ghost', 100), /Customer not found/);
});

test('getInvoice returns the stored snapshot; throws for unknown id', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Snapshot Co', phone: '2223334445' });
  const created = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '2223334445', lorry: 'TS09ZZ0001',
    items: [{ q: '10', name: 'Rod', p: '1', r: '5' }], sub: 50, lab: 5, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
  });
  const fetched = store.getInvoice(created.id);
  assert.equal(fetched.invoiceNo, created.invoiceNo);
  assert.equal(fetched.items.length, 1);
  assert.throws(() => store.getInvoice('inv_ghost'), /Invoice not found/);
});

test('invoice numbers increment sequentially across customers', () => {
  const store = createStore(tempFile());
  const a = store.addCustomer({ name: 'A Co', phone: '1000000001' });
  const b = store.addCustomer({ name: 'B Co', phone: '1000000002' });
  const inv1 = store.createInvoice({ customerId: a.id, items: [{ q: '1', name: 'x', p: '1', r: '1' }], sub: 1, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0 });
  const inv2 = store.createInvoice({ customerId: b.id, items: [{ q: '1', name: 'y', p: '1', r: '1' }], sub: 1, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0 });
  assert.equal(inv1.invoiceNo, 1);
  assert.equal(inv2.invoiceNo, 2);
});

test('data survives being reloaded from disk by a fresh store instance', () => {
  const file = tempFile();
  const store = createStore(file);
  const cust = store.addCustomer({ name: 'Persist Co', phone: '9990001112' });
  store.addOldBalance(cust.id, 500);

  const reloaded = createStore(file);
  assert.equal(reloaded.getCustomer(cust.id).balance, 500);
  assert.equal(reloaded.listEntries(cust.id).length, 1);
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test ledgerStore.test.js
```
Expected: fails with `Cannot find module './ledgerStore'`, non-zero exit code.

- [ ] **Step 3: Write the implementation**

Create `app/ledgerStore.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createStore(filePath) {
  let data = null;

  function load() {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`ledger.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
      data = { customers: [], invoices: [], ledgerEntries: [], invoiceCounter: 0 };
      save();
    }
  }

  function save() {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function ensureLoaded() {
    if (!data) load();
  }

  function init() {
    ensureLoaded();
  }

  function computeBalance(customerId) {
    let balance = 0;
    for (const e of data.ledgerEntries) {
      if (e.customerId !== customerId) continue;
      balance += e.type === 'due' ? e.amount : -e.amount;
    }
    return balance;
  }

  function listCustomers() {
    ensureLoaded();
    return data.customers.map((c) => ({ ...c, balance: computeBalance(c.id) }));
  }

  function getCustomer(id) {
    ensureLoaded();
    const c = data.customers.find((c) => c.id === id);
    if (!c) throw new Error('Customer not found');
    return { ...c, balance: computeBalance(id) };
  }

  function addCustomer({ name, phone }) {
    ensureLoaded();
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Customer name is required');
    const trimmedPhone = (phone || '').trim();
    if (!trimmedPhone) throw new Error('Phone number is required');
    if (!/^\d+$/.test(trimmedPhone)) throw new Error('Phone number must contain digits only');
    const cust = { id: newId('cust'), name: trimmedName, phone: trimmedPhone, createdAt: new Date().toISOString() };
    data.customers.push(cust);
    save();
    return { ...cust, balance: 0 };
  }

  function listEntries(customerId) {
    ensureLoaded();
    if (!data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    // ledgerEntries is always appended in chronological order — filtering
    // preserves that order, so this is already oldest-first with no sort
    // needed (same lesson as stockStore's movement-order fix: don't sort by
    // millisecond timestamps when array order already encodes the truth).
    return data.ledgerEntries.filter((e) => e.customerId === customerId);
  }

  function addManualEntry(customerId, type, amount, reason, note) {
    ensureLoaded();
    if (!data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Amount must be a positive number');
    const entry = { id: newId('le'), customerId, type, amount: n, reason, invoiceId: null, note: note || '', at: new Date().toISOString() };
    data.ledgerEntries.push(entry);
    save();
    return entry;
  }

  function addOldBalance(customerId, amount, note) {
    return addManualEntry(customerId, 'due', amount, 'old-balance', note);
  }

  function addCashPaid(customerId, amount, note) {
    return addManualEntry(customerId, 'payment', amount, 'cash-paid', note);
  }

  function getInvoice(id) {
    ensureLoaded();
    const inv = data.invoices.find((i) => i.id === id);
    if (!inv) throw new Error('Invoice not found');
    return inv;
  }

  function createInvoice({ customerId, date, mobile, lorry, items, sub, lab, weigh, freight, unload, gst, others, advance }) {
    ensureLoaded();
    if (!customerId || !data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    if (!Array.isArray(items) || !items.length) throw new Error('Items are required');
    const n = (v) => Number(v) || 0;
    const total = n(sub) + n(lab) + n(weigh) + n(freight) + n(unload) + n(gst) + n(others);
    data.invoiceCounter = (data.invoiceCounter || 0) + 1;
    const invoice = {
      id: newId('inv'),
      invoiceNo: data.invoiceCounter,
      customerId,
      date: date || '',
      mobile: mobile || '',
      lorry: lorry || '',
      items,
      sub: n(sub), lab: n(lab), weigh: n(weigh), freight: n(freight), unload: n(unload), gst: n(gst), others: n(others),
      total,
      createdAt: new Date().toISOString(),
    };
    data.invoices.push(invoice);
    data.ledgerEntries.push({ id: newId('le'), customerId, type: 'due', amount: total, reason: 'invoice', invoiceId: invoice.id, note: '', at: new Date().toISOString() });
    const advanceAmt = n(advance);
    if (advanceAmt > 0) {
      data.ledgerEntries.push({ id: newId('le'), customerId, type: 'payment', amount: advanceAmt, reason: 'advance', invoiceId: invoice.id, note: '', at: new Date().toISOString() });
    }
    save();
    return invoice;
  }

  return { init, listCustomers, getCustomer, addCustomer, listEntries, addOldBalance, addCashPaid, getInvoice, createInvoice };
}

module.exports = { createStore };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test ledgerStore.test.js
```
Expected: all 10 tests pass, `# fail 0`, exit code 0.

Then confirm the full suite together:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && npm test
```
Expected: `stockStore.test.js` (10), `server.test.js` (7), `ledgerStore.test.js` (10) all pass — 27 total, `# fail 0`.

- [ ] **Step 5: Confirm `app/data/` gitignore coverage extends to `ledger.json`**

Run:
```bash
cd /Users/vanshjalan && git check-ignore -v "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/ledger.json"
```
Expected: prints a match against the existing `Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/` line in `.gitignore` (added during the Stock module work) — exit code 0. No new gitignore line needed since that entry covers the whole directory.

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/ledgerStore.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/ledgerStore.test.js"
git commit -m "feat(narayani-steels): add JSON-backed customer ledger data layer"
```

---

### Task 2: `/api/ledger/*` routes on `server.js`

**Files:**
- Modify: `app/server.js`
- Modify: `app/server.test.js`

**Interfaces:**
- Consumes: `createStore` from Task 1's `app/ledgerStore.js` (exact signatures above).
- Produces (used by Tasks 3–6):
  - `GET /api/ledger/customers` → `200 [{id,name,phone,createdAt,balance}, ...]`
  - `POST /api/ledger/customers` body `{name,phone}` → `201 {...,balance:0}` or `400 {error}`
  - `GET /api/ledger/customers/:id` → `200 {...,balance}` or `404 {error}`
  - `GET /api/ledger/customers/:id/entries` → `200 [{id,customerId,type,amount,reason,invoiceId,note,at}, ...]` (oldest first) or `404 {error}`
  - `POST /api/ledger/customers/:id/old-balance` body `{amount,note?}` → `201 entry`, `400`, or `404`
  - `POST /api/ledger/customers/:id/cash-paid` body `{amount,note?}` → `201 entry`, `400`, or `404`
  - `POST /api/ledger/invoices` body `{customerId,date,mobile,lorry,items,sub,lab,weigh,freight,unload,gst,others,advance}` → `201 {invoice..., customerName}` or `400 {error}` — response is enriched with the customer's `name` (fetched in the route handler, not stored redundantly in `ledgerStore`) so the Chitti UI can show a confirmation without a second round-trip.
  - `GET /api/ledger/invoices/:id` → `200 {invoice..., customerName}` or `404 {error}`

- [ ] **Step 0: Point `server.test.js` at a temp ledger file too**

`server.test.js` already sets `process.env.STOCK_DATA_PATH` to a temp file before requiring `server.js`, but has no equivalent for the ledger store — without this, ledger tests silently write into the real `app/data/ledger.json` on every run, and repeated runs accumulate customers/invoices across runs (caught by actually running `npm test` twice in a row during implementation — the second run failed because the first run's test customers were still there). Add the missing line right next to the existing one:

Replace:
```js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-server-'));
process.env.STOCK_DATA_PATH = path.join(tmpDir, 'stock.json');
process.env.PORT = '0'; // unused directly by tests, but keeps server.js's default sane if ever invoked
```
with:
```js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-server-'));
process.env.STOCK_DATA_PATH = path.join(tmpDir, 'stock.json');
process.env.LEDGER_DATA_PATH = path.join(tmpDir, 'ledger.json');
process.env.PORT = '0'; // unused directly by tests, but keeps server.js's default sane if ever invoked
```

- [ ] **Step 1: Extend the failing test file**

Append to `app/server.test.js` (after the existing Stock tests, before the final closing of the file — these are new `test(...)` blocks in the same file, reusing the existing `listen`/`close`/`baseUrl`/`postJson` helpers already defined there):

```js
test('GET /api/ledger/customers starts empty', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/ledger/customers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/customers creates a customer, validates input', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/ledger/customers', { name: 'Lakshmi Steel', phone: '9876543210' });
    assert.equal(res.status, 201);
    const cust = await res.json();
    assert.equal(cust.balance, 0);

    const bad = await postJson(server, '/api/ledger/customers', { name: '', phone: '123' });
    assert.equal(bad.status, 400);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/invoices creates an invoice + due entry, excludes old balance from the due amount', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Test Buyer', phone: '9998887776' })).json();
    const res = await postJson(server, '/api/ledger/invoices', {
      customerId: cust.id, date: '17/07/2026', mobile: '9998887776', lorry: 'TS08AB1234',
      items: [{ q: '500', name: 'MS Angle', p: '20', r: '52' }],
      sub: 26000, lab: 200, weigh: 0, freight: 0, unload: 0, gst: 4716, others: 0, advance: 2000,
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.invoiceNo, 1);
    assert.equal(body.customerName, 'Test Buyer');
    assert.equal(body.total, 26000 + 200 + 4716);

    const entriesRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}/entries`);
    const entries = await entriesRes.json();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].reason, 'invoice');
    assert.equal(entries[1].reason, 'advance');

    const custRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`);
    const custBody = await custRes.json();
    assert.equal(custBody.balance, (26000 + 200 + 4716) - 2000);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/customers/:id/old-balance and /cash-paid update the ledger; unknown customer is 404', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Backfill Co', phone: '5556667778' })).json();
    const oldBalRes = await postJson(server, `/api/ledger/customers/${cust.id}/old-balance`, { amount: 15000, note: 'Pre-system' });
    assert.equal(oldBalRes.status, 201);

    const cashRes = await postJson(server, `/api/ledger/customers/${cust.id}/cash-paid`, { amount: 5000 });
    assert.equal(cashRes.status, 201);

    const custRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`);
    assert.equal((await custRes.json()).balance, 10000);

    const missing = await postJson(server, '/api/ledger/customers/cust_ghost/old-balance', { amount: 100 });
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test('GET /api/ledger/invoices/:id returns the snapshot with customerName; 404 for unknown', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Snapshot Co', phone: '2223334445' })).json();
    const created = await (
      await postJson(server, '/api/ledger/invoices', {
        customerId: cust.id, date: '17/07/2026', mobile: '2223334445', lorry: 'TS09ZZ0001',
        items: [{ q: '10', name: 'Rod', p: '1', r: '5' }], sub: 50, lab: 5, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
      })
    ).json();

    const res = await fetch(`${baseUrl(server)}/api/ledger/invoices/${created.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.customerName, 'Snapshot Co');
    assert.equal(body.items.length, 1);

    const missing = await fetch(`${baseUrl(server)}/api/ledger/invoices/inv_ghost`);
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});
```

- [ ] **Step 2: Run the extended test file to verify the new tests fail**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test server.test.js
```
Expected: the 7 pre-existing Stock tests still pass; the 5 new ledger tests fail (404s / connection errors — `/api/ledger/*` routes don't exist yet).

- [ ] **Step 3: Modify `server.js`**

Add the ledger store setup right after the existing stock store setup block (after the `requireStock` function definition, before the `// ─── License validation` comment):

```js
const LEDGER_DATA_PATH = process.env.LEDGER_DATA_PATH || path.join(__dirname, 'data', 'ledger.json');
const ledgerStore = createLedgerStore(LEDGER_DATA_PATH);
let _ledgerInitError = null;
try {
  ledgerStore.init();
} catch (err) {
  _ledgerInitError = err;
  console.error(`[Ledger] Failed to load ledger data: ${err.message}`);
}

function sendLedgerError(res, err) {
  const status = /not found/i.test(err.message) ? 404 : 400;
  res.status(status).json({ error: err.message });
}

// Guards every /api/ledger/* route — same reasoning as requireStock: a
// corrupted ledger.json must not take down billing or Stock.
function requireLedger(req, res, next) {
  if (_ledgerInitError) return res.status(500).json({ error: 'Ledger data is unavailable — see server logs.' });
  next();
}
```

Add the import alongside the existing stock import (top of file):

Replace:
```js
const { createStore } = require('./stockStore');
```
with:
```js
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');
```

Add the routes after the existing `/api/stock/*` block, before `app.use(express.static(path.join(__dirname, 'public')));`:

```js
app.use('/api/ledger', requireLedger);

app.get('/api/ledger/customers', (req, res) => {
  res.json(ledgerStore.listCustomers());
});

app.post('/api/ledger/customers', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addCustomer(req.body || {}));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/customers/:id', (req, res) => {
  try {
    res.json(ledgerStore.getCustomer(req.params.id));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/customers/:id/entries', (req, res) => {
  try {
    res.json(ledgerStore.listEntries(req.params.id));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/customers/:id/old-balance', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addOldBalance(req.params.id, req.body && req.body.amount, req.body && req.body.note));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/customers/:id/cash-paid', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addCashPaid(req.params.id, req.body && req.body.amount, req.body && req.body.note));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/invoices', (req, res) => {
  try {
    const invoice = ledgerStore.createInvoice(req.body || {});
    const customer = ledgerStore.getCustomer(invoice.customerId);
    res.status(201).json({ ...invoice, customerName: customer.name });
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/invoices/:id', (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    res.json({ ...invoice, customerName: customer.name });
  } catch (err) {
    sendLedgerError(res, err);
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test server.test.js
```
Expected: all 12 tests pass (7 Stock + 5 Ledger), `# fail 0`.

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && npm test
```
Expected: 29 tests total across all 3 files, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.test.js"
git commit -m "feat(narayani-steels): add /api/ledger/* routes to server.js"
```

---

### Task 3: `ledger.html` + `customer.html` — customer list and detail UI

**Files:**
- Create: `ledger.html` (project root)
- Create: `customer.html` (project root)
- Copy: both → `app/public/`

**Interfaces:**
- Consumes: Task 2's `GET/POST /api/ledger/customers`, `GET /api/ledger/customers/:id`, `GET /api/ledger/customers/:id/entries`, `POST /api/ledger/customers/:id/old-balance`, `POST /api/ledger/customers/:id/cash-paid`.
- Produces: nothing consumed by later tasks in this file, but `customer.html` links to `invoice.html?id=` (Task 4) for `reason: 'invoice'` entries.

- [ ] **Step 1: Write `ledger.html`**

Create `ledger.html` at the project root (CSS matches `stock.html`'s established palette/classes exactly, for visual consistency across the app's modules):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels — Ledger</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f4f4f0;min-height:100vh;padding:1.5rem 1rem}
.wrap{max-width:820px;margin:0 auto}
.back-link{display:inline-block;font-size:13px;color:#888;text-decoration:none;margin-bottom:10px}
.back-link:hover{color:#c45c00}
.app-title{font-size:20px;font-weight:600;color:#c45c00;margin-bottom:4px;text-align:center}
.app-sub{font-size:13px;color:#888;text-align:center;margin-bottom:1.25rem}
.card{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h3{font-size:12px;font-weight:600;color:#888;margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.05em}
.fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.fg label{font-size:12px;color:#666;font-weight:500}
.fg input{width:100%;padding:9px 11px;border:1.5px solid #e2e2e2;border-radius:7px;font-size:14px;background:#fff;color:#111}
.fg input:focus{outline:none;border-color:#c45c00}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.btn-p{background:#c45c00;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn-p:hover{filter:brightness(0.85)}
.btn-s{background:#fff;border:1.5px solid #e2e2e2;border-radius:8px;padding:9px 18px;font-size:14px;color:#333;cursor:pointer;font-weight:500}
.btn-s:hover{background:#f4f4f0}
table.ctbl{width:100%;border-collapse:collapse;font-size:13px}
.ctbl th{font-size:11px;font-weight:600;color:#888;padding:6px 5px;border-bottom:1.5px solid #e9e9e9;text-align:left}
.ctbl td{padding:10px 5px;vertical-align:middle;border-bottom:1px solid #f0f0f0;cursor:pointer}
.ctbl tr:hover td{background:#faf8f5}
.ctbl td.r{text-align:right;font-weight:600}
.ctbl td.pos{color:#dc2626}
.ctbl td.zero{color:#16a34a}
.empty-note{color:#999;font-size:13px;padding:14px 0;text-align:center}
.err{color:#dc2626;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
  <div class="app-title">📒 Narayani Steels — Ledger</div>
  <div class="app-sub">Customers, balances, and account history</div>

  <div class="card">
    <h3>Customers</h3>
    <div class="fg"><input id="search" type="text" placeholder="Search by name or phone…" oninput="renderCustomers()"></div>
    <table class="ctbl">
      <thead><tr><th>Name</th><th>Phone</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody id="cust-tbody"></tbody>
    </table>
    <div class="empty-note" id="empty-note" style="display:none">No customers yet.</div>
  </div>

  <div class="card">
    <h3>+ Add customer</h3>
    <div class="grid2">
      <div class="fg"><label>Name</label><input id="new-cust-name" type="text" placeholder="Lakshmi Bhavani Steel"></div>
      <div class="fg"><label>Phone</label><input id="new-cust-phone" type="text" placeholder="9876543210"></div>
    </div>
    <div class="err" id="cust-err" style="display:none"></div>
    <button class="btn-p" onclick="saveCustomer()">+ Add Customer</button>
  </div>
</div>

<script>
const API = '/api/ledger';
let customers = [];

async function loadCustomers() {
  const res = await fetch(`${API}/customers`);
  customers = await res.json();
  renderCustomers();
}

function fmtRupees(v) {
  return Math.round(v).toLocaleString('en-IN');
}

function renderCustomers() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const filtered = q ? customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : customers;
  const tbody = document.getElementById('cust-tbody');
  document.getElementById('empty-note').style.display = filtered.length ? 'none' : 'block';
  tbody.innerHTML = filtered
    .map(
      (c) =>
        `<tr onclick="location.href='customer.html?id=${c.id}'"><td>${c.name}</td><td>${c.phone}</td><td class="r ${c.balance > 0 ? 'pos' : 'zero'}">₹${fmtRupees(Math.abs(c.balance))}${c.balance > 0 ? ' due' : c.balance < 0 ? ' credit' : ''}</td></tr>`
    )
    .join('');
}

async function saveCustomer() {
  const name = document.getElementById('new-cust-name').value;
  const phone = document.getElementById('new-cust-phone').value;
  const errEl = document.getElementById('cust-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save customer');
    document.getElementById('new-cust-name').value = '';
    document.getElementById('new-cust-phone').value = '';
    await loadCustomers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

loadCustomers();
</script>
</body>
</html>
```

- [ ] **Step 2: Write `customer.html`**

Create `customer.html` at the project root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels — Customer Ledger</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f4f4f0;min-height:100vh;padding:1.5rem 1rem}
.wrap{max-width:820px;margin:0 auto}
.back-link{display:inline-block;font-size:13px;color:#888;text-decoration:none;margin-bottom:10px}
.back-link:hover{color:#c45c00}
.card{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h3{font-size:12px;font-weight:600;color:#888;margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.05em}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:1rem}
.stat{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:14px;text-align:center}
.stat .v{font-size:20px;font-weight:700;color:#111}
.stat .l{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.stat.due .v{color:#dc2626}
.stat.credit .v{color:#16a34a}
.btn-p{background:#c45c00;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn-p:hover{filter:brightness(0.85)}
.btn-s{background:#fff;border:1.5px solid #e2e2e2;border-radius:8px;padding:9px 18px;font-size:14px;color:#333;cursor:pointer;font-weight:500}
.btn-s:hover{background:#f4f4f0}
.acts{display:flex;gap:8px;margin-bottom:1rem}
.inline-form{background:#f7f7f5;border-radius:8px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:1rem}
.inline-form input{padding:7px 9px;border:1.5px solid #e2e2e2;border-radius:6px;font-size:13px;width:160px}
table.ltbl{width:100%;border-collapse:collapse;font-size:13px}
.ltbl th{font-size:11px;font-weight:600;color:#888;padding:6px 5px;border-bottom:1.5px solid #e9e9e9;text-align:left}
.ltbl td{padding:8px 5px;vertical-align:middle;border-bottom:1px solid #f0f0f0}
.ltbl td.r{text-align:right}
.ltbl td.due{color:#dc2626}
.ltbl td.payment{color:#16a34a}
.ltbl a{color:#c45c00;text-decoration:none;font-weight:600}
.empty-note{color:#999;font-size:13px;padding:14px 0;text-align:center}
.err{color:#dc2626;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <a class="back-link" href="ledger.html">← Back to Ledger</a>
  <div class="stats" id="stats"></div>

  <div class="card">
    <div class="acts">
      <button class="btn-s" onclick="toggleForm('old-balance')">+ Old Balance</button>
      <button class="btn-s" onclick="toggleForm('cash-paid')">+ Cash Paid</button>
    </div>
    <div id="entry-form-area"></div>
    <h3>Account History</h3>
    <table class="ltbl">
      <thead><tr><th>Date</th><th>Type</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead>
      <tbody id="entries-tbody"></tbody>
    </table>
    <div class="empty-note" id="empty-note" style="display:none">No entries yet.</div>
  </div>
</div>

<script>
const API = '/api/ledger';
const params = new URLSearchParams(location.search);
const customerId = params.get('id');
let customer = null;
let entries = [];
let openForm = null; // 'old-balance' | 'cash-paid' | null

function fmtRupees(v) {
  return Math.round(v).toLocaleString('en-IN');
}
const REASON_LABELS = { invoice: 'Invoice', 'old-balance': 'Old Balance', 'cash-paid': 'Cash Paid', advance: 'Advance' };

async function loadAll() {
  const [custRes, entriesRes] = await Promise.all([
    fetch(`${API}/customers/${customerId}`),
    fetch(`${API}/customers/${customerId}/entries`),
  ]);
  customer = await custRes.json();
  entries = await entriesRes.json();
  renderStats();
  renderEntries();
}

function renderStats() {
  const balClass = customer.balance > 0 ? 'due' : customer.balance < 0 ? 'credit' : '';
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="v">${customer.name}</div><div class="l">Name</div></div>
    <div class="stat"><div class="v">${customer.phone}</div><div class="l">Phone</div></div>
    <div class="stat ${balClass}"><div class="v">₹${fmtRupees(Math.abs(customer.balance))}</div><div class="l">${customer.balance > 0 ? 'Balance Due' : customer.balance < 0 ? 'Credit' : 'Settled'}</div></div>
    <div class="stat"><div class="v">${entries.length}</div><div class="l">Entries</div></div>
  `;
}

function renderEntries() {
  const tbody = document.getElementById('entries-tbody');
  document.getElementById('empty-note').style.display = entries.length ? 'none' : 'block';
  let running = 0;
  tbody.innerHTML = entries
    .map((e) => {
      running += e.type === 'due' ? e.amount : -e.amount;
      const label = REASON_LABELS[e.reason] || e.reason;
      const labelHtml = e.reason === 'invoice' && e.invoiceId ? `<a href="invoice.html?id=${e.invoiceId}">${label}</a>` : label;
      const sign = e.type === 'due' ? '+' : '-';
      return `<tr><td>${new Date(e.at).toLocaleDateString('en-IN')}</td><td class="${e.type}">${labelHtml}</td><td class="r ${e.type}">${sign}₹${fmtRupees(e.amount)}</td><td class="r">₹${fmtRupees(running)}</td></tr>`;
    })
    .join('');
}

function toggleForm(kind) {
  openForm = openForm === kind ? null : kind;
  renderForm();
}
function renderForm() {
  const area = document.getElementById('entry-form-area');
  if (!openForm) {
    area.innerHTML = '';
    return;
  }
  const label = openForm === 'old-balance' ? 'Old balance amount (kg)' : 'Cash paid amount';
  area.innerHTML = `<div class="inline-form">
    <input id="entry-amount" type="number" min="0" step="any" placeholder="Amount">
    <input id="entry-note" type="text" placeholder="Note (optional)">
    <button class="btn-p" onclick="submitEntry()">Save</button>
    <button class="btn-s" onclick="toggleForm('${openForm}')">Cancel</button>
    <span class="err" id="entry-err" style="display:none"></span>
  </div>`;
}
async function submitEntry() {
  const amount = parseFloat(document.getElementById('entry-amount').value);
  const note = document.getElementById('entry-note').value;
  const errEl = document.getElementById('entry-err');
  const path = openForm === 'old-balance' ? 'old-balance' : 'cash-paid';
  try {
    const res = await fetch(`${API}/customers/${customerId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, note }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save entry');
    openForm = null;
    renderForm();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

loadAll();
</script>
</body>
</html>
```

- [ ] **Step 3: Sync both pages to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /ledger.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/ledger.html"
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /customer.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/customer.html"
```

- [ ] **Step 4: Start a local dev server against a scratch data file**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3303 STOCK_DATA_PATH=/tmp/ns-ledger-manual/stock.json LEDGER_DATA_PATH=/tmp/ns-ledger-manual/ledger.json \
  node server.js > /tmp/ns-ledger-dev-server.log 2>&1 &
sleep 1 && curl -s http://localhost:3303/api/ledger/customers
```
Expected: `[]`.

- [ ] **Step 5: Verify end-to-end via Claude-in-Chrome**

Navigate to `http://localhost:3303/ledger.html`. Confirm empty customer list + empty-note. Add a customer (Name: `Lakshmi Bhavani Steel`, Phone: `9876543210`). Confirm the row appears with `₹0` balance (styled green/"Settled" — not red, since balance is exactly 0). Click the row → confirm navigation to `customer.html?id=...` with matching stat tiles and an empty account-history table.

Click "+ Old Balance", enter `15000`, Save. Confirm a stat tile updates to "Balance Due ₹15,000" (red) and one "Old Balance +₹15,000" row appears with running balance `₹15,000`.

Click "+ Cash Paid", enter `5000`, Save. Confirm balance updates to `₹10,000` due, and a green "Cash Paid -₹5,000" row appears with running balance `₹10,000`.

- [ ] **Step 6: Stop the dev server**

```bash
lsof -ti:3303 | xargs -r kill -9
```

- [ ] **Step 7: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /ledger.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /customer.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/ledger.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/customer.html"
git commit -m "feat(narayani-steels): add ledger.html and customer.html — customer list and account history"
```

---

### Task 4: `invoice.html` — read-only invoice snapshot

**Files:**
- Create: `invoice.html` (project root)
- Copy: → `app/public/invoice.html`

**Interfaces:**
- Consumes: Task 2's `GET /api/ledger/invoices/:id`.
- Produces: nothing consumed by later tasks — this is a leaf page, linked to from `customer.html` (Task 3, already wired) and from the Chitti's post-record confirmation (Task 6).

- [ ] **Step 1: Write `invoice.html`**

Create `invoice.html` at the project root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels — Invoice</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f4f4f0;min-height:100vh;padding:1.5rem 1rem}
.wrap{max-width:620px;margin:0 auto}
.back-link{display:inline-block;font-size:13px;color:#888;text-decoration:none;margin-bottom:10px}
.back-link:hover{color:#c45c00}
.card{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h2{font-size:16px;font-weight:600;color:#111;margin-bottom:.75rem}
h3{font-size:12px;font-weight:600;color:#888;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.05em}
.meta{font-size:13px;color:#555;margin-bottom:4px}
.meta b{color:#111}
table.itbl2{width:100%;border-collapse:collapse;font-size:13px;margin-top:.75rem}
.itbl2 th{font-size:11px;font-weight:600;color:#888;padding:6px 5px;border-bottom:1.5px solid #e9e9e9;text-align:left}
.itbl2 td{padding:6px 5px;border-bottom:1px solid #f0f0f0}
.itbl2 td.r{text-align:right}
.chgrow{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#555}
.chgrow.tot{font-weight:700;font-size:15px;color:#111;border-top:1.5px solid #e2e2e2;margin-top:6px;padding-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <a class="back-link" href="#" id="back-link">← Back</a>
  <div class="card" id="content">Loading…</div>
</div>

<script>
const params = new URLSearchParams(location.search);
const invoiceId = params.get('id');

function fmtRupees(v) {
  return Math.round(v).toLocaleString('en-IN');
}

async function load() {
  const res = await fetch(`/api/ledger/invoices/${invoiceId}`);
  const content = document.getElementById('content');
  if (!res.ok) {
    content.innerHTML = '<p>Invoice not found.</p>';
    return;
  }
  const inv = await res.json();
  document.getElementById('back-link').href = `customer.html?id=${inv.customerId}`;
  const itemRows = inv.items
    .map((r) => {
      const q = parseFloat(r.q) || 0, rt = parseFloat(r.r) || 0, amt = q * rt;
      return `<tr><td>${r.name || ''}</td><td class="r">${r.q || ''}</td><td class="r">${r.r || ''}</td><td class="r">${amt ? fmtRupees(amt) : ''}</td></tr>`;
    })
    .join('');
  const charges = [
    ['Subtotal', inv.sub],
    ['Loading Charges', inv.lab],
    ['Kanta Charges', inv.weigh],
    ['Freight', inv.freight],
    ['Unloading', inv.unload],
    ['GST', inv.gst],
    ['Others', inv.others],
  ]
    .filter(([, v]) => v > 0)
    .map(([label, v]) => `<div class="chgrow"><span>${label}</span><span>₹${fmtRupees(v)}</span></div>`)
    .join('');
  content.innerHTML = `
    <h2>Invoice #${inv.invoiceNo}</h2>
    <div class="meta">Customer: <b>${inv.customerName}</b></div>
    <div class="meta">Date: <b>${inv.date || '—'}</b> · Mobile: <b>${inv.mobile || '—'}</b> · Lorry: <b>${inv.lorry || '—'}</b></div>
    <table class="itbl2">
      <thead><tr><th>Particulars</th><th class="r">Qty (kg)</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <h3 style="margin-top:1rem">Charges</h3>
    ${charges}
    <div class="chgrow tot"><span>Total</span><span>₹${fmtRupees(inv.total)}</span></div>
  `;
}

load();
</script>
</body>
</html>
```

- [ ] **Step 2: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /invoice.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/invoice.html"
```

- [ ] **Step 3: Verify via Claude-in-Chrome**

Restart the dev server from Task 3 (same command, same scratch paths, so the earlier test customer/entries are still there):
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3303 STOCK_DATA_PATH=/tmp/ns-ledger-manual/stock.json LEDGER_DATA_PATH=/tmp/ns-ledger-manual/ledger.json \
  node server.js > /tmp/ns-ledger-dev-server.log 2>&1 &
sleep 1
```

Since Task 3's verification only added manual old-balance/cash-paid entries (no actual invoice yet), create one directly via `curl` to have something to view:
```bash
CUST_ID=$(curl -s http://localhost:3303/api/ledger/customers | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST http://localhost:3303/api/ledger/invoices -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUST_ID\",\"date\":\"17/07/2026\",\"mobile\":\"9876543210\",\"lorry\":\"TS08AB1234\",\"items\":[{\"q\":\"500\",\"name\":\"MS Angle\",\"p\":\"20\",\"r\":\"52\"}],\"sub\":26000,\"lab\":200,\"weigh\":0,\"freight\":0,\"unload\":0,\"gst\":4716,\"others\":0,\"advance\":0}"
```
Note the returned `"id"` value. Navigate to `http://localhost:3303/invoice.html?id=<that id>`. Confirm: "Invoice #1" heading, customer name, date/mobile/lorry line, one item row (MS Angle, 500, 52, 26,000), charges breakdown (Subtotal 26,000, Loading Charges 200, GST 4,716), Total ₹30,916. Click "← Back" and confirm it returns to `customer.html?id=<customerId>` where a new "Invoice +₹30,916" row now appears (running balance now reflects the earlier manual entries plus this).

- [ ] **Step 4: Stop the dev server**

```bash
lsof -ti:3303 | xargs -r kill -9
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /invoice.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/invoice.html"
git commit -m "feat(narayani-steels): add invoice.html — read-only invoice snapshot view"
```

---

### Task 5: 5th "Ledger" card + Chitti customer picker + Old Balance auto-fill

**Files:**
- Modify: `final-invoice-NS.html` (project root)
- Copy: → `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: Task 2's `GET /api/ledger/customers`, `GET /api/ledger/customers/:id`.
- Produces (used by Task 6): global `let ledgerCustomers` (array of `{id,name,phone,balance}`), `<select id="f-customer">` element, `onCustomerPick()` function that sets `#f-oldbal` read-only/live.

- [ ] **Step 1: Confirm current baseline**

Run:
```bash
grep -n 'grid-template-columns:1fr 1fr 1fr 1fr"\|id="s3"\|Customer name\|f-oldbal' \
  "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected: matches at (approximately) lines 90, 98, 101, 126 — confirm against actual output, the Stock module's edits are the most recent state so these are the current baseline.

- [ ] **Step 2: Widen the Document type grid to 5 columns and add the Ledger card**

Replace:
```html
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
      <button class="type-btn" onclick="pickType('Challan',this)"><div class="tl">🚚 Delivery Challan</div></button>
      <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
    </div>
```
with:
```html
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
      <button class="type-btn" onclick="pickType('Challan',this)"><div class="tl">🚚 Delivery Challan</div></button>
      <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
      <a class="type-btn" href="ledger.html" style="text-decoration:none;display:block"><div class="tl">📒 Ledger</div></a>
    </div>
```

- [ ] **Step 3: Add the customer picker to the Chitti step**

Replace:
```html
    <div class="card"><h3>Customer details</h3>
      <div class="grid2">
        <div class="fg"><label>M/s. (Customer name)</label><input id="f-name" type="text" placeholder="Customer name"></div>
        <div class="fg"><label>Date</label><input id="f-date" type="text" placeholder="21/04/2026"></div>
      </div>
```
with:
```html
    <div class="card"><h3>Customer details</h3>
      <div class="fg"><label>Ledger Customer (optional — links this invoice to their account)</label><select id="f-customer" onchange="onCustomerPick()"><option value="">— Walk-in, not tracked —</option></select></div>
      <div class="grid2">
        <div class="fg"><label>M/s. (Customer name)</label><input id="f-name" type="text" placeholder="Customer name"></div>
        <div class="fg"><label>Date</label><input id="f-date" type="text" placeholder="21/04/2026"></div>
      </div>
```

- [ ] **Step 4: Add the JS — `loadLedgerCustomers`, `onCustomerPick`**

Replace:
```js
function matchStockItem(i,value){
  const trimmed=value.trim().toLowerCase();
  const match=stockItems.find(it=>stockDisplayName(it).toLowerCase()===trimmed);
  rows[i].stockItemId=match?match.id:null;
}
```
with:
```js
function matchStockItem(i,value){
  const trimmed=value.trim().toLowerCase();
  const match=stockItems.find(it=>stockDisplayName(it).toLowerCase()===trimmed);
  rows[i].stockItemId=match?match.id:null;
}
let ledgerCustomers=[];
async function loadLedgerCustomers(){
  try{
    const res=await fetch('/api/ledger/customers');
    ledgerCustomers=await res.json();
    const sel=document.getElementById('f-customer');
    sel.innerHTML='<option value="">— Walk-in, not tracked —</option>'+ledgerCustomers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  }catch(err){/* ledger module optional; billing works without it */}
}
async function onCustomerPick(){
  const id=document.getElementById('f-customer').value;
  const oldbalEl=document.getElementById('f-oldbal');
  if(!id){
    oldbalEl.readOnly=false;oldbalEl.style.background='';oldbalEl.style.color='';
    recalc();
    return;
  }
  try{
    const res=await fetch(`/api/ledger/customers/${id}`);
    const cust=await res.json();
    oldbalEl.value=cust.balance;
    oldbalEl.readOnly=true;oldbalEl.style.background='#f0f0f0';oldbalEl.style.color='#666';
    recalc();
  }catch(err){/* ignore — leave old balance as whatever was last typed */}
}
```

- [ ] **Step 5: Call `loadLedgerCustomers()` at page load, and reset the picker in `reset()`**

Replace:
```js
loadStockDatalist();
```
with:
```js
loadStockDatalist();
loadLedgerCustomers();
```

Replace:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-others','f-advance','f-oldbal'].forEach(function(id){document.getElementById(id).value='';});
```
with:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-others','f-advance','f-oldbal'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('f-customer').value='';
  document.getElementById('f-oldbal').readOnly=false;document.getElementById('f-oldbal').style.background='';document.getElementById('f-oldbal').style.color='';
```

- [ ] **Step 6: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
```

- [ ] **Step 7: Verify via Claude-in-Chrome**

Restart the dev server (same command as Task 4). Navigate to `http://localhost:3303/final-invoice-NS.html`. Confirm 5 cards render (Quotation, Invoice/Chitti, Delivery Challan, Stock, Ledger) and clicking "📒 Ledger" navigates to `ledger.html` showing the customer created in Task 3.

Click "🧾 Invoice / Chitti" → Continue. Confirm a "Ledger Customer" dropdown appears above "M/s. (Customer name)" with "— Walk-in, not tracked —" plus the test customer. Pick the test customer. Confirm the "Old Balance" field auto-fills with their current balance (whatever it is after Tasks 3–4's cumulative manual/invoice entries on this same scratch data) and turns read-only/greyed (matching `f-labour`'s existing readonly styling). Switch back to "— Walk-in, not tracked —" and confirm Old Balance becomes editable again (clears back to normal styling; value stays whatever was last set, matching the existing behavior of every other field in this form).

- [ ] **Step 8: Stop the dev server**

```bash
lsof -ti:3303 | xargs -r kill -9
```

- [ ] **Step 9: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
git commit -m "feat(narayani-steels): add Ledger nav card + Chitti customer picker with live Old Balance auto-fill"
```

---

### Task 6: "Record Invoice" button on the Chitti preview

**Files:**
- Modify: `final-invoice-NS.html` (project root)
- Copy: → `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: Task 2's `POST /api/ledger/invoices`; Task 5's `<select id="f-customer">`.
- Produces: global `let recordedInvoiceId` (null until a successful record; read by Phase 2's Send-via-WhatsApp button, which does not exist yet in this task).

- [ ] **Step 1: Confirm current baseline**

Run:
```bash
grep -n 'id="s4"\|btn-deduct\|function generate(\|function updateDeductButton' \
  "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Confirm against actual output before editing (line numbers will have shifted from Task 5's edits).

- [ ] **Step 2: Add the Record Invoice button and ledger-note element to `#s4`**

Replace:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" onclick="reset()">New</button></div>
    <div class="print-note" id="deduct-note" style="display:none"></div>
```
with:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" id="btn-record-invoice" onclick="recordInvoice()" style="display:none">💾 Record Invoice</button><button class="btn-s" onclick="reset()">New</button></div>
    <div class="print-note" id="deduct-note" style="display:none"></div>
    <div class="print-note" id="ledger-note" style="display:none"></div>
```

- [ ] **Step 3: Wire `generate()` to reset/update the Record Invoice button**

Replace:
```js
function generate(){
  rows.forEach(r=>{r._deducted=false;});
```
with:
```js
function generate(){
  rows.forEach(r=>{r._deducted=false;});
  recordedInvoiceId=null;
```

Replace:
```js
  document.getElementById('print-area').innerHTML=prh;go(4);updateDeductButton();
}
```
with:
```js
  document.getElementById('print-area').innerHTML=prh;go(4);updateDeductButton();updateRecordInvoiceButton();
}
```

- [ ] **Step 4: Add `recordedInvoiceId`, `updateRecordInvoiceButton()`, and `recordInvoice()`**

Replace:
```js
async function deductStock(){
```
with:
```js
let recordedInvoiceId=null;
function updateRecordInvoiceButton(){
  const btn=document.getElementById('btn-record-invoice');
  const custId=document.getElementById('f-customer').value;
  document.getElementById('ledger-note').style.display='none';
  if(dtype==='Invoice'&&custId){
    btn.style.display='inline-block';btn.disabled=false;btn.textContent='💾 Record Invoice';
  }else{
    btn.style.display='none';
  }
}
async function recordInvoice(){
  const btn=document.getElementById('btn-record-invoice'),note=document.getElementById('ledger-note');
  const custId=document.getElementById('f-customer').value;
  if(!custId||recordedInvoiceId)return;
  btn.disabled=true;
  let sub=0;rows.forEach(r=>{const q=parseFloat(r.q)||0,rt=parseFloat(r.r)||0;sub+=q*rt;});
  const lab=gc('f-labour'),weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const advance=gc('f-advance');
  const payload={
    customerId:custId,
    date:document.getElementById('f-date').value,
    mobile:document.getElementById('f-mobile').value,
    lorry:document.getElementById('f-lorry').value,
    items:rows.map(r=>({q:r.q,name:r.name,p:r.p,r:r.r})),
    sub,lab,weigh,freight,unload,gst,others,advance,
  };
  try{
    const res=await fetch('/api/ledger/invoices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await res.json();
    if(!res.ok)throw new Error(body.error||'Could not record invoice');
    recordedInvoiceId=body.id;
    btn.textContent=`✓ Recorded (Invoice #${body.invoiceNo})`;
    note.style.display='block';
    note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';
    note.textContent=`Recorded as Invoice #${body.invoiceNo} for ${body.customerName}.`;
  }catch(err){
    btn.disabled=false;
    note.style.display='block';
    note.style.background='#fef2f2';note.style.borderColor='#fecaca';note.style.color='#991b1b';
    note.textContent=`Error: ${err.message}`;
  }
}
async function deductStock(){
```

- [ ] **Step 5: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
```

- [ ] **Step 6: Verify via Claude-in-Chrome**

Restart the dev server (same command as prior tasks). Navigate to `http://localhost:3303/final-invoice-NS.html` → Invoice/Chitti → Continue. Pick the test customer from the dropdown. Add one item (Qty 500, Particulars "MS Angle", Rate 52). Fill Date/Mobile/Lorry with sample values. Click "Generate Document". On the preview screen, confirm a "💾 Record Invoice" button is visible. Click it. Confirm it becomes disabled reading "✓ Recorded (Invoice #N)" and a green note appears naming the customer and invoice number.

Confirm server-side via curl:
```bash
curl -s http://localhost:3303/api/ledger/customers | python3 -m json.tool
```
Expected: the test customer's `balance` increased by exactly `sub+lab+gst` for this new invoice (500×52=26000 sub, lab=`round(500/1000*400)`=200, gst=`round((26000+200)*0.18)`=4716 if GST checkbox was left unchecked it'll be 0 — check whichever state the checkbox was actually in during the click and confirm the delta matches that math exactly) — **not** including whatever Old Balance was displayed.

Go back to Edit, then Generate again without changing anything. Confirm the "Record Invoice" button resets to enabled or reflects the fresh `generate()` call correctly (per this task's design, each new Generate is eligible to record a new invoice — this is intentional, matching how a real invoice book issues a new number each time, unlike Stock's reprint-guard case). Do not click it again in this verification (avoid further mutating test data).

Confirm Quotation and Delivery Challan never show a "Record Invoice" button (same reasoning/verification as Stock's Deduct-button scope check — neither flow reaches `#s4` via the Chitti path).

- [ ] **Step 7: Stop the dev server**

```bash
lsof -ti:3303 | xargs -r kill -9
```

- [ ] **Step 8: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
git commit -m "feat(narayani-steels): add Record Invoice button — posts Chitti invoices to the customer ledger"
```

---

## Phase 2: WhatsApp invoice sending

**Do not start Phase 2 until Phase 1 (Tasks 1–6) is complete and verified** — Phase 2's send button only makes sense once `recordedInvoiceId` (Task 6) is populated.

### Task 7: `whatsapp-bot/` process scaffold + session pairing (manual)

**Files:**
- Create: `whatsapp-bot/package.json`
- Create: `whatsapp-bot/bot.js`
- Modify: `/Users/vanshjalan/.gitignore` (ignore the WhatsApp session directory)

**Interfaces:**
- Consumes: nothing from earlier tasks — this is a standalone process.
- Produces (used by Task 9): a running process listening on `127.0.0.1:5010` (or whichever port is confirmed free — check with `lsof -i :5010` before committing to it) exposing `POST /send-invoice` (request/response shape defined precisely in Task 9, once Task 8's PDF payload shape is known).

- [ ] **Step 1: Confirm port 5010 is free**

Run:
```bash
lsof -i :5010
```
Expected: no output (port free). If occupied, pick another free port in the 5000s and use it consistently through Tasks 7–9.

- [ ] **Step 2: Scaffold the bot project**

Create `whatsapp-bot/package.json`:
```json
{
  "name": "narayani-steels-whatsapp-bot",
  "version": "1.0.0",
  "private": true,
  "description": "Always-running WhatsApp sender for Narayani Steels invoices",
  "main": "bot.js",
  "scripts": {
    "start": "node bot.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "whatsapp-web.js": "^1.26.0",
    "qrcode-terminal": "^0.12.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Install:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot" && npm install
```
Expected: installs successfully, `node_modules/` created. This is the one dependency exception in this entire plan — note per Global Constraints that when this ships to the shop PC, `node_modules/` must be committed/copied the same way `app/node_modules/` already is (no internet on that machine), and `whatsapp-web.js` bundles its own headless Chromium via `puppeteer` — confirm the installed size is acceptable for the TeamViewer transfer before the eventual deployment session (not part of this plan's scope, flagged for that future session).

- [ ] **Step 3: Write `bot.js` with the startup-timestamp guard and outbound-only design**

Create `whatsapp-bot/bot.js`:

```js
'use strict';

const express = require('express');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const PORT = process.env.WHATSAPP_BOT_PORT || 5010;
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// Startup-timestamp guard: this bot only ever sends messages via the
// /send-invoice endpoint below — it never reads or reacts to incoming
// messages/chats at all, which sidesteps the historical-replay-on-reconnect
// class of bug entirely (real incident on another client's bot: a chat-bot
// without this guard auto-replied to months of old messages on first
// connect). Documented here rather than enforced in code because there is
// no incoming-message code path to guard in the first place.
const STARTED_AT = Date.now();

// Uses the system's installed Chrome rather than puppeteer's bundled
// Chromium download — avoids a second ~200MB browser download (and a flaky
// one at that; a stale puppeteer cache from another project's whatsapp-web.js
// setup broke the bundled download during implementation) and matches this
// project's existing pattern of driving the already-installed Chrome for
// headless rendering. Install with `PUPPETEER_SKIP_DOWNLOAD=true npm install`
// the first time, or add a `.npmrc` with `puppeteer_skip_download=true` in
// `whatsapp-bot/` so future installs (including the eventual shop PC one)
// don't need the env var repeated manually.
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: { headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

let ready = false;

client.on('qr', (qr) => {
  console.log('[WhatsApp] Scan this QR code with the dedicated business number:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  ready = true;
  console.log(`[WhatsApp] Client ready. Bot started at ${new Date(STARTED_AT).toISOString()}.`);
});

client.on('disconnected', (reason) => {
  ready = false;
  console.error(`[WhatsApp] Disconnected: ${reason}`);
});

client.initialize();

const app = express();
app.use(express.json({ limit: '20mb' })); // invoice PDFs are small but base64 inflates size ~33%

app.post('/send-invoice', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'WhatsApp client is not ready yet' });
  const { phone, pdfBase64, filename, message } = req.body || {};
  if (!phone || !/^\d+$/.test(phone)) return res.status(400).json({ error: 'A digits-only phone number is required' });
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' });
  try {
    const chatId = `${phone.replace(/^0+/, '')}@c.us`; // whatsapp-web.js chat id format
    const media = new MessageMedia('application/pdf', pdfBase64, filename || 'invoice.pdf');
    await client.sendMessage(chatId, media, { caption: message || '' });
    res.json({ sent: true });
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[WhatsApp] Bridge listening on http://127.0.0.1:${PORT}`);
});
```

- [ ] **Step 4: Add the session directory to `.gitignore`**

In `/Users/vanshjalan/.gitignore`, append after the Stock module's `app/data/` line:
```
Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot/.wwebjs_auth/
Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot/node_modules/
```
(The session directory contains live WhatsApp auth material — never commit it, no exceptions. `whatsapp-bot/node_modules/` is gitignored here independently of whatever `app/node_modules/`'s tracking state happens to be elsewhere in this repo — that's a separate, pre-existing situation outside this plan's scope, not something to reconcile here.)

- [ ] **Step 5: Manual verification — pair the session**

This step is inherently manual (a real QR scan), not scriptable:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot" && node bot.js
```
Expected: a QR code prints in the terminal. Scan it with the dedicated WhatsApp number's phone (WhatsApp → Linked Devices → Link a Device). Wait for `[WhatsApp] Client ready.` in the log. Leave running, then in a second terminal:
```bash
curl -s http://127.0.0.1:5010/send-invoice -X POST -H 'Content-Type: application/json' \
  -d '{"phone":"<a real test number you control>","pdfBase64":"","filename":"test.pdf"}'
```
Expected: `400 {"error":"pdfBase64 is required"}` — confirms the endpoint is reachable and validating correctly even before Task 8's real PDF exists. Stop the bot with Ctrl+C once confirmed; `.wwebjs_auth/` now holds a paired session that survives restarts (`node bot.js` again should skip the QR step and go straight to ready).

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot/package.json" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot/bot.js" \
  ".gitignore"
git commit -m "feat(narayani-steels): scaffold whatsapp-bot process with startup-guard-documented outbound-only sender"
```
Do not add `whatsapp-bot/node_modules/` or the `.wwebjs_auth/` session directory — Step 4's `.gitignore` entries exclude them. `whatsapp-bot/package-lock.json` should be added alongside `package.json` (locks the dependency versions, same as `app/package-lock.json`'s role):
```bash
cd /Users/vanshjalan && git add "Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot/package-lock.json"
```
Check `git status` before committing to confirm only the intended files are staged.

---

### Task 8: Server-side invoice PDF rendering

**Files:**
- Modify: `app/server.js`

**Interfaces:**
- Consumes: Task 2's `ledgerStore.getInvoice(id)`; the existing `final-invoice-NS.html` slip-rendering functions (`buildFirstSlip`, `colgroup`, `thead`, etc.) are **not** reused server-side — server-side rendering builds a simpler standalone HTML document from the stored invoice snapshot instead of trying to run the client-side print-template functions in Node (they're written for the DOM/browser, not headless reuse — reimplementing a small subset server-side is more robust than trying to share code across those two very different runtime contexts).
- Produces (used by Task 9): `GET /api/ledger/invoices/:id/pdf` → `200` with `Content-Type: application/pdf`, raw PDF bytes.

- [ ] **Step 1: Confirm headless Chrome is available on this machine**

Run:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```
Expected: prints a version string. (This is the dev machine only — note for the future shop-PC deployment session that Windows will need an equivalent headless Chrome/Edge invocation; out of scope here.)

- [ ] **Step 2: Add a PDF-rendering route to `server.js`**

Add after the existing `GET /api/ledger/invoices/:id` route:

```js
const { execFileSync } = require('child_process');
const os = require('os');

// `invoice` here must already include `customerName` (see the two call
// sites below, both of which merge it in the same way Task 2's
// `GET /api/ledger/invoices/:id` route does) — this function does not fetch
// the customer itself, to keep it a pure rendering function.
function renderInvoicePdf(invoice) {
  const itemRows = invoice.items
    .map((r) => {
      const q = parseFloat(r.q) || 0, rt = parseFloat(r.r) || 0, amt = q * rt;
      return `<tr><td>${r.name || ''}</td><td style="text-align:right">${r.q || ''}</td><td style="text-align:right">${r.r || ''}</td><td style="text-align:right">${amt ? Math.round(amt).toLocaleString('en-IN') : ''}</td></tr>`;
    })
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;padding:20mm;font-size:11pt;color:#111}
    h1{font-size:16pt}
    table{width:100%;border-collapse:collapse;margin-top:8mm}
    th,td{border:1px solid #ccc;padding:4px 8px;font-size:10pt}
    th{background:#f0f0f0;text-align:left}
    .tot{margin-top:6mm;font-weight:bold;font-size:12pt;text-align:right}
  </style></head><body>
    <h1>Narayani Steels — Invoice #${invoice.invoiceNo}</h1>
    <p>M/s. ${invoice.customerName}</p>
    <p>Date: ${invoice.date || '—'} &nbsp; Mobile: ${invoice.mobile || '—'} &nbsp; Lorry: ${invoice.lorry || '—'}</p>
    <table><thead><tr><th>Particulars</th><th>Qty (kg)</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="tot">Total: ₹${Math.round(invoice.total).toLocaleString('en-IN')}</div>
  </body></html>`;

  const tmpHtml = path.join(os.tmpdir(), `ns-invoice-${invoice.id}.html`);
  const tmpPdf = path.join(os.tmpdir(), `ns-invoice-${invoice.id}.pdf`);
  fs.writeFileSync(tmpHtml, html);
  execFileSync(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${tmpPdf}`, `file://${tmpHtml}`],
    { timeout: 15000 }
  );
  const pdfBuffer = fs.readFileSync(tmpPdf);
  fs.unlinkSync(tmpHtml);
  fs.unlinkSync(tmpPdf);
  return pdfBuffer;
}

app.get('/api/ledger/invoices/:id/pdf', (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    const pdfBuffer = renderInvoicePdf({ ...invoice, customerName: customer.name });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    sendLedgerError(res, err);
  }
});
```

**Note for whoever redeploys to the Windows shop PC (not this task, flagged for that session):** the hardcoded Chrome path is macOS-specific — Windows needs the equivalent `chrome.exe` path or a `CHROME_PATH` env var, matching the same platform-specific-path pattern already accepted in `_getMachineId()`'s `wmic` call.

- [ ] **Step 3: Manual verification**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3303 STOCK_DATA_PATH=/tmp/ns-ledger-manual/stock.json LEDGER_DATA_PATH=/tmp/ns-ledger-manual/ledger.json \
  node server.js > /tmp/ns-ledger-dev-server.log 2>&1 &
sleep 1
INV_ID=$(curl -s http://localhost:3303/api/ledger/customers/$(curl -s http://localhost:3303/api/ledger/customers | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")/entries | python3 -c "import json,sys; e=json.load(sys.stdin); print([x for x in e if x['reason']=='invoice'][0]['invoiceId'])")
curl -s -o /tmp/ns-test-invoice.pdf http://localhost:3303/api/ledger/invoices/$INV_ID/pdf
file /tmp/ns-test-invoice.pdf
```
Expected: `/tmp/ns-test-invoice.pdf: PDF document, version 1.x` (or similar `file` output confirming a real PDF, not an error page). Read it with the Read tool to visually confirm it shows the invoice number, customer name, items, and total.

```bash
lsof -ti:3303 | xargs -r kill -9
```

- [ ] **Step 4: Commit**

```bash
cd /Users/vanshjalan && git add "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.js"
git commit -m "feat(narayani-steels): add server-side invoice PDF rendering endpoint"
```

---

### Task 9: "Send via WhatsApp" button + end-to-end wiring

**Files:**
- Modify: `app/server.js` (bridge endpoint to the bot process)
- Modify: `final-invoice-NS.html` (project root)
- Copy: → `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: Task 6's `recordedInvoiceId`; Task 7's bot process `POST http://127.0.0.1:5010/send-invoice`; Task 8's `GET /api/ledger/invoices/:id/pdf`.
- Produces: nothing consumed by later tasks — final task in this plan.

- [ ] **Step 1: Add a bridge route on the billing server**

The Chitti page calls the billing server (not the bot process directly — keeps the bot's port off the public-facing side entirely, matching Aaral's decoupled shape). Add to `app/server.js`, after the PDF route from Task 8:

```js
app.post('/api/ledger/invoices/:id/send-whatsapp', async (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    const pdfBuffer = renderInvoicePdf({ ...invoice, customerName: customer.name });
    const botPort = process.env.WHATSAPP_BOT_PORT || 5010;
    const botRes = await fetch(`http://127.0.0.1:${botPort}/send-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        phone: customer.phone,
        pdfBase64: pdfBuffer.toString('base64'),
        filename: `Invoice-${invoice.invoiceNo}.pdf`,
        message: `Invoice #${invoice.invoiceNo} from Narayani Steels — Total ₹${Math.round(invoice.total).toLocaleString('en-IN')}`,
      }),
    });
    const botBody = await botRes.json();
    if (!botRes.ok) throw new Error(botBody.error || 'WhatsApp bot rejected the send');
    res.json({ sent: true });
  } catch (err) {
    // Node's fetch wraps connection failures in a TypeError whose real code
    // lives on `.cause`, not on the error itself — checking `err.code` alone
    // would never match and this branch would silently never fire.
    const isTimeoutOrUnreachable =
      err.name === 'TimeoutError' || err.code === 'ECONNREFUSED' || (err.cause && err.cause.code === 'ECONNREFUSED');
    res.status(isTimeoutOrUnreachable ? 503 : 400).json({
      error: isTimeoutOrUnreachable ? 'WhatsApp bot is not reachable — is it running?' : err.message,
    });
  }
});
```

- [ ] **Step 2: Add the Send via WhatsApp button**

Replace:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" id="btn-record-invoice" onclick="recordInvoice()" style="display:none">💾 Record Invoice</button><button class="btn-s" onclick="reset()">New</button></div>
```
with:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" id="btn-record-invoice" onclick="recordInvoice()" style="display:none">💾 Record Invoice</button><button class="btn-s" id="btn-send-whatsapp" onclick="sendWhatsapp()" style="display:none">📱 Send via WhatsApp</button><button class="btn-s" onclick="reset()">New</button></div>
```

- [ ] **Step 3: Show the button once an invoice is recorded, add `sendWhatsapp()`**

Replace:
```js
    recordedInvoiceId=body.id;
    btn.textContent=`✓ Recorded (Invoice #${body.invoiceNo})`;
    note.style.display='block';
    note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';
    note.textContent=`Recorded as Invoice #${body.invoiceNo} for ${body.customerName}.`;
```
with:
```js
    recordedInvoiceId=body.id;
    btn.textContent=`✓ Recorded (Invoice #${body.invoiceNo})`;
    note.style.display='block';
    note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';
    note.textContent=`Recorded as Invoice #${body.invoiceNo} for ${body.customerName}.`;
    const waBtn=document.getElementById('btn-send-whatsapp');
    waBtn.style.display='inline-block';waBtn.disabled=false;waBtn.textContent='📱 Send via WhatsApp';
```

Replace:
```js
async function deductStock(){
```
with:
```js
async function sendWhatsapp(){
  if(!recordedInvoiceId)return;
  const btn=document.getElementById('btn-send-whatsapp'),note=document.getElementById('ledger-note');
  btn.disabled=true;
  try{
    const res=await fetch(`/api/ledger/invoices/${recordedInvoiceId}/send-whatsapp`,{method:'POST'});
    const body=await res.json();
    if(!res.ok)throw new Error(body.error||'Send failed');
    btn.textContent='✓ Sent';
    note.style.display='block';
    note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';
    note.textContent='Invoice sent via WhatsApp.';
  }catch(err){
    btn.disabled=false;
    note.style.display='block';
    note.style.background='#fef2f2';note.style.borderColor='#fecaca';note.style.color='#991b1b';
    note.textContent=`WhatsApp send error: ${err.message}`;
  }
}
async function deductStock(){
```

- [ ] **Step 4: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
```

- [ ] **Step 5: Manual end-to-end verification (real WhatsApp send)**

This step sends a real WhatsApp message and must be run manually, not scripted:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /whatsapp-bot" && node bot.js &
sleep 3
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3303 STOCK_DATA_PATH=/tmp/ns-ledger-manual/stock.json LEDGER_DATA_PATH=/tmp/ns-ledger-manual/ledger.json \
  node server.js > /tmp/ns-ledger-dev-server.log 2>&1 &
sleep 1
```

Using Claude-in-Chrome: navigate to `http://localhost:3303/final-invoice-NS.html`, generate and Record an invoice for a test customer **whose phone number is a real number you control** (not the earlier `9876543210` placeholder — use your own number so you can confirm receipt). Click "📱 Send via WhatsApp". Confirm the button reads "✓ Sent" and check the actual WhatsApp app on the receiving number for the PDF with the correct invoice number and total.

Then confirm the unreachable-bot error path: stop the bot process (`Ctrl+C` or `pkill -f "whatsapp-bot/bot.js"`), generate+record a second test invoice, click Send, and confirm a clear "WhatsApp bot is not reachable — is it running?" error appears rather than a silent failure or hang.

- [ ] **Step 6: Stop all dev processes**

```bash
lsof -ti:3303 | xargs -r kill -9
pkill -f "whatsapp-bot/bot.js" 2>/dev/null
```

- [ ] **Step 7: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
git commit -m "feat(narayani-steels): add Send via WhatsApp button, wired end-to-end through the bot bridge"
```

---

## 2026-07-17 update — Tasks 6, 8, 9 built differently than originally planned above

Real live testing with the WhatsApp bot connected (Vansh, mid-implementation)
changed the design for Tasks 6/8/9 from what's written above. The tasks
above are kept for the historical record of the original plan; this is
what was actually built and shipped:

- **Task 6's "Record Invoice" button and Task 9's "Send via WhatsApp"
  button are merged into one** — `btn-record-invoice`, labelled
  "✅ Finalize & Send". `recordInvoice()` in `final-invoice-NS.html` now:
  records the invoice (unless `recordedInvoiceId` is already set from a
  prior successful record), then always attempts the WhatsApp send. On a
  send-only failure the button becomes "🔄 Retry Send" and a second click
  retries just the send — the record step is skipped since
  `recordedInvoiceId` is already populated, so it can never double-record.
  The `recordInvoice()` payload now also includes `oldbal` (read from
  `f-oldbal`), which Task 6's original payload omitted.
- **`ledgerStore.createInvoice` now accepts and stores `oldbal`** (Task 1's
  store gets this addition retroactively) alongside the already-stored
  `advance` — both are display-only fields on the invoice record and never
  enter `total`, preserving the double-counting invariant. New test:
  `createInvoice stores oldbal/advance for display but never lets them
  affect total or the due amount`.
- **Task 8's `renderInvoicePdf` is a faithful single-A6-copy replica of the
  real Chitti slip**, not the simplified generic table originally
  specified. It re-implements `colgroup`/`thead`/`tableRows`/`emptyRows`/
  `totalsBlock`/`buildFirstSlip`/`buildContSlip` server-side (prefixed
  `pdf*` to avoid confusion with the client-side originals), using the
  exact same `.doc`/`.d-tbl`/etc. CSS, at A6 page size
  (`@page{size:105mm 148.5mm}`) with no A5 dual-copy wrapping and no tear
  line — one copy, since a WhatsApp PDF isn't torn in half like the
  physical print. The pre-existing "always says QUOTATION" bug is
  deliberately replicated for parity with what's already printed, not
  fixed (out of scope, not asked for).
- **`whatsapp-bot/bot.js`'s `/send-invoice` handler had a real bug**,
  caught on the first live send attempt: building the chat id as
  `${phone}@c.us` by hand failed with `Error: No LID for user` against
  `whatsapp-web.js` v1.34.7's current multi-device/LID identity handling.
  Fixed by resolving the number via `client.getNumberId(phone)` first and
  sending to the returned `._serialized` id (also now returns a clean 400
  if the number isn't a registered WhatsApp number, instead of the
  library's raw error).
- **`whatsapp-bot`'s puppeteer setup uses the system Chrome**
  (`executablePath`, `CHROME_PATH` env var same as `server.js`'s PDF
  renderer) rather than puppeteer's bundled Chromium download — a stale
  puppeteer cache from another project broke that download during `npm
  install` here. A `.npmrc` with `puppeteer_skip_download=true` in
  `whatsapp-bot/` makes this permanent for future installs (including the
  eventual shop-PC one).
- **Operational note for future sessions**: killing the bot process with
  `kill -9` on the parent Node PID does **not** kill the Chrome process
  tree puppeteer spawned under it — those orphaned Chrome processes keep
  holding a lock on `.wwebjs_auth/session`, so a plain restart fails with
  `The browser is already running for <userDataDir>`. Use
  `pkill -9 -f "whatsapp-bot/.wwebjs_auth/session"` to clean up the whole
  tree before restarting, not just killing the node process.
- Live end-to-end verification (real WhatsApp send, real recipient) was
  done against Vansh's own test customer during this session rather than
  the plan's originally-scripted manual steps — same outcome, confirmed
  working.

## Deferred (not in this plan)

- **Shop PC deployment of either phase** — a separate live TeamViewer session per this project's established delivery pattern, same as the Stock module. Phase 2 additionally needs: the WhatsApp session paired on the actual shop PC (a fresh QR scan there, the dev-machine pairing from Task 7 does not transfer), a Windows-appropriate headless Chrome path for Task 8's PDF rendering, and confirming `whatsapp-bot/node_modules` (including bundled Chromium) fits the same "ship node_modules, no internet" constraint that shaped every dependency decision in this project so far.
- **Reprint-as-pixel-perfect-slip on `invoice.html`** — explicitly out of scope per the spec's Non-goals; the current plain-table view is the shipped version unless Vansh asks for the carbonless-slip layout specifically.
