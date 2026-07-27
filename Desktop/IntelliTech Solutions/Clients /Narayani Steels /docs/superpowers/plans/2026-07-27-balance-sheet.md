# Daily Balance Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Narayani Steels' handwritten daily cash/bank balance sheet with a digital module in the existing billing tool: a JSON-backed store, two API routes, and a printable A4 page with auto-carried opening balance.

**Architecture:** A new `balanceSheetStore.js` module (mirrors `stockStore.js`'s pattern exactly: atomic JSON file, serialized in-memory access) backs two new Express routes on the existing `server.js`. A new self-contained `public/balance-sheet.html` (no build step, matches `stock.html`/`reports.html` conventions) renders the 4-square entry UI and a print stylesheet. Linked from a 7th card on the main billing page and cross-linked in Stock/Reports headers.

**Tech Stack:** Plain Node.js (`fs`, no new dependencies), Express (already a dependency), `node --test` for unit tests, vanilla HTML/CSS/JS for the page (matches every other page in this app — no framework, no build step).

## Global Constraints

- No new npm dependencies — this app ships `node_modules` pre-committed for a Windows shop PC with no internet; anything native/prebuilt is a deployment risk (see `2026-07-17-stock-inventory-design.md`'s own rejected-alternatives note).
- Follow `stockStore.js`'s exact file-access pattern: `ensureLoaded()` → `load()`/`save()` with atomic tmp-file + `fs.renameSync`, plain functions returned from `createStore(filePath)`, no classes.
- Row validation happens server-side, matching the project-wide "fail fast, don't trust client input" convention already used in `stockStore.updateItem`/`addItem`.
- `app/data/` is already gitignored wholesale via `.gitignore`'s `Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/` entry — **no `.gitignore` change is needed**, `balance-sheet.json` is covered automatically.
- Date keys are plain `YYYY-MM-DD` strings, never `Date` objects, in the store and over the wire — this project's existing `stockStore.getReport` uses real `Date` math because it needs week/month boundaries; this feature only ever needs day-level chronological ordering, which plain ISO date strings already give for free via lexicographic comparison. Don't introduce `Date` parsing where a string comparison suffices.
- All new/modified files stay under this project's established size norms — `balanceSheetStore.js` and `balance-sheet.html` are each single-purpose, single-responsibility files, matching `stockStore.js`/`stock.html`.

---

### Task 1: `balanceSheetStore.js` — data module and tests

**Files:**
- Create: `app/balanceSheetStore.js`
- Create: `app/balanceSheetStore.test.js`

**Interfaces:**
- Produces: `createStore(filePath)` returning `{ init(), getDay(date), saveDay(date, { cashIn, bankIn, expenses, bankOut }) }`.
  - `getDay(date: string) -> { date, cashIn, bankIn, expenses, bankOut, cashTotal, expensesTotal, cashSubtotal, bankInTotal, bankOutTotal, bankSubtotal, closingBalance }`
  - `saveDay(date: string, rows: { cashIn: {label,amount}[], bankIn: {label,amount}[], expenses: {label,amount}[], bankOut: {label,amount}[] }) -> same shape as getDay`
  - Both throw `Error` with a human-readable `.message` on invalid input (consumed by Task 2's route handlers via `err.message`).

- [ ] **Step 1: Write the failing test file**

Create `app/balanceSheetStore.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./balanceSheetStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-balance-sheet-'));
  return path.join(dir, 'balance-sheet.json');
}

test('getDay on a date with no saved history returns opening 0 and empty arrays', () => {
  const store = createStore(tempFile());
  const day = store.getDay('2026-07-01');
  assert.equal(day.cashIn.length, 1);
  assert.equal(day.cashIn[0].label, 'Opening Balance');
  assert.equal(day.cashIn[0].amount, 0);
  assert.deepEqual(day.bankIn, []);
  assert.deepEqual(day.expenses, []);
  assert.deepEqual(day.bankOut, []);
  assert.equal(day.closingBalance, 0);
});

test('saveDay computes cashSubtotal, bankSubtotal, and closingBalance correctly', () => {
  const store = createStore(tempFile());
  const saved = store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }, { label: 'Ashok', amount: 500 }],
    bankIn: [{ label: 'Narsingh Steel', amount: 2000 }],
    expenses: [{ label: 'Coal', amount: 300 }],
    bankOut: [{ label: 'Supplier payment', amount: 1200 }],
  });
  assert.equal(saved.cashTotal, 1500);
  assert.equal(saved.expensesTotal, 300);
  assert.equal(saved.cashSubtotal, 1200); // 1500 - 300
  assert.equal(saved.bankInTotal, 2000);
  assert.equal(saved.bankOutTotal, 1200);
  assert.equal(saved.bankSubtotal, 800); // 2000 - 1200
  assert.equal(saved.closingBalance, 2000); // 1200 + 800
});

test('saveDay persists rows; a fresh store instance reloading from disk returns the same data', () => {
  const file = tempFile();
  const store = createStore(file);
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [{ label: 'Coal', amount: 300 }],
    bankOut: [],
  });

  const reloaded = createStore(file);
  const day = reloaded.getDay('2026-07-01');
  assert.equal(day.cashIn[0].amount, 1000);
  assert.equal(day.expenses[0].label, 'Coal');
  assert.equal(day.closingBalance, 700);
});

test('opening balance carries forward from the most recent earlier saved date', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 1000

  const nextDay = store.getDay('2026-07-02');
  assert.equal(nextDay.cashIn[0].amount, 1000);
});

test('opening balance carries forward across a gap day that has no saved record at all', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 500 }],
    bankIn: [{ label: 'Deposit', amount: 200 }],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 700
  // 2026-07-02 is never saved.
  const dayAfterGap = store.getDay('2026-07-03');
  assert.equal(dayAfterGap.cashIn[0].amount, 700);
});

test('editing a past day changes a later unsaved day\'s derived opening on next read', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 1000
  assert.equal(store.getDay('2026-07-02').cashIn[0].amount, 1000);

  // Re-save 2026-07-01 with a corrected higher opening balance.
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 5000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 5000
  assert.equal(store.getDay('2026-07-02').cashIn[0].amount, 5000);
});

test('saveDay rejects a blank label, a negative amount, and a non-numeric amount', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: '  ', amount: 100 }], bankIn: [], expenses: [], bankOut: [] }),
    /non-blank label/
  );
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: 'Opening Balance', amount: -5 }], bankIn: [], expenses: [], bankOut: [] }),
    /amount must be a number/
  );
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: 'Opening Balance', amount: 'abc' }], bankIn: [], expenses: [], bankOut: [] }),
    /amount must be a number/
  );
});

test('saveDay rejects an empty cashIn array', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [], bankIn: [], expenses: [], bankOut: [] }),
    /at least the Opening Balance row/
  );
});

test('saveDay forces cashIn[0]\'s label to "Opening Balance" regardless of what the client sends', () => {
  const store = createStore(tempFile());
  const saved = store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Whatever the client sent', amount: 250 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  });
  assert.equal(saved.cashIn[0].label, 'Opening Balance');
  assert.equal(saved.cashIn[0].amount, 250);
});

test('getDay and saveDay reject a malformed date key', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.getDay('07-01-2026'), /YYYY-MM-DD/);
  assert.throws(
    () => store.saveDay('not-a-date', { cashIn: [{ label: 'Opening Balance', amount: 0 }], bankIn: [], expenses: [], bankOut: [] }),
    /YYYY-MM-DD/
  );
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd "app" && node --test balanceSheetStore.test.js`
Expected: FAIL — `Cannot find module './balanceSheetStore'`

- [ ] **Step 3: Write the implementation**

Create `app/balanceSheetStore.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateKey(date) {
  if (typeof date !== 'string' || !DATE_KEY_RE.test(date)) {
    throw new Error('Date must be in YYYY-MM-DD format');
  }
}

function validateRows(rows, arrName) {
  if (!Array.isArray(rows)) throw new Error(`${arrName} must be an array`);
  return rows.map((r) => {
    const label = ((r && r.label) || '').trim();
    if (!label) throw new Error(`Each ${arrName} row needs a non-blank label`);
    const amount = Number(r && r.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Each ${arrName} row's amount must be a number \u2265 0`);
    }
    return { label, amount };
  });
}

