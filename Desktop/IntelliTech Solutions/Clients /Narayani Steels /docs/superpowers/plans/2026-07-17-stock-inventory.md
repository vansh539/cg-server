# Stock/Inventory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stock/Inventory module to the Narayani Steels billing tool — categorized stock items with auto-computed piece counts, ongoing stock-level updates (stock-in / adjust), and an explicit "Deduct from Stock" action linked to the Chitti/Invoice flow.

**Architecture:** New JSON-file-backed data layer (`app/stockStore.js`, synchronous, atomic writes) exposed via new `/api/stock/*` Express routes in the existing `app/server.js`. New standalone `stock.html` page (root = source of truth, synced to `app/public/` for serving — same pattern this project already uses for `final-invoice-NS.html`/`delivery_challan_NS.html`). The only change to the existing 637KB `final-invoice-NS.html` is a small nav link plus a targeted Particulars-autocomplete + "Deduct from Stock" button inside the Chitti (`#s3`/`#s4`) step — Quotation and Delivery Challan are untouched.

**Tech Stack:** Plain Node/Express (no new npm dependencies — `express.json()` is built into the already-installed `express@^4.18.2`). Tests use Node's built-in test runner (`node --test`, `node:assert/strict`) and the global `fetch` (both built into Node 18+ with no install needed) — this project has no existing test framework, so this is the lowest-friction option that satisfies "no new npm dependencies." UI verification uses the same headless-Chrome / Claude-in-Chrome techniques already established in this project's other plans (e.g. `docs/superpowers/plans/2026-07-06-chitti-a5-dual-copy.md`), since there is no test framework for the vanilla-JS front end either.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-07-17-stock-inventory-design.md`.
- No new npm dependencies. `app/package.json` currently has only `express` and `cors`.
- Storage is a single JSON file (`app/data/stock.json`), not SQLite — the shop PC has no internet and ships `node_modules` pre-committed from a Mac dev machine, so a native module's prebuilt binary is not guaranteed to work there.
- `app/data/` holds real business data once in use — add it to `.gitignore` (repo root: `/Users/vanshjalan/.gitignore`) so it is never committed; do not remove or alter any other existing `.gitignore` entries.
- Quotation (`#s5`/`#s9`, `PAGE_TEMPLATE` blob) and Delivery Challan (`delivery_challan_NS.html`) are **not** touched by any task in this plan — only Chitti/Invoice (`#s3`/`#s4`).
- Every edit to `final-invoice-NS.html` (the file at the project root) must be synced with a plain `cp` to `app/public/final-invoice-NS.html` before that task's verification step, matching this project's existing source-of-truth convention. Same rule for the new `stock.html`.
- `app/server.js`'s license gate (existing code, unchanged) blocks all routes except `/expired.html`/`/favicon*` when `app/license.key` is invalid or expired. All commands in this plan that hit `/api/stock/*` or load pages depend on `app/license.key` currently being valid — it is, expiring 2027-07-06, and the machine-lock check is skipped entirely on non-Windows (`_getMachineId()` returns `null` on macOS), so this holds on the dev Mac regardless of which machine the key is locked to.
- Do not touch invoice calculation logic (GST, totals, Old Balance/Advance, labour auto-calc, row-padding math) anywhere in `final-invoice-NS.html`.
- Project root for all file paths below: `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /` (note the trailing space in "Clients /" and in "Narayani Steels /" — copy paths exactly).

---

### Task 1: `stockStore.js` — JSON-backed data layer

**Files:**
- Create: `app/stockStore.js`
- Create: `app/stockStore.test.js`
- Modify: `app/package.json` (add `test` script)
- Modify: `/Users/vanshjalan/.gitignore` (ignore `app/data/`)

**Interfaces:**
- Consumes: nothing (foundational task).
- Produces (used by Task 2):
  - `createStore(filePath: string) => Store` and `PRESET_CATEGORIES: string[]`, both exported from `app/stockStore.js` via `module.exports = { createStore, PRESET_CATEGORIES }`.
  - `Store.init(): void` — idempotent; creates `filePath`'s directory and seeds the file with `PRESET_CATEGORIES` if it doesn't exist yet.
  - `Store.listCategories(): {id, name}[]`
  - `Store.addCategory(name: string): {id, name}` — throws `Error('Category name is required')` on blank, `Error('Category already exists')` on case-insensitive duplicate.
  - `Store.listItems(): {id, categoryId, name, weightPerPieceKg, currentStockKg, pieces}[]`
  - `Store.getItem(id: string): {..., pieces}` — throws `Error('Item not found')`.
  - `Store.addItem({categoryId, name, weightPerPieceKg, initialStockKg}): {..., pieces}` — throws `Error('Item name is required')`, `Error('Category not found')`, `Error('Weight per piece must be a positive number or omitted')`, `Error('Initial stock must be zero or a positive number')` as applicable.
  - `Store.stockIn(itemId, kg, note?): {..., pieces}` — throws `Error('Stock-in quantity must be a positive number')` or `Error('Item not found')`.
  - `Store.adjust(itemId, newTotalKg, note?): {..., pieces}` — throws `Error('New total must be a number')` or `Error('Item not found')`. Allows negative `currentStockKg`.
  - `Store.deduct(itemId, kg, note?): {..., pieces}` — throws `Error('Deduct quantity must be a positive number')` or `Error('Item not found')`. Allows negative `currentStockKg`.
  - `Store.listMovements(itemId): {id, itemId, deltaKg, reason, note, at}[]`, newest first.

- [ ] **Step 1: Write the failing test file**