function sum(rows) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

function computeSummary(date, rows) {
  const cashTotal = sum(rows.cashIn);
  const expensesTotal = sum(rows.expenses);
  const cashSubtotal = cashTotal - expensesTotal;
  const bankInTotal = sum(rows.bankIn);
  const bankOutTotal = sum(rows.bankOut);
  const bankSubtotal = bankInTotal - bankOutTotal;
  const closingBalance = cashSubtotal + bankSubtotal;
  return {
    date,
    cashIn: rows.cashIn,
    bankIn: rows.bankIn,
    expenses: rows.expenses,
    bankOut: rows.bankOut,
    cashTotal,
    expensesTotal,
    cashSubtotal,
    bankInTotal,
    bankOutTotal,
    bankSubtotal,
    closingBalance,
  };
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
        throw new Error(`balance-sheet.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
      data = { days: {} };
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

  // The closing balance of the most recent EARLIER date that has a saved
  // record — computed fresh from whatever is on disk right now, never
  // cached. This is what makes editing a past day automatically correct
  // every later day's opening the next time it's viewed: there is no
  // stored "opening" value to go stale, only this live derivation.
  function deriveOpening(date) {
    const priorDates = Object.keys(data.days)
      .filter((d) => d < date)
      .sort();
    if (priorDates.length === 0) return 0;
    const lastDate = priorDates[priorDates.length - 1];
    return computeSummary(lastDate, data.days[lastDate]).closingBalance;
  }

  function getDay(date) {
    ensureLoaded();
    validateDateKey(date);
    const saved = data.days[date];
    if (saved) return computeSummary(date, saved);
    const opening = deriveOpening(date);
    return computeSummary(date, {
      cashIn: [{ label: 'Opening Balance', amount: opening }],
      bankIn: [],
      expenses: [],
      bankOut: [],
    });
  }

  function saveDay(date, { cashIn, bankIn, expenses, bankOut } = {}) {
    ensureLoaded();
    validateDateKey(date);
    const validCashIn = validateRows(cashIn, 'cashIn');
    if (validCashIn.length === 0) throw new Error('cashIn must include at least the Opening Balance row');
    // cashIn[0] is a reserved position, not identified by label text — its
    // label is always forced to the canonical value server-side so the UI
    // never has to trust (or re-send correctly) what the client displayed.
    validCashIn[0] = { ...validCashIn[0], label: 'Opening Balance' };
    const validBankIn = validateRows(bankIn, 'bankIn');
    const validExpenses = validateRows(expenses, 'expenses');
    const validBankOut = validateRows(bankOut, 'bankOut');

    data.days[date] = { cashIn: validCashIn, bankIn: validBankIn, expenses: validExpenses, bankOut: validBankOut };
    save();
    return computeSummary(date, data.days[date]);
  }

  return { init, getDay, saveDay };
}

module.exports = { createStore };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "app" && node --test balanceSheetStore.test.js`
Expected: `pass 10`, `fail 0`

- [ ] **Step 5: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
git add app/balanceSheetStore.js app/balanceSheetStore.test.js
git commit -m "feat(narayani-steels): add balanceSheetStore with opening-balance carry-forward"
```

---

### Task 2: API routes on `server.js`

**Files:**
- Modify: `app/server.js`

**Interfaces:**
- Consumes: `createStore` from `./balanceSheetStore` (Task 1) — `{ init(), getDay(date), saveDay(date, rows) }`.
- Produces: `GET /api/balance-sheet/:date` and `PUT /api/balance-sheet/:date`, consumed by Task 3's page.

- [ ] **Step 1: Add the store wiring, right after the existing ledger store wiring**

In `app/server.js`, find this block (existing lines 10-11 and 38-58):

```js
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');
```

Change to:

```js
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');
const { createStore: createBalanceSheetStore } = require('./balanceSheetStore');
```

Then find the ledger store block:

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

Add immediately after it:

```js
const BALANCE_SHEET_DATA_PATH = process.env.BALANCE_SHEET_DATA_PATH || path.join(__dirname, 'data', 'balance-sheet.json');
const balanceSheetStore = createBalanceSheetStore(BALANCE_SHEET_DATA_PATH);
let _balanceSheetInitError = null;
try {
  balanceSheetStore.init();
} catch (err) {
  _balanceSheetInitError = err;
  console.error(`[BalanceSheet] Failed to load balance sheet data: ${err.message}`);
}

function sendBalanceSheetError(res, err) {
  res.status(400).json({ error: err.message });
}

// Guards every /api/balance-sheet/* route — same reasoning as requireStock
// and requireLedger: a corrupted balance-sheet.json must not take down
// billing, Stock, or Ledger.
function requireBalanceSheet(req, res, next) {
  if (_balanceSheetInitError) return res.status(500).json({ error: 'Balance sheet data is unavailable — see server logs.' });
  next();
}
```

- [ ] **Step 2: Add the two routes, right after the existing ledger routes and before the invoice PDF section**

Find this line in `app/server.js`:

```js
// ─── Invoice PDF rendering (single A6 copy, mirrors the real Chitti slip) ─────
```

Insert immediately before it:

```js
app.use('/api/balance-sheet', requireBalanceSheet);

app.get('/api/balance-sheet/:date', (req, res) => {
  try {
    res.json(balanceSheetStore.getDay(req.params.date));
  } catch (err) {
    sendBalanceSheetError(res, err);
  }
});

app.put('/api/balance-sheet/:date', (req, res) => {
  try {
    res.json(balanceSheetStore.saveDay(req.params.date, req.body || {}));
  } catch (err) {
    sendBalanceSheetError(res, err);
  }
});

```

- [ ] **Step 3: Verify the server still starts and the syntax is valid**

Run: `cd "app" && node --check server.js`
Expected: no output (exit code 0)

- [ ] **Step 4: Start the server and smoke-test both routes with curl**

Run this as a single command block (starts the server, tests it, and kills it by captured PID — do not rely on shell job control like `%1` across separate command invocations, since background job state does not persist between tool calls):

```bash
cd "app"
PORT=3399 node server.js &
SERVER_PID=$!
sleep 1

curl -s http://127.0.0.1:3399/api/balance-sheet/2026-07-27
echo
curl -s -X PUT http://127.0.0.1:3399/api/balance-sheet/2026-07-27 \
  -H 'Content-Type: application/json' \
  -d '{"cashIn":[{"label":"Opening Balance","amount":1000}],"bankIn":[],"expenses":[{"label":"Coal","amount":300}],"bankOut":[]}'
echo
curl -s http://127.0.0.1:3399/api/balance-sheet/2026-07-28
echo

kill "$SERVER_PID"
rm -f data/balance-sheet.json data/balance-sheet.json.tmp
```

Expected output, in order:
1. `{"date":"2026-07-27","cashIn":[{"label":"Opening Balance","amount":0}],"bankIn":[],"expenses":[],"bankOut":[],"cashTotal":0,"expensesTotal":0,"cashSubtotal":0,"bankInTotal":0,"bankOutTotal":0,"bankSubtotal":0,"closingBalance":0}`
2. A response containing `"closingBalance":700`
3. A response containing `"cashIn":[{"label":"Opening Balance","amount":700}]` — confirms carry-forward works through the real HTTP layer, not just the store's unit tests.

The final `rm -f` deletes the test data file created by this smoke test so it doesn't linger in the dev checkout.

- [ ] **Step 5: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
git add app/server.js
git commit -m "feat(narayani-steels): add /api/balance-sheet routes"
```

---

### Task 3: `balance-sheet.html` page

**Files:**
- Create: `app/public/balance-sheet.html`

**Interfaces:**
- Consumes: `GET /api/balance-sheet/:date` and `PUT /api/balance-sheet/:date` (Task 2) — request/response shapes as defined in Task 1's `computeSummary` output.

- [ ] **Step 1: Create the page**

Create `app/public/balance-sheet.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels — Balance Sheet</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f4f4f0;min-height:100vh;padding:1.5rem 1rem}
.wrap{max-width:900px;margin:0 auto}
.back-link{display:inline-block;font-size:13px;color:#888;text-decoration:none;margin-bottom:10px}
.back-link:hover{color:#c45c00}
.app-title{font-size:20px;font-weight:600;color:#c45c00;margin-bottom:4px;text-align:center}
.app-sub{font-size:13px;color:#888;text-align:center;margin-bottom:1.25rem}
.card{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.nav-row{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:4px}
.nav-btn{background:#fff;border:1.5px solid #e2e2e2;border-radius:8px;width:34px;height:34px;font-size:16px;cursor:pointer;color:#333}
.nav-btn:hover{border-color:#c45c00;color:#c45c00}
.today-btn{display:block;margin:6px auto 0;background:none;border:none;color:#c45c00;font-size:12px;cursor:pointer;text-decoration:underline}

.bs-sheet{background:#fff;border:1px solid #e2e2e2;border-radius:12px;padding:1.5rem}
.bs-shri{text-align:center;font-size:22px;font-weight:700;color:#111;font-family:'Noto Sans Devanagari','Nirmala UI',sans-serif;margin-bottom:8px}
.bs-rule{border:none;border-top:2px solid #111;margin:0}
.bs-rule.thin{border-top:1px solid #111}
.bs-titlerow{display:flex;justify-content:space-between;align-items:baseline;padding:10px 2px;font-size:15px}
.bs-hindi{font-weight:700;font-family:'Noto Sans Devanagari','Nirmala UI',sans-serif;font-size:17px}
.bs-date{font-weight:600}

.bs-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:6px;border:1.5px solid #111}
.bs-square{border:1px solid #111;padding:10px 12px;min-height:160px}
.bs-square h4{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#c45c00;margin-bottom:8px}
.bs-row{display:flex;gap:6px;margin-bottom:5px;align-items:center}
.bs-row input.lbl{flex:1;border:none;border-bottom:1px solid #ddd;padding:3px 2px;font-size:13.5px;font-family:inherit}
.bs-row input.amt{width:100px;border:none;border-bottom:1px solid #ddd;padding:3px 2px;font-size:13.5px;text-align:right;font-family:inherit}
.bs-row input:focus{outline:none;border-bottom-color:#c45c00}
.bs-row .del{background:none;border:none;color:#bbb;cursor:pointer;font-size:15px;padding:0 4px;line-height:1}
.bs-row .del:hover{color:#dc2626}
.bs-row.locked input.lbl{color:#111;font-weight:600}
.bs-addrow{background:none;border:1px dashed #ccc;border-radius:6px;color:#888;font-size:12px;padding:4px 8px;cursor:pointer;margin-top:2px}
.bs-addrow:hover{border-color:#c45c00;color:#c45c00}
.bs-subtotal{display:flex;justify-content:space-between;font-weight:700;font-size:13.5px;border-top:1px solid #111;margin-top:8px;padding-top:6px}

.bs-totals{display:flex;justify-content:flex-end;gap:22px;margin-top:14px;padding-top:12px;border-top:2px solid #111;font-size:14px}
.bs-totals .t-lbl{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.bs-totals .t-val{font-weight:700;font-size:16px}
.bs-totals .closing .t-val{color:#c45c00;font-size:20px}

.bs-actions{display:flex;justify-content:center;gap:10px;margin-top:16px}
.btn{background:#c45c00;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#a94d00}
.btn.secondary{background:#fff;color:#c45c00;border:1.5px solid #c45c00}
.save-note{text-align:center;font-size:12px;color:#16a34a;margin-top:8px;height:16px}

@media print{
  @page{size:A4 portrait;margin:12mm}
  body{background:#fff;padding:0}
  .no-print{display:none!important}
  .wrap{max-width:none}
  .bs-sheet{border:none;padding:0;border-radius:0}
  .bs-row input{border:none!important}
}
</style>
</head>
<body>
<div class="wrap">
  <div class="no-print" style="display:flex;justify-content:space-between">
    <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
    <a class="back-link" href="reports.html">📊 Reports →</a>
  </div>
  <div class="app-title no-print">🧮 Narayani Steels — Balance Sheet</div>
  <div class="app-sub no-print">Daily cash &amp; bank position — replaces the handwritten sheet</div>

  <div class="card no-print">
    <div class="nav-row">
      <button class="nav-btn" onclick="navDay(-1)">‹</button>
      <div style="font-weight:600;min-width:200px;text-align:center" id="period-label">—</div>
      <button class="nav-btn" onclick="navDay(1)">›</button>
    </div>
    <button class="today-btn" onclick="jumpToToday()">Jump to today</button>
  </div>

  <div class="bs-sheet" id="bs-sheet">
    <div class="bs-shri">श्री</div>
    <hr class="bs-rule">
    <div class="bs-titlerow">
      <div class="bs-hindi">श्री रानी सती दादी</div>
      <div class="bs-date" id="bs-date-display">—</div>
    </div>
    <hr class="bs-rule thin">

    <div class="bs-grid">
      <div class="bs-square"><h4>Cash In</h4>
        <div class="bs-rows" id="rows-cashIn"></div>
        <button class="bs-addrow no-print" onclick="addRow('cashIn')">+ Add row</button>
        <div class="bs-subtotal"><span>Cash Total</span><span id="sub-cashIn">0</span></div>
      </div>
      <div class="bs-square"><h4>Expenses</h4>
        <div class="bs-rows" id="rows-expenses"></div>
        <button class="bs-addrow no-print" onclick="addRow('expenses')">+ Add row</button>
        <div class="bs-subtotal"><span>Expenses Total</span><span id="sub-expenses">0</span></div>
      </div>
      <div class="bs-square"><h4>Bank In</h4>
        <div class="bs-rows" id="rows-bankIn"></div>
        <button class="bs-addrow no-print" onclick="addRow('bankIn')">+ Add row</button>
        <div class="bs-subtotal"><span>Bank In Total</span><span id="sub-bankIn">0</span></div>
      </div>
      <div class="bs-square"><h4>Bank Out</h4>
        <div class="bs-rows" id="rows-bankOut"></div>
        <button class="bs-addrow no-print" onclick="addRow('bankOut')">+ Add row</button>
        <div class="bs-subtotal"><span>Bank Out Total</span><span id="sub-bankOut">0</span></div>
      </div>
    </div>

    <div class="bs-totals">
      <div><div class="t-lbl">Cash Subtotal</div><div class="t-val" id="tot-cash">0</div></div>
      <div><div class="t-lbl">Bank Subtotal</div><div class="t-val" id="tot-bank">0</div></div>
      <div class="closing"><div class="t-lbl">Closing Balance</div><div class="t-val" id="tot-closing">0</div></div>
    </div>
  </div>

  <div class="no-print bs-actions">
    <button class="btn" onclick="saveDay()">Save</button>
    <button class="btn secondary" onclick="window.print()">Print</button>
  </div>
  <div class="no-print save-note" id="save-note"></div>
</div>

<script>
const API = '/api/balance-sheet';
const SQUARES = ['cashIn', 'bankIn', 'expenses', 'bankOut'];
let currentDate = new Date();
let current = null;

function dateKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmt(n) {
  return Math.round(n).toLocaleString('en-IN');
}
function fmtHeaderDate(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function navDay(dir) {
  const d = new Date(currentDate);
  d.setDate(d.getDate() + dir);
  currentDate = d;
  loadDay();
}
function jumpToToday() {
  currentDate = new Date();
  loadDay();
}

function renderRows(square) {
  const container = document.getElementById(`rows-${square}`);
  container.innerHTML = current[square]
    .map((r, i) => {
      const locked = square === 'cashIn' && i === 0;
      return `<div class="bs-row${locked ? ' locked' : ''}">
        <input class="lbl" value="${escapeAttr(r.label)}" ${locked ? 'readonly' : ''} oninput="onRowInput('${square}',${i},'label',this.value)">
        <input class="amt" type="number" min="0" step="1" value="${r.amount}" oninput="onRowInput('${square}',${i},'amount',this.value)">
        ${locked ? '' : `<button class="del no-print" onclick="deleteRow('${square}',${i})">✕</button>`}
      </div>`;
    })
    .join('');
}

function onRowInput(square, idx, field, value) {
  current[square][idx][field] = field === 'amount' ? (Number(value) || 0) : value;
  recalc();
}

function addRow(square) {
  current[square].push({ label: '', amount: 0 });
  renderRows(square);
}

function deleteRow(square, idx) {
  current[square].splice(idx, 1);
  renderRows(square);
  recalc();
}

function sum(rows) {
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

function recalc() {
  const cashTotal = sum(current.cashIn);
  const expensesTotal = sum(current.expenses);
  const cashSubtotal = cashTotal - expensesTotal;
  const bankInTotal = sum(current.bankIn);
  const bankOutTotal = sum(current.bankOut);
  const bankSubtotal = bankInTotal - bankOutTotal;
  const closingBalance = cashSubtotal + bankSubtotal;

  document.getElementById('sub-cashIn').textContent = fmt(cashTotal);
  document.getElementById('sub-expenses').textContent = fmt(expensesTotal);
  document.getElementById('sub-bankIn').textContent = fmt(bankInTotal);
  document.getElementById('sub-bankOut').textContent = fmt(bankOutTotal);
  document.getElementById('tot-cash').textContent = fmt(cashSubtotal);
  document.getElementById('tot-bank').textContent = fmt(bankSubtotal);
  document.getElementById('tot-closing').textContent = fmt(closingBalance);
}

function renderAll() {
  SQUARES.forEach(renderRows);
  recalc();
}

async function loadDay() {
  const key = dateKey(currentDate);
  document.getElementById('period-label').textContent = key;
  document.getElementById('bs-date-display').textContent = fmtHeaderDate(currentDate);
  document.getElementById('save-note').textContent = '';
  const res = await fetch(`${API}/${key}`);
  current = await res.json();
  renderAll();
}

async function saveDay() {
  const key = dateKey(currentDate);
  const body = { cashIn: current.cashIn, bankIn: current.bankIn, expenses: current.expenses, bankOut: current.bankOut };
  const res = await fetch(`${API}/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const note = document.getElementById('save-note');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    note.style.color = '#dc2626';
    note.textContent = err.error || 'Save failed';
    return;
  }
  current = await res.json();
  renderAll();
  note.style.color = '#16a34a';
  note.textContent = 'Saved ✓';
}

loadDay();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the page is well-formed and the server serves it**

Run as a single command block (same PID-capture reasoning as Task 2 Step 4 — job control does not survive across separate tool-call invocations):

```bash
cd "app"
PORT=3399 node server.js &
SERVER_PID=$!
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3399/balance-sheet.html
kill "$SERVER_PID"
```
Expected: `200`

- [ ] **Step 3: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
git add app/public/balance-sheet.html
git commit -m "feat(narayani-steels): add Balance Sheet page"
```

---

### Task 4: Nav integration and source-file sync

**Files:**
- Modify: `app/public/final-invoice-NS.html`
- Modify: `app/public/stock.html`
- Modify: `app/public/reports.html`
- Create: `public/balance-sheet.html` (copy of `app/public/balance-sheet.html` — this project keeps root-level copies as the source-of-truth style files; the `app/public/` copies are what the running server serves. See Note below.)

> **Note on file duplication:** Per `project_narayani_steels` history, this project keeps root-level `.html` files (`final-invoice-NS.html`, `stock.html`, etc.) as the edited "source" copies, and re-copies them into `app/public/` before the server serves them. Task 3 wrote directly to `app/public/balance-sheet.html` since it's a brand-new file with no prior root-level counterpart — this task creates that root-level counterpart to match the established convention, copying the exact same content so future edits have somewhere to start from.

- [ ] **Step 1: Add the 7th nav card to `final-invoice-NS.html`**

In `app/public/final-invoice-NS.html`, find:

```html
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
      <button class="type-btn" onclick="pickType('Challan',this)"><div class="tl">🚚 Delivery Challan</div></button>
      <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
      <a class="type-btn" href="ledger.html" style="text-decoration:none;display:block"><div class="tl">📒 Ledger</div></a>
      <a class="type-btn" href="reports.html" style="text-decoration:none;display:block"><div class="tl">📊 Reports</div></a>
    </div>