Create `app/stockStore.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, PRESET_CATEGORIES } = require('./stockStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-stock-'));
  return path.join(dir, 'stock.json');
}

test('init seeds the 6 preset categories on first run', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  assert.equal(cats.length, PRESET_CATEGORIES.length);
  assert.deepEqual(cats.map((c) => c.name), PRESET_CATEGORIES);
  assert.ok(cats.every((c) => typeof c.id === 'string' && c.id.startsWith('cat_')));
});

test('init is idempotent across two store instances on the same file', () => {
  const file = tempFile();
  createStore(file).init();
  const second = createStore(file);
  assert.equal(second.listCategories().length, PRESET_CATEGORIES.length);
});

test('addCategory adds a new category and rejects blanks and duplicates', () => {
  const store = createStore(tempFile());
  const cat = store.addCategory('Nails');
  assert.equal(cat.name, 'Nails');
  assert.equal(store.listCategories().length, PRESET_CATEGORIES.length + 1);

  assert.throws(() => store.addCategory(''), /Category name is required/);
  assert.throws(() => store.addCategory('   '), /Category name is required/);
  assert.throws(() => store.addCategory('nails'), /Category already exists/);
});

test('addItem validates category, name, weight, and initial stock', () => {
  const store = createStore(tempFile());
  const [tmt] = store.listCategories();

  assert.throws(
    () => store.addItem({ categoryId: 'nope', name: 'X', weightPerPieceKg: null, initialStockKg: 0 }),
    /Category not found/
  );
  assert.throws(
    () => store.addItem({ categoryId: tmt.id, name: '', weightPerPieceKg: null, initialStockKg: 0 }),
    /Item name is required/
  );
  assert.throws(
    () => store.addItem({ categoryId: tmt.id, name: 'Bad Weight', weightPerPieceKg: -5, initialStockKg: 0 }),
    /Weight per piece must be a positive number or omitted/
  );
  assert.throws(
    () => store.addItem({ categoryId: tmt.id, name: 'Bad Stock', weightPerPieceKg: null, initialStockKg: -1 }),
    /Initial stock must be zero or a positive number/
  );

  const item = store.addItem({ categoryId: tmt.id, name: 'TMT 12mm Bar', weightPerPieceKg: 10.5, initialStockKg: 105 });
  assert.equal(item.currentStockKg, 105);
  assert.equal(item.pieces, 10); // floor(105 / 10.5) === 10
});

test('addItem allows a null weightPerPieceKg and reports pieces as null', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Loose Cement', weightPerPieceKg: null, initialStockKg: 500 });
  assert.equal(item.pieces, null);
});

test('stockIn, adjust, and deduct update currentStockKg and write one movement each', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'UltraTech 50kg Bag', weightPerPieceKg: 50, initialStockKg: 1000 });

  const afterStockIn = store.stockIn(item.id, 500, 'delivery truck');
  assert.equal(afterStockIn.currentStockKg, 1500);

  const afterDeduct = store.deduct(item.id, 1800, 'Chitti/Invoice');
  assert.equal(afterDeduct.currentStockKg, -300); // negative allowed, not blocked

  const afterAdjust = store.adjust(item.id, 200, 'physical recount');
  assert.equal(afterAdjust.currentStockKg, 200);

  const movements = store.listMovements(item.id);
  assert.equal(movements.length, 4); // initial, stock-in, invoice-deduct, adjustment
  assert.equal(movements[0].reason, 'adjustment'); // newest first
  assert.equal(movements[0].deltaKg, 200 - (-300));
  assert.equal(movements[1].reason, 'invoice-deduct');
  assert.equal(movements[1].deltaKg, -1800);
});

test('stockIn and deduct reject non-positive quantities', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Rod', weightPerPieceKg: 5, initialStockKg: 100 });
  assert.throws(() => store.stockIn(item.id, 0), /Stock-in quantity must be a positive number/);
  assert.throws(() => store.stockIn(item.id, -5), /Stock-in quantity must be a positive number/);
  assert.throws(() => store.deduct(item.id, 0), /Deduct quantity must be a positive number/);
});

test('operations on an unknown item id throw Item not found', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.stockIn('item_ghost', 10), /Item not found/);
  assert.throws(() => store.adjust('item_ghost', 10), /Item not found/);
  assert.throws(() => store.deduct('item_ghost', 10), /Item not found/);
  assert.throws(() => store.getItem('item_ghost'), /Item not found/);
});

test('data survives being reloaded from disk by a fresh store instance', () => {
  const file = tempFile();
  const store = createStore(file);
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Persisted Item', weightPerPieceKg: 2, initialStockKg: 20 });
  store.stockIn(item.id, 10);

  const reloaded = createStore(file);
  const reloadedItem = reloaded.getItem(item.id);
  assert.equal(reloadedItem.currentStockKg, 30);
  assert.equal(reloaded.listMovements(item.id).length, 2);
});

test('rapid sequential mutations are all applied (no lost updates)', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Sequential Test', weightPerPieceKg: null, initialStockKg: 0 });
  for (let i = 0; i < 20; i++) {
    store.stockIn(item.id, 10);
  }
  assert.equal(store.getItem(item.id).currentStockKg, 200);
  assert.equal(store.listMovements(item.id).length, 20);
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test stockStore.test.js
```
Expected: fails immediately with an error indicating `Cannot find module './stockStore'` (the module doesn't exist yet) — non-zero exit code.

- [ ] **Step 3: Write the implementation**

Create `app/stockStore.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRESET_CATEGORIES = ['M.S. Pipes', 'TMT Bars', 'M.S. Section', 'Colour Coated Sheets', 'Cement', 'Rings'];

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function computePieces(item) {
  return item.weightPerPieceKg ? Math.floor(item.currentStockKg / item.weightPerPieceKg) : null;
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
        throw new Error(`stock.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
      data = {
        categories: PRESET_CATEGORIES.map((name) => ({ id: newId('cat'), name })),
        items: [],
        movements: [],
      };
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

  function listCategories() {
    ensureLoaded();
    return data.categories;
  }

  function addCategory(name) {
    ensureLoaded();
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('Category name is required');
    if (data.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Category already exists');
    }
    const cat = { id: newId('cat'), name: trimmed };
    data.categories.push(cat);
    save();
    return cat;
  }

  function listItems() {
    ensureLoaded();
    return data.items.map((item) => ({ ...item, pieces: computePieces(item) }));
  }

  function getItem(id) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    return { ...item, pieces: computePieces(item) };
  }

  function addItem({ categoryId, name, weightPerPieceKg, initialStockKg }) {
    ensureLoaded();
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Item name is required');
    if (!data.categories.some((c) => c.id === categoryId)) throw new Error('Category not found');

    const weight =
      weightPerPieceKg === null || weightPerPieceKg === undefined || weightPerPieceKg === ''
        ? null
        : Number(weightPerPieceKg);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      throw new Error('Weight per piece must be a positive number or omitted');
    }

    const initial = initialStockKg === undefined || initialStockKg === '' ? 0 : Number(initialStockKg);
    if (!Number.isFinite(initial) || initial < 0) {
      throw new Error('Initial stock must be zero or a positive number');
    }

    const item = { id: newId('item'), categoryId, name: trimmedName, weightPerPieceKg: weight, currentStockKg: initial };
    data.items.push(item);
    if (initial > 0) {
      data.movements.push({ id: newId('mv'), itemId: item.id, deltaKg: initial, reason: 'initial', note: '', at: new Date().toISOString() });
    }
    save();
    return { ...item, pieces: computePieces(item) };
  }

  function applyDelta(itemId, deltaKg, reason, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    if (!Number.isFinite(deltaKg)) throw new Error('Quantity must be a number');
    item.currentStockKg = item.currentStockKg + deltaKg;
    data.movements.push({ id: newId('mv'), itemId, deltaKg, reason, note: note || '', at: new Date().toISOString() });
    save();
    return { ...item, pieces: computePieces(item) };
  }

  function stockIn(itemId, kg, note) {
    const n = Number(kg);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Stock-in quantity must be a positive number');
    return applyDelta(itemId, n, 'stock-in', note);
  }

  function adjust(itemId, newTotalKg, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const n = Number(newTotalKg);
    if (!Number.isFinite(n)) throw new Error('New total must be a number');
    return applyDelta(itemId, n - item.currentStockKg, 'adjustment', note);
  }

  function deduct(itemId, kg, note) {
    const n = Number(kg);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Deduct quantity must be a positive number');
    return applyDelta(itemId, -n, 'invoice-deduct', note);
  }

  function listMovements(itemId) {
    ensureLoaded();
    // Movements are always appended in chronological order, so reversing
    // gives newest-first deterministically — sorting by the `at` ISO string
    // instead would tie (and misorder) any movements written within the
    // same millisecond, which happens routinely for sync same-tick writes.
    return data.movements.filter((m) => m.itemId === itemId).reverse();
  }

  return { init, listCategories, addCategory, listItems, getItem, addItem, stockIn, adjust, deduct, listMovements };
}

module.exports = { createStore, PRESET_CATEGORIES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test stockStore.test.js
```
Expected: all 10 tests pass, `# fail 0` in the summary, exit code 0.

- [ ] **Step 5: Add the `test` script and ignore runtime data**

In `app/package.json`, replace:
```json
  "scripts": {
    "start": "node server.js"
  },
```
with:
```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
```

In `/Users/vanshjalan/.gitignore`, add a new line at the end of the file:
```
Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/
```

- [ ] **Step 6: Verify the npm script and gitignore**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && npm test
```
Expected: same as Step 4 (all tests pass) — confirms `npm test` runs `node --test` and auto-discovers `stockStore.test.js`.

Run:
```bash
cd /Users/vanshjalan && git check-ignore -v "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/data/stock.json"
```
Expected: prints a match against the new `.gitignore` line (confirms the path is ignored) — exit code 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/stockStore.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/stockStore.test.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/package.json" \
  ".gitignore"
git commit -m "$(cat <<'EOF'
feat(narayani-steels): add JSON-backed stock data layer

EOF
)"
```

---

### Task 2: `/api/stock/*` routes on `server.js`

**Files:**
- Modify: `app/server.js`
- Create: `app/server.test.js`

**Interfaces:**
- Consumes: `createStore`, `PRESET_CATEGORIES` from Task 1's `app/stockStore.js` (exact signatures above).
- Produces (used by Tasks 3 and 5):
  - `GET /api/stock/categories` → `200 [{id,name}, ...]`
  - `POST /api/stock/categories` body `{name}` → `201 {id,name}` or `400 {error}`
  - `GET /api/stock/items` → `200 [{id,categoryId,name,weightPerPieceKg,currentStockKg,pieces}, ...]`
  - `POST /api/stock/items` body `{categoryId,name,weightPerPieceKg,initialStockKg}` → `201 {...,pieces}` or `400 {error}`
  - `POST /api/stock/items/:id/stock-in` body `{kg,note?}` → `200 {...,pieces}`, `400 {error}`, or `404 {error}`
  - `POST /api/stock/items/:id/adjust` body `{newTotalKg,note?}` → `200 {...,pieces}`, `400 {error}`, or `404 {error}`
  - `POST /api/stock/items/:id/deduct` body `{kg,note?}` → `200 {...,pieces}`, `400 {error}`, or `404 {error}`
  - `GET /api/stock/items/:id/movements` → `200 [{id,itemId,deltaKg,reason,note,at}, ...]` or `404 {error}`
  - `module.exports = app` from `app/server.js` (an Express app, not yet listening) — Task 2's tests and Task 3/5's manual verification both attach it to their own `http.createServer`/`.listen()`.
  - `STOCK_DATA_PATH` env var override, read once at module load — set it before `require('./server.js')` to point the store at a scratch file instead of `app/data/stock.json`.

- [ ] **Step 1: Write the failing test file**

Create `app/server.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-server-'));
process.env.STOCK_DATA_PATH = path.join(tmpDir, 'stock.json');
process.env.PORT = '0'; // unused directly by tests, but keeps server.js's default sane if ever invoked

const app = require('./server.js');

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
async function postJson(server, urlPath, body) {
  return fetch(`${baseUrl(server)}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET /api/stock/categories returns the 6 preset categories', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/stock/categories`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 6);
    assert.ok(body.some((c) => c.name === 'TMT Bars'));
  } finally {
    await close(server);
  }
});

test('POST /api/stock/categories creates a category, rejects duplicates', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/stock/categories', { name: 'Nails' });
    assert.equal(res.status, 201);
    const dup = await postJson(server, '/api/stock/categories', { name: 'nails' });
    assert.equal(dup.status, 400);
    const dupBody = await dup.json();
    assert.equal(dupBody.error, 'Category already exists');
  } finally {
    await close(server);
  }
});

test('POST /api/stock/items creates an item and computes pieces', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const tmt = cats.find((c) => c.name === 'TMT Bars');
    const res = await postJson(server, '/api/stock/items', {
      categoryId: tmt.id,
      name: 'TMT 12mm Bar',
      weightPerPieceKg: 10.5,
      initialStockKg: 105,
    });
    assert.equal(res.status, 201);
    const item = await res.json();
    assert.equal(item.currentStockKg, 105);
    assert.equal(item.pieces, 10);
  } finally {
    await close(server);
  }
});

test('POST /api/stock/items rejects an unknown category with 400', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/stock/items', { categoryId: 'nope', name: 'Ghost Item' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Category not found');
  } finally {
    await close(server);
  }
});