```

Replace with:

```html
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr 1fr">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
      <button class="type-btn" onclick="pickType('Challan',this)"><div class="tl">🚚 Delivery Challan</div></button>
      <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
      <a class="type-btn" href="ledger.html" style="text-decoration:none;display:block"><div class="tl">📒 Ledger</div></a>
      <a class="type-btn" href="reports.html" style="text-decoration:none;display:block"><div class="tl">📊 Reports</div></a>
      <a class="type-btn" href="balance-sheet.html" style="text-decoration:none;display:block"><div class="tl">🧮 Balance Sheet</div></a>
    </div>
```

Apply the identical change to the root-level copy at `final-invoice-NS.html` (not just `app/public/final-invoice-NS.html`) — same old/new text.

- [ ] **Step 2: Cross-link from `stock.html`'s header**

In `app/public/stock.html`, find:

```html
    <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
    <a class="back-link" href="reports.html">📊 Reports →</a>
```

Replace with:

```html
    <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
    <a class="back-link" href="balance-sheet.html">🧮 Balance Sheet</a>
    <a class="back-link" href="reports.html">📊 Reports →</a>
```

Apply the identical change to the root-level copy at `stock.html`.

- [ ] **Step 3: Cross-link from `reports.html`'s header**

In `app/public/reports.html`, find:

```html
    <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
    <a class="back-link" href="stock.html">📦 Stock →</a>