test('stock-in, deduct, and adjust update currentStockKg via the ledger; unknown item is 404', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const cement = cats.find((c) => c.name === 'Cement');
    const created = await (
      await postJson(server, '/api/stock/items', {
        categoryId: cement.id,
        name: 'UltraTech 50kg Bag',
        weightPerPieceKg: 50,
        initialStockKg: 1000,
      })
    ).json();

    const afterStockIn = await (await postJson(server, `/api/stock/items/${created.id}/stock-in`, { kg: 500 })).json();
    assert.equal(afterStockIn.currentStockKg, 1500);

    const afterDeduct = await (await postJson(server, `/api/stock/items/${created.id}/deduct`, { kg: 1800 })).json();
    assert.equal(afterDeduct.currentStockKg, -300);

    const afterAdjust = await (
      await postJson(server, `/api/stock/items/${created.id}/adjust`, { newTotalKg: 200 })
    ).json();
    assert.equal(afterAdjust.currentStockKg, 200);

    const movements = await (await fetch(`${baseUrl(server)}/api/stock/items/${created.id}/movements`)).json();
    assert.equal(movements.length, 4);
    assert.equal(movements[0].reason, 'adjustment');

    const missing = await postJson(server, '/api/stock/items/item_ghost/stock-in', { kg: 10 });
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test('GET /api/stock/items/:id/movements 404s for an unknown item', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/stock/items/item_ghost/movements`);
    assert.equal(res.status, 404);
  } finally {
    await close(server);
  }
});

test('a corrupted stock.json disables only /api/stock/* (500), not the rest of the app', async () => {
  const corruptFile = path.join(tmpDir, 'corrupt-stock.json');
  fs.writeFileSync(corruptFile, '{ not valid json');
  const prevPath = process.env.STOCK_DATA_PATH;
  process.env.STOCK_DATA_PATH = corruptFile;
  delete require.cache[require.resolve('./server.js')];
  const corruptApp = require('./server.js');
  process.env.STOCK_DATA_PATH = prevPath; // restore for any later require in this process

  const server = await new Promise((resolve) => {
    const s = http.createServer(corruptApp);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const stockRes = await fetch(`${baseUrl(server)}/api/stock/categories`);
    assert.equal(stockRes.status, 500);
    const staticRes = await fetch(`${baseUrl(server)}/final-invoice-NS.html`);
    assert.equal(staticRes.status, 200); // rest of the app still works
  } finally {
    await close(server);
  }
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test server.test.js
```
Expected: fails — `server.js` currently calls `app.listen(...)` unconditionally and does not `module.exports = app`, so `require('./server.js')` either hangs binding port 3300 or `app` is `undefined`, causing every test to throw. Non-zero exit code either way.

- [ ] **Step 3: Modify `server.js`**

In `app/server.js`, replace the requires block (original lines 1-11):
```js
'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3300;
```
with:
```js
'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync } = require('child_process');
const { createStore } = require('./stockStore');

const app  = express();
const PORT = process.env.PORT || 3300;

const STOCK_DATA_PATH = process.env.STOCK_DATA_PATH || path.join(__dirname, 'data', 'stock.json');
const stockStore = createStore(STOCK_DATA_PATH);
let _stockInitError = null;
try {
  stockStore.init();
} catch (err) {
  _stockInitError = err;
  console.error(`[Stock] Failed to load stock data: ${err.message}`);
}

function sendStockError(res, err) {
  const status = err.message === 'Item not found' ? 404 : 400;
  res.status(status).json({ error: err.message });
}

// Guards every /api/stock/* route: a corrupted stock.json must not take down
// the rest of the app (billing still needs to work) — it only disables stock.
function requireStock(req, res, next) {
  if (_stockInitError) return res.status(500).json({ error: 'Stock data is unavailable — see server logs.' });
  next();
}
```

Replace the license-gate-to-static block (original lines 65-76):
```js
// License gate — blocks everything except the expired page itself
app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.get('/', (req, res) => res.redirect('/final-invoice-NS.html'));

app.use(express.static(path.join(__dirname, 'public')));
```
with:
```js
// License gate — blocks everything except the expired page itself
app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.use(express.json());

app.get('/', (req, res) => res.redirect('/final-invoice-NS.html'));

app.use('/api/stock', requireStock);

app.get('/api/stock/categories', (req, res) => {
  res.json(stockStore.listCategories());
});

app.post('/api/stock/categories', (req, res) => {
  try {
    res.status(201).json(stockStore.addCategory(req.body && req.body.name));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.get('/api/stock/items', (req, res) => {
  res.json(stockStore.listItems());
});

app.post('/api/stock/items', (req, res) => {
  try {
    res.status(201).json(stockStore.addItem(req.body || {}));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/stock-in', (req, res) => {
  try {
    res.json(stockStore.stockIn(req.params.id, req.body && req.body.kg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/adjust', (req, res) => {
  try {
    res.json(stockStore.adjust(req.params.id, req.body && req.body.newTotalKg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/deduct', (req, res) => {
  try {
    res.json(stockStore.deduct(req.params.id, req.body && req.body.kg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.get('/api/stock/items/:id/movements', (req, res) => {
  try {
    stockStore.getItem(req.params.id);
    res.json(stockStore.listMovements(req.params.id));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.use(express.static(path.join(__dirname, 'public')));
```

Replace the final listen block (original lines 77-81):
```js
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Narayani Steels — Billing Tool`);
  console.log(`  Open in browser: http://localhost:${PORT}`);
});
```
with:
```js
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Narayani Steels — Billing Tool`);
    console.log(`  Open in browser: http://localhost:${PORT}`);
  });
}

module.exports = app;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && node --test server.test.js
```
Expected: all 7 tests pass, `# fail 0`, exit code 0.

Then run the full suite together to confirm Task 1's tests still pass alongside the new ones:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && npm test
```
Expected: both `stockStore.test.js` (10 tests) and `server.test.js` (7 tests) pass, `# fail 0`.

- [ ] **Step 5: Confirm `node server.js` still starts standalone (manual-run path unaffected)**

Run:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && PORT=3301 STOCK_DATA_PATH=/tmp/ns-manual-check.json timeout 3 node server.js; echo "exit:$?"
```
Expected: prints `Narayani Steels — Billing Tool` and `Open in browser: http://localhost:3301`, then is killed by `timeout` after 3s (`exit:124`) — confirms `require.main === module` still triggers `.listen()` when run directly.

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.js" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/server.test.js"
git commit -m "$(cat <<'EOF'
feat(narayani-steels): add /api/stock/* routes to server.js

EOF
)"
```

---

### Task 3: `stock.html` — Stock page UI

**Files:**
- Create: `stock.html` (project root — source of truth)
- Copy: `stock.html` → `app/public/stock.html` (deployed copy, same convention as `final-invoice-NS.html`)

**Interfaces:**
- Consumes: Task 2's `/api/stock/categories`, `/api/stock/items`, `POST /api/stock/items`, `POST /api/stock/categories`, `POST /api/stock/items/:id/stock-in`, `POST /api/stock/items/:id/adjust`, `GET /api/stock/items/:id/movements` (exact request/response shapes above).
- Produces: nothing consumed by later tasks — Task 4 only links to this page by URL (`stock.html`), it doesn't depend on anything inside it.

- [ ] **Step 1: Write `stock.html`**

Create `stock.html` at the project root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels — Stock</title>
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
.fg input,.fg select{width:100%;padding:9px 11px;border:1.5px solid #e2e2e2;border-radius:7px;font-size:14px;background:#fff;color:#111}
.fg input:focus,.fg select:focus{outline:none;border-color:#c45c00}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.btn-p{background:#c45c00;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn-p:hover{filter:brightness(0.85)}
.btn-p:disabled{opacity:.5;pointer-events:none}
.btn-s{background:#fff;border:1.5px solid #e2e2e2;border-radius:8px;padding:9px 18px;font-size:14px;color:#333;cursor:pointer;font-weight:500}
.btn-s:hover{background:#f4f4f0}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px}
.cat-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:1rem}
.cat-pill{background:#f7f7f5;border:1.5px solid #e2e2e2;border-radius:20px;padding:8px 16px;font-size:13px;font-weight:500;color:#333;cursor:pointer}
.cat-pill:hover{border-color:#aaa}
.cat-pill.on{border-color:#c45c00;background:#c45c00;color:#fff}
.cat-pill.add{border-style:dashed;color:#888;background:none}
.cat-pill.add:hover{border-color:#c45c00;color:#c45c00}
table.stbl{width:100%;border-collapse:collapse;font-size:13px}
.stbl th{font-size:11px;font-weight:600;color:#888;padding:6px 5px;border-bottom:1.5px solid #e9e9e9;text-align:left}
.stbl td{padding:8px 5px;vertical-align:middle;border-bottom:1px solid #f0f0f0}
.stbl td.r{text-align:right}
.stbl td.neg{color:#dc2626;font-weight:700}
.stbl .actions{display:flex;gap:6px;flex-wrap:wrap}
.inline-form{background:#f7f7f5;border-radius:8px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.inline-form input{padding:7px 9px;border:1.5px solid #e2e2e2;border-radius:6px;font-size:13px;width:140px}
.hist-row td{background:#fafafa;font-size:12px;color:#555;padding:10px}
.hist-row ul{list-style:none}
.hist-row li{padding:2px 0}
.empty-note{color:#999;font-size:13px;padding:14px 0;text-align:center}
.pieces-preview{font-size:12px;color:#888;margin-top:-4px;margin-bottom:10px}
.err{color:#dc2626;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <a class="back-link" href="final-invoice-NS.html">← Back to Billing</a>
  <div class="app-title">📦 Narayani Steels — Stock</div>
  <div class="app-sub">Categories, items, and current stock levels</div>

  <div class="cat-bar" id="cat-bar"></div>

  <div class="card" id="add-cat-card" style="display:none">
    <h3>New category</h3>
    <div class="fg"><input id="new-cat-name" type="text" placeholder="Category name"></div>
    <div class="err" id="cat-err" style="display:none"></div>
    <div style="display:flex;gap:8px">
      <button class="btn-p" onclick="saveCategory()">Save</button>
      <button class="btn-s" onclick="hideAddCategory()">Cancel</button>
    </div>
  </div>

  <div class="card">
    <h3 id="items-heading">Items</h3>
    <table class="stbl">
      <thead><tr><th>Name</th><th>Wt/Pc (kg)</th><th class="r">Stock (kg)</th><th class="r">Pieces</th><th>Actions</th></tr></thead>
      <tbody id="items-tbody"></tbody>
    </table>
    <div class="empty-note" id="empty-note" style="display:none">No items in this category yet.</div>
  </div>

  <div class="card">
    <h3>+ Add item</h3>
    <div class="grid2">
      <div class="fg"><label>Category</label><select id="new-item-cat"></select></div>
      <div class="fg"><label>Name</label><input id="new-item-name" type="text" placeholder="TMT 12mm Bar"></div>
    </div>
    <div class="grid2">
      <div class="fg"><label>Weight/Piece (kg, optional)</label><input id="new-item-weight" type="number" min="0" step="any" placeholder="10.5" oninput="updateNewItemPreview()"></div>
      <div class="fg"><label>Initial Stock (kg)</label><input id="new-item-stock" type="number" min="0" step="any" placeholder="0" oninput="updateNewItemPreview()"></div>
    </div>
    <div class="pieces-preview" id="new-item-preview">Pieces: —</div>
    <div class="err" id="item-err" style="display:none"></div>
    <button class="btn-p" onclick="saveNewItem()">+ Add Item</button>
  </div>
</div>

<script>
const API = '/api/stock';
let categories = [];
let items = [];
let selectedCatId = null;
let openRow = null; // {itemId, mode: 'stock-in'|'adjust'|'history'}

function fmtKg(v) {
  return Number(v.toFixed(2));
}
function computePiecesPreview(weightPerPieceKg, currentStockKg) {
  return weightPerPieceKg ? Math.floor(currentStockKg / weightPerPieceKg) : null;
}

async function loadAll() {
  const [catsRes, itemsRes] = await Promise.all([fetch(`${API}/categories`), fetch(`${API}/items`)]);
  categories = await catsRes.json();
  items = await itemsRes.json();
  if (!selectedCatId && categories.length) selectedCatId = categories[0].id;
  renderCatBar();
  renderItemCatSelect();
  renderItems();
}

function renderCatBar() {
  const bar = document.getElementById('cat-bar');
  bar.innerHTML =
    categories.map((c) => `<button class="cat-pill${c.id === selectedCatId ? ' on' : ''}" onclick="selectCategory('${c.id}')">${c.name}</button>`).join('') +
    `<button class="cat-pill add" onclick="showAddCategory()">+ Add category</button>`;
}

function renderItemCatSelect() {
  const sel = document.getElementById('new-item-cat');
  sel.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  sel.value = selectedCatId || '';
}

function selectCategory(id) {
  selectedCatId = id;
  openRow = null;
  renderCatBar();
  renderItemCatSelect();
  renderItems();
}

function showAddCategory() {
  document.getElementById('add-cat-card').style.display = 'block';
  document.getElementById('new-cat-name').value = '';
  document.getElementById('cat-err').style.display = 'none';
  document.getElementById('new-cat-name').focus();
}
function hideAddCategory() {
  document.getElementById('add-cat-card').style.display = 'none';
}
async function saveCategory() {
  const name = document.getElementById('new-cat-name').value;
  const errEl = document.getElementById('cat-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save category');
    selectedCatId = body.id;
    hideAddCategory();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function renderItems() {
  const heading = document.getElementById('items-heading');
  const cat = categories.find((c) => c.id === selectedCatId);
  heading.textContent = cat ? `Items — ${cat.name}` : 'Items';
  const catItems = items.filter((i) => i.categoryId === selectedCatId);
  const tbody = document.getElementById('items-tbody');
  document.getElementById('empty-note').style.display = catItems.length ? 'none' : 'block';
  tbody.innerHTML = catItems
    .map((item) => {
      const rows = [
        `<tr><td>${item.name}</td><td>${item.weightPerPieceKg ?? '—'}</td><td class="r${item.currentStockKg < 0 ? ' neg' : ''}">${fmtKg(item.currentStockKg)}</td><td class="r">${item.pieces ?? '—'}</td><td class="actions"><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','stock-in')">+ Stock In</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','adjust')">Adjust</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','history')">History</button></td></tr>`,
      ];
      if (openRow && openRow.itemId === item.id) rows.push(renderExpandedRow(item));
      return rows.join('');
    })
    .join('');
}

function renderExpandedRow(item) {
  if (openRow.mode === 'stock-in') {
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" min="0" step="any" placeholder="Kg received">
      <button class="btn-p btn-sm" onclick="submitStockIn('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  if (openRow.mode === 'adjust') {
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" step="any" placeholder="New true total (kg)" value="${fmtKg(item.currentStockKg)}">
      <button class="btn-p btn-sm" onclick="submitAdjust('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  return `<tr class="hist-row"><td colspan="5" id="history-cell">Loading history…</td></tr>`;
}

function toggleRow(itemId, mode) {
  if (openRow && openRow.itemId === itemId && openRow.mode === mode) {
    closeRow();
    return;
  }
  openRow = { itemId, mode };
  renderItems();
  if (mode === 'history') loadHistory(itemId);
}
function closeRow() {
  openRow = null;
  renderItems();
}

async function loadHistory(itemId) {
  const res = await fetch(`${API}/items/${itemId}/movements`);
  const movements = await res.json();
  const cell = document.getElementById('history-cell');
  if (!cell) return;
  cell.innerHTML = movements.length
    ? `<ul>${movements
        .map((m) => `<li>${new Date(m.at).toLocaleString('en-IN')} — ${m.reason} — ${m.deltaKg > 0 ? '+' : ''}${fmtKg(m.deltaKg)}kg${m.note ? ` (${m.note})` : ''}</li>`)
        .join('')}</ul>`
    : 'No movements yet.';
}

async function submitStockIn(itemId) {
  const kg = parseFloat(document.getElementById('row-input').value);
  const errEl = document.getElementById('row-err');
  try {
    const res = await fetch(`${API}/items/${itemId}/stock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kg }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save');
    closeRow();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function submitAdjust(itemId) {
  const newTotalKg = parseFloat(document.getElementById('row-input').value);
  const errEl = document.getElementById('row-err');
  try {
    const res = await fetch(`${API}/items/${itemId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newTotalKg }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save');
    closeRow();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function updateNewItemPreview() {
  const weight = parseFloat(document.getElementById('new-item-weight').value);
  const stock = parseFloat(document.getElementById('new-item-stock').value) || 0;
  const pieces = computePiecesPreview(weight || null, stock);
  document.getElementById('new-item-preview').textContent = `Pieces: ${pieces ?? '—'}`;
}

async function saveNewItem() {
  const categoryId = document.getElementById('new-item-cat').value;
  const name = document.getElementById('new-item-name').value;
  const weightRaw = document.getElementById('new-item-weight').value;
  const weightPerPieceKg = weightRaw === '' ? null : parseFloat(weightRaw);
  const initialStockKg = parseFloat(document.getElementById('new-item-stock').value) || 0;
  const errEl = document.getElementById('item-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, name, weightPerPieceKg, initialStockKg }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save item');
    document.getElementById('new-item-name').value = '';
    document.getElementById('new-item-weight').value = '';
    document.getElementById('new-item-stock').value = '';
    updateNewItemPreview();
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

- [ ] **Step 2: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /stock.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/stock.html"
```

- [ ] **Step 3: Start a local dev server against a scratch data file**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3302 STOCK_DATA_PATH=/private/tmp/claude-501/-Users-vanshjalan/ns-stock-manual/stock.json \
  node server.js > /tmp/ns-stock-dev-server.log 2>&1 &
sleep 1 && curl -s http://localhost:3302/api/stock/categories
```
Expected: JSON array of 6 categories (`M.S. Pipes`, `TMT Bars`, `M.S. Section`, `Colour Coated Sheets`, `Cement`, `Rings`), confirming the server started and the API responds.

- [ ] **Step 4: Verify the page end-to-end via Claude-in-Chrome**

Using the Claude-in-Chrome tools: navigate to `http://localhost:3302/stock.html`. Confirm the 6 category pills render with "M.S. Pipes" selected/first, "Items — M.S. Pipes" heading, and the empty-state note.

Click "+ Add category", type `Nails`, click Save. Confirm a 7th pill "Nails" appears and becomes selected.

Fill the "+ Add item" form: Category = TMT Bars, Name = `TMT 12mm Bar`, Weight/Piece = `10.5`, Initial Stock = `105`. Confirm the "Pieces: 10" preview updates live as the Initial Stock field is typed. Click "+ Add Item". Confirm the TMT Bars category (click its pill) now lists the item with Stock 105, Pieces 10.

Click "+ Stock In" on that row, enter `50`, Save. Confirm Stock now reads `155` and Pieces recomputes to `floor(155/10.5) = 14`.

Click "Adjust" on the same row, enter `-20`, Save. Confirm the Stock cell shows `-20` and is styled in red (the `.neg` class / red text).

Click "History" on the row. Confirm 3 entries appear (initial +105, stock-in +50, adjustment delta).

- [ ] **Step 5: Stop the dev server**

```bash
pkill -f "STOCK_DATA_PATH=/private/tmp/claude-501/-Users-vanshjalan/ns-stock-manual/stock.json"
```

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /stock.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/stock.html"
git commit -m "$(cat <<'EOF'
feat(narayani-steels): add stock.html — categories, items, stock-in/adjust UI

EOF
)"
```

---

### Task 4: Nav link from the billing tool to the stock page

**Files:**
- Modify: `final-invoice-NS.html:85-86` (project root)
- Copy: `final-invoice-NS.html` → `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: nothing (a static `<a href="stock.html">` link; Task 3's page already exists at that relative path once both are in `app/public/`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm current markup**

Run:
```bash
grep -n 'app-title">🏭 Narayani Steels\|app-sub">Nothing is saved' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected:
```
85:  <div class="app-title">🏭 Narayani Steels</div>
86:  <div class="app-sub">Nothing is saved · Instant print only</div>
```

- [ ] **Step 2: Add the nav link**

In `final-invoice-NS.html`, replace:
```html
  <div class="app-title">🏭 Narayani Steels</div>
  <div class="app-sub">Nothing is saved · Instant print only</div>
```
with:
```html
  <div class="app-title">🏭 Narayani Steels</div>
  <div class="app-sub" style="margin-bottom:.25rem">Nothing is saved · Instant print only</div>
  <div style="text-align:center;margin-bottom:1.25rem"><a href="stock.html" style="font-size:13px;color:#c45c00;text-decoration:none;font-weight:600">📦 Stock →</a></div>
```

- [ ] **Step 3: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
```

- [ ] **Step 4: Verify via Claude-in-Chrome**

Restart the dev server from Task 3 (same command, same `STOCK_DATA_PATH`, since a static file change doesn't require a restart but the server may have been stopped in Task 3 Step 5):
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app" && \
  PORT=3302 STOCK_DATA_PATH=/private/tmp/claude-501/-Users-vanshjalan/ns-stock-manual/stock.json \
  node server.js > /tmp/ns-stock-dev-server.log 2>&1 &
sleep 1
```
Using the Claude-in-Chrome tools: navigate to `http://localhost:3302/final-invoice-NS.html`. Confirm a "📦 Stock →" link is visible below the "Nothing is saved · Instant print only" subtitle. Click it. Confirm the browser navigates to `stock.html` and the page loads (categories/items from Task 3, including the "Nails" category and "TMT 12mm Bar" item created during that task's verification — confirms both pages share the same running server/data file as expected).

- [ ] **Step 5: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
git commit -m "$(cat <<'EOF'
feat(narayani-steels): add Stock nav link to the billing tool header

EOF
)"
```

---

### Task 5: Chitti auto-deduct — Particulars datalist + "Deduct from Stock"

**Files:**
- Modify: `final-invoice-NS.html` (project root) — datalist element, `renderRows()`, `addRow()`, new `matchStockItem`/`loadStockDatalist`/`updateDeductButton`/`deductStock` functions, `#s4` markup, `generate()`.
- Copy: `final-invoice-NS.html` → `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: Task 2's `GET /api/stock/categories`, `GET /api/stock/items`, `POST /api/stock/items/:id/deduct`.
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Confirm current markup and function bodies (baseline)**

Run:
```bash
grep -n 'class="wrap"\|<table class="itbl"\|^function addRow\|^function renderRows\|id="s4"\|^function generate(' \
  "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected (line numbers shifted by +1 from Task 4's edit, which replaced 2 lines with 3 — confirm against the actual `grep` output before editing, don't rely on these numbers blindly):
```
85:<div class="wrap">
109:      <table class="itbl">...
142:  <div class="step" id="s4">
216:function addRow(){...}
217:function renderRows(){...}
245:function generate(){...}
```

- [ ] **Step 2: Add the datalist element**

Replace:
```html
<div class="wrap">
```
with:
```html
<div class="wrap">
  <datalist id="stock-items-datalist"></datalist>
```

- [ ] **Step 3: Add stock item matching to `addRow()`/`renderRows()`**

Replace:
```js
function addRow(){rows.push({q:'',name:'',p:'',r:''});renderRows();}
function renderRows(){
  const tb=document.getElementById('tbody');tb.innerHTML='';
  rows.forEach((row,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td><input type="number" min="0" step="any" value="${row.q}" placeholder="0" oninput="upd(${i},'q',this.value)"></td><td><input type="text" value="${row.name}" placeholder="Item" oninput="upd(${i},'name',this.value)"></td><td><input type="number" min="0" step="1" value="${row.p}" placeholder="0" oninput="upd(${i},'p',this.value)"></td><td><input type="number" min="0" step="any" value="${row.r}" placeholder="0.00" oninput="upd(${i},'r',this.value)"></td><td class="amt">${calcAmt(row)}</td><td><button class="rm" onclick="delRow(${i})">×</button></td>`;tb.appendChild(tr);});recalc();
}
```
with:
```js
function addRow(){rows.push({q:'',name:'',p:'',r:'',stockItemId:null,_deducted:false});renderRows();}
function renderRows(){
  const tb=document.getElementById('tbody');tb.innerHTML='';
  rows.forEach((row,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td><input type="number" min="0" step="any" value="${row.q}" placeholder="0" oninput="upd(${i},'q',this.value)"></td><td><input type="text" list="stock-items-datalist" value="${row.name}" placeholder="Item" oninput="upd(${i},'name',this.value);matchStockItem(${i},this.value)"></td><td><input type="number" min="0" step="1" value="${row.p}" placeholder="0" oninput="upd(${i},'p',this.value)"></td><td><input type="number" min="0" step="any" value="${row.r}" placeholder="0.00" oninput="upd(${i},'r',this.value)"></td><td class="amt">${calcAmt(row)}</td><td><button class="rm" onclick="delRow(${i})">×</button></td>`;tb.appendChild(tr);});recalc();
}
let stockCategories=[],stockItems=[];
function stockDisplayName(item){const cat=stockCategories.find(c=>c.id===item.categoryId);return cat?`${item.name} (${cat.name})`:item.name;}
async function loadStockDatalist(){
  try{
    const [catsRes,itemsRes]=await Promise.all([fetch('/api/stock/categories'),fetch('/api/stock/items')]);
    stockCategories=await catsRes.json();stockItems=await itemsRes.json();
    document.getElementById('stock-items-datalist').innerHTML=stockItems.map(it=>`<option value="${stockDisplayName(it)}">`).join('');
  }catch(err){/* stock module optional; billing works without it */}
}
function matchStockItem(i,value){
  const trimmed=value.trim().toLowerCase();
  const match=stockItems.find(it=>stockDisplayName(it).toLowerCase()===trimmed);
  rows[i].stockItemId=match?match.id:null;
}
```

Note: `addRow()`'s initial row (created by `pickType`/page load, if any) and every row pushed afterward now carries `stockItemId:null` and `_deducted:false` — `upd()` (unchanged, only ever sets `q`/`name`/`p`/`r`) never touches these two fields, so they persist across `upd()` calls as intended.

- [ ] **Step 4: Add the "Deduct from Stock" button and note to `#s4`**