```

Replace with:

```html
    <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
    <a class="back-link" href="balance-sheet.html">🧮 Balance Sheet</a>
    <a class="back-link" href="stock.html">📦 Stock →</a>
```

Apply the identical change to the root-level copy at `reports.html`.

- [ ] **Step 4: Create the root-level source copy of the new page**

Copy `app/public/balance-sheet.html` to `balance-sheet.html` (repo root, alongside `final-invoice-NS.html`) with identical content — no changes, this is purely establishing the "source" copy per this project's existing file-duplication convention.

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
cp "app/public/balance-sheet.html" "balance-sheet.html"
```

- [ ] **Step 5: Verify all four nav links resolve with the server running**

Run as a single command block (same PID-capture reasoning as Task 2 Step 4):

```bash
cd app
PORT=3399 node server.js &
SERVER_PID=$!
sleep 1
for f in final-invoice-NS.html stock.html reports.html balance-sheet.html; do
  echo -n "$f: "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3399/$f"
done
kill "$SERVER_PID"
```
Expected: all four print `200`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
git add app/public/final-invoice-NS.html final-invoice-NS.html \
        app/public/stock.html stock.html \
        app/public/reports.html reports.html \
        balance-sheet.html
git commit -m "feat(narayani-steels): link Balance Sheet into nav across all pages"
```

---

### Task 5: Full end-to-end verification (not yet deployed to the shop PC)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd "app" && npm test`
Expected: all tests pass, including the 10 new `balanceSheetStore.test.js` tests alongside the existing `stockStore.test.js` suite.