Replace:
```html
  <div class="step" id="s4">
    <div class="print-note">✓ Ready · <strong>A5 (2 copies) · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
    <div class="doc-wrap" id="preview-wrap"></div>
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" onclick="reset()">New</button></div>
  </div>
```
with:
```html
  <div class="step" id="s4">
    <div class="print-note">✓ Ready · <strong>A5 (2 copies) · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
    <div class="doc-wrap" id="preview-wrap"></div>
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" onclick="reset()">New</button></div>
    <div class="print-note" id="deduct-note" style="display:none"></div>
  </div>
```

- [ ] **Step 5: Wire `generate()` to reset deduction state and show/hide the button**

Replace:
```js
function generate(){
  let sub=0,tq=0;rows.forEach(r=>{const q=parseFloat(r.q)||0,rt=parseFloat(r.r)||0;sub+=q*rt;tq+=q;});
```
with:
```js
function generate(){
  rows.forEach(r=>{r._deducted=false;});
  let sub=0,tq=0;rows.forEach(r=>{const q=parseFloat(r.q)||0,rt=parseFloat(r.r)||0;sub+=q*rt;tq+=q;});
```

Replace:
```js
  document.getElementById('print-area').innerHTML=prh;go(4);
}
```
with:
```js
  document.getElementById('print-area').innerHTML=prh;go(4);updateDeductButton();
}
function updateDeductButton(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  note.style.display='none';
  const matched=rows.filter(r=>r.stockItemId);
  if(dtype==='Invoice'&&matched.length){
    btn.style.display='inline-block';btn.disabled=false;btn.textContent='📦 Deduct from Stock';btn.dataset.deducted='';
  }else{
    btn.style.display='none';
  }
}
async function deductStock(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  if(btn.dataset.deducted==='true')return;
  const pending=rows.filter(r=>r.stockItemId&&(parseFloat(r.q)||0)>0&&!r._deducted);
  if(!pending.length)return;
  btn.disabled=true;
  const succeeded=[];let failure=null;
  for(const r of pending){
    const kg=parseFloat(r.q)||0;
    try{
      const res=await fetch(`/api/stock/items/${r.stockItemId}/deduct`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kg,note:'Chitti/Invoice'})});
      const body=await res.json();
      if(!res.ok)throw new Error(body.error||'Deduct failed');
      r._deducted=true;succeeded.push(`${kg}kg ${r.name}`);
    }catch(err){failure=err.message;break;}
  }
  note.style.display='block';
  if(failure){
    btn.disabled=false;
    note.style.background='#fef2f2';note.style.borderColor='#fecaca';note.style.color='#991b1b';
    note.textContent=`Error: ${failure}.${succeeded.length?` Already deducted: ${succeeded.join('; ')}.`:''} Click again to retry the rest.`;
  }else{
    btn.dataset.deducted='true';btn.textContent='✓ Stock Deducted';
    note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';
    note.textContent=`Deducted: ${succeeded.join('; ')}.`;
  }
}
```