- [ ] **Step 2: Live walk-through with the real server**

Run: `cd "app" && node server.js` (foreground, leave running)

In a second terminal:
```bash
curl -s http://127.0.0.1:3300/api/balance-sheet/$(date +%F)
```
Expected: valid JSON with `cashIn[0].label == "Opening Balance"` and `closingBalance == 0` on a machine with no prior balance-sheet data.

Open `http://localhost:3300/balance-sheet.html` in a browser: confirm the "श्री" header, the two rule lines, the 2×2 grid with Cash In/Bank In/Expenses/Bank Out labels, add a row to each square, click Save, reload the page, and confirm the entered rows reappear (proves the save→reload round trip through the real UI, not just curl). Click Print and confirm the print preview shows a single clean A4 page with the Add/Delete/Save UI hidden.

- [ ] **Step 3: Clean up any test data created during manual verification**

```bash
rm -f "app/data/balance-sheet.json" "app/data/balance-sheet.json.tmp"
```

(This file is gitignored and shop-PC-specific real data — it should not exist in this dev checkout after verification, matching how `app/data/stock.json` is treated.)

- [ ] **Step 4: Note remaining work explicitly (not part of this plan)**

Deploying this to the actual shop PC (`C:\Invoicing System`, flat layout — see `project_narayani_steels` memory) is a separate live TeamViewer session, per this project's established delivery pattern for every prior feature. This plan only covers building and locally verifying the feature.