- [ ] **Step 6: Call `loadStockDatalist()` on page load**

Replace the very end of the file:
```js
  recalc();go(2);
}
</script></body></html>
```
with:
```js
  recalc();go(2);
}
loadStockDatalist();
</script></body></html>
```

- [ ] **Step 7: Sync to `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
```

- [ ] **Step 8: Verify via Claude-in-Chrome**

Ensure the dev server from Task 4 is still running (restart with the same command if not: `cd ".../app" && PORT=3302 STOCK_DATA_PATH=/private/tmp/claude-501/-Users-vanshjalan/ns-stock-manual/stock.json node server.js > /tmp/ns-stock-dev-server.log 2>&1 &`).

Using the Claude-in-Chrome tools: navigate to `http://localhost:3302/final-invoice-NS.html`. Click "🧾 Invoice / Chitti" → "Continue →". In the first item row's Particulars field, type `TMT 12mm Bar (TMT Bars)` (the exact datalist display string for the item created in Task 3 — confirm the datalist actually offers this by checking the `<datalist>`'s rendered `<option>` values via the JS execution tool: `document.getElementById('stock-items-datalist').innerHTML`). Enter `50` in Qty (kg). Fill customer name/date with any sample values. Click "Generate Document".

Confirm on the `#s4` preview screen: a "📦 Deduct from Stock" button is visible (since the row matched a stock item and `dtype==='Invoice'`). Click it. Confirm the note below turns green and reads "Deducted: 50kg TMT 12mm Bar (TMT Bars)." and the button becomes disabled reading "✓ Stock Deducted".

Confirm the effect server-side — run via the JS execution tool or `curl`:
```bash
curl -s http://localhost:3302/api/stock/items | python3 -c "import json,sys; items=json.load(sys.stdin); print([i for i in items if i['name']=='TMT 12mm Bar'][0]['currentStockKg'])"
```
Expected: `-70`. Tracing the cumulative effect of every manual verification step against this same scratch data file so far: Task 3 Step 4 created TMT 12mm Bar at `105`, stocked in `+50` → `155`, then adjusted to `-20` → `-20`. This step deducts a further `50` → `-20 - 50 = -70`. (The negative value is expected and correct — it's the same "allowed, not blocked" behavior verified in Task 3, just reached via a different path this time.)

Click "🖨 Print / Save PDF"'s neighboring "← Edit" button to go back, then "Generate Document" again without changing anything. Confirm the "📦 Deduct from Stock" button re-appears enabled (not disabled) — per this task's design, a fresh Generate is treated as a new invoice attempt. Do **not** click it again in this verification (avoid further mutating the manual test data); this step is a visual confirmation only.

Also confirm the negative-scope guarantee: switch document type to "📋 Quotation" or "🚚 Delivery Challan" from the start and confirm no "Deduct from Stock" button ever appears for those flows (the button's `display` stays `none` since `updateDeductButton()` is only invoked from the Chitti `generate()` path — Quotation uses `qGenerate()`/`qOpen()`, Challan uses `go(3)`'s iframe branch, neither calls `updateDeductButton()`).

- [ ] **Step 9: Stop the dev server**

```bash
pkill -f "STOCK_DATA_PATH=/private/tmp/claude-501/-Users-vanshjalan/ns-stock-manual/stock.json"
```

- [ ] **Step 10: Commit**

```bash
cd /Users/vanshjalan && git add \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" \
  "Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/final-invoice-NS.html"
git commit -m "$(cat <<'EOF'
feat(narayani-steels): auto-deduct stock from the Chitti/Invoice flow

EOF
)"
```

---

## Deferred (not in this plan)

- **Excel bulk import script** (`app/scripts/import-stock.js`) — out of scope until Vansh sends the item-list Excel file, per the design doc. Scope it as a separate follow-up plan once the file's actual sheet/column layout is known.
- **Shop PC deployment** — this plan only covers local implementation and verification on the dev Mac. Redeploying to the shop PC (copying `app/` including the new `stockStore.js`/`server.js`/`public/stock.html`, and this time also `app/data/` if real stock data exists locally by then) is a separate live TeamViewer session, following this project's established delivery pattern — not part of this plan.
