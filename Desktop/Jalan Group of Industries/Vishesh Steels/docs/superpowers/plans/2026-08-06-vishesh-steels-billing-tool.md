# Vishesh Steels Billing Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Vansh Iron/Narayani stock-tracked billing architecture to Vishesh Steels (currently a stock-less static `final-invoice-VS.html`), with a stock-deduction flow that stays correct and legible when staff run several invoices across multiple browser tabs at once.

**Architecture:** A local Node/Express backend (`server.js` + `stockStore.js` + `balanceSheetStore.js`, reused from Vansh Iron with only branding/port changes) serves `data/stock.json` via `/api/stock/*`, plus a `public/` folder of HTML pages. The existing `final-invoice-VS.html` gets its duplicate dead code removed and gains stock-linking, live-refreshing stock display, and a deduct-with-warning flow — wired to the **A6 "QUOTATION — Valid for 2 Hours" slip** (the `rows`-based flow, reached today via the on-screen button labeled **"Mini Quotation"** — the labels are swapped from what they describe and are being left as-is per explicit decision, so wiring goes by function not by label).

**Tech Stack:** Node.js ≥18, Express 4, vanilla JS/HTML (no build step, no frontend framework), Node's built-in `node --test` for backend store tests.

## Global Constraints

- No stock deduction on the A4 "Description/Make/Qty(MT)" document (reached via the on-screen "Quotation" button) — it is non-binding and must never call `/api/stock/*` write routes.
- Deduction only ever happens on an explicit user click of "📦 Deduct from Stock" — never automatically while typing or on print.
- Stock is allowed to go negative; the system warns, never hard-blocks (per confirmed design).
- No new test framework introduced. Backend logic (`stockStore.js`, `balanceSheetStore.js`) keeps its existing `node --test` coverage, copied unmodified since the logic itself isn't changing. Frontend/HTML changes are verified by running the real server and exercising the flow in a browser (this project's existing convention — it has never had frontend unit tests).
- Stock categories: `TMT Bars`, `MS Pipes`, `MS Rounds`, `Flats`, `Angles`, `Channels`, `Squares`, `Profile Sheets` — seeded with **zero items** (no fabricated catalog; real items get added via the Stock page once deployed).
- Accent color stays Vishesh Steels' existing `#1a2a6e` everywhere, including ported companion pages (do not carry over Vansh Iron's green).
- Port: **3500** (3400 is Vansh Iron).
- No license/self-update gate (Vishesh Steels is Jalan Group's own business).
- Back up `final-invoice-VS.html` before any edit to it.

---

### Task 1: Backend scaffold (`app/` — server, stores, tests)

**Files:**
- Create: `Vishesh Steels/app/server.js` (copied from `Vansh Iron /app/server.js`, then edited)
- Create: `Vishesh Steels/app/stockStore.js` (copied verbatim from `Vansh Iron /app/stockStore.js`)
- Create: `Vishesh Steels/app/balanceSheetStore.js` (copied verbatim from `Vansh Iron /app/balanceSheetStore.js`)
- Create: `Vishesh Steels/app/stockStore.test.js` (copied verbatim from `Vansh Iron /app/stockStore.test.js`)
- Create: `Vishesh Steels/app/balanceSheetStore.test.js` (copied verbatim from `Vansh Iron /app/balanceSheetStore.test.js`)
- Create: `Vishesh Steels/app/package.json`

**Interfaces:**
- Produces: `POST/GET /api/stock/*` and `GET/PUT /api/balance-sheet/:date` (+ `/pdf`) routes on `http://127.0.0.1:3500`, identical contract to Vansh Iron's (see `Vansh Iron /app/server.js` lines 74-150 and 156-283 for the full route list — unchanged, do not modify route logic, only the four VI-specific strings below).

- [ ] **Step 1: Copy the four backend files verbatim**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels"
mkdir -p app/data app/public
cp "../Vansh Iron /app/stockStore.js" app/stockStore.js
cp "../Vansh Iron /app/balanceSheetStore.js" app/balanceSheetStore.js
cp "../Vansh Iron /app/stockStore.test.js" app/stockStore.test.js
cp "../Vansh Iron /app/balanceSheetStore.test.js" app/balanceSheetStore.test.js
cp "../Vansh Iron /app/server.js" app/server.js
cp "../Vansh Iron /app/package-lock.json" app/package-lock.json
```

- [ ] **Step 2: Edit `app/server.js` — the only 5 lines that need to change**

Find and replace exactly these occurrences (everything else in the file, including all `/api/stock/*` and `/api/balance-sheet/*` route handlers, stays untouched):

| Line (in VI's copy) | Old | New |
|---|---|---|
| `const PORT = ...` | `process.env.PORT \|\| 3400` | `process.env.PORT \|\| 3500` |
| `app.get('/', ...)` | `res.redirect('/final-invoice-VI.html')` | `res.redirect('/final-invoice-VS.html')` |
| PDF title row | `<div class="hindi">Vansh Iron</div>` | `<div class="hindi">Vishesh Steels</div>` |
| temp file prefix (×2) | `` `vi-balance-sheet-${day.date}.html` `` / `.pdf` | `` `vs-balance-sheet-${day.date}.html` `` / `.pdf` |
| startup banner | `` console.log(`Vansh Iron — Billing Tool`) `` | `` console.log(`Vishesh Steels — Billing Tool`) `` |

- [ ] **Step 3: Write `app/package.json`**

```json
{
  "name": "vishesh-steels-tool",
  "version": "1.0.0",
  "description": "Billing tool (Quotation / Mini Quotation / Delivery Challan / Stock / Reports / Balance Sheet) for Vishesh Steels",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "ISC"
}
```

- [ ] **Step 4: Install dependencies and run the inherited tests**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app"
npm install
npm test
```

Expected: all tests from `stockStore.test.js` and `balanceSheetStore.test.js` PASS (same count as Vansh Iron's — these test the store logic, which is byte-identical).

- [ ] **Step 5: Sanity-check the server boots on the new port**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app"
PORT=3500 node server.js &
sleep 1
curl -s http://127.0.0.1:3500/api/stock/categories
kill %1
```

Expected: JSON array output (empty `[]` is fine at this point — no `data/stock.json` exists yet, so `stockStore`'s `load()` will auto-create one seeded from its internal `PRESET_CATEGORIES` fallback; Task 2 replaces it with VS's real categories).

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/app/server.js" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/stockStore.js" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/balanceSheetStore.js" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/stockStore.test.js" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/balanceSheetStore.test.js" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/package.json" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/package-lock.json"
git commit -m "feat(vishesh-steels): backend scaffold (stock + balance-sheet stores, port 3500)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Seed VS stock categories

**Files:**
- Create: `Vishesh Steels/app/data/stock.json`

**Interfaces:**
- Consumes: `stockStore.js`'s on-disk shape — `{ categories: [{id, name}], items: [], movements: [] }` (see `Vansh Iron /app/stockStore.js` lines 26-56, `load()`).
- Produces: 8 pre-seeded categories with zero items, so `stock.html` (Task 3) has category pills to file items under from day one.

- [ ] **Step 1: Write the seed file directly** (bypasses `stockStore.js`'s internal `PRESET_CATEGORIES` fallback, which is Narayani's list and is intentionally left untouched in `stockStore.js` itself — matching how Vansh Iron's real seed also came from a hand-written `data/stock.json`, not from editing the store's fallback constant)

```json
{
  "categories": [
    { "id": "cat_tmt_bars", "name": "TMT Bars" },
    { "id": "cat_ms_pipes", "name": "MS Pipes" },
    { "id": "cat_ms_rounds", "name": "MS Rounds" },
    { "id": "cat_flats", "name": "Flats" },
    { "id": "cat_angles", "name": "Angles" },
    { "id": "cat_channels", "name": "Channels" },
    { "id": "cat_squares", "name": "Squares" },
    { "id": "cat_profile_sheets", "name": "Profile Sheets" }
  ],
  "items": [],
  "movements": []
}
```

Save to `Vishesh Steels/app/data/stock.json`.

- [ ] **Step 2: Verify it loads correctly**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app"
PORT=3500 node server.js &
sleep 1
curl -s http://127.0.0.1:3500/api/stock/categories
kill %1
```

Expected: JSON array of exactly the 8 categories above (confirms the hand-written seed, not the store's internal fallback, is what loaded).

- [ ] **Step 3: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/app/data/stock.json"
git commit -m "feat(vishesh-steels): seed stock categories

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Companion pages — Stock, Reports, Balance Sheet (rebrand port)

**Files:**
- Create: `Vishesh Steels/app/public/stock.html` (from `Vansh Iron /app/public/stock.html`)
- Create: `Vishesh Steels/app/public/reports.html` (from `Vansh Iron /app/public/reports.html`)
- Create: `Vishesh Steels/app/public/balance-sheet.html` (from `Vansh Iron /app/public/balance-sheet.html`)

**Interfaces:**
- Consumes: `/api/stock/*` and `/api/balance-sheet/*` routes from Task 1 (unchanged contract).
- Produces: three browsable pages, cross-linked to each other and back to `final-invoice-VS.html` (Task 6 finalizes that back-link once the invoice file is rebuilt).

- [ ] **Step 1: Copy the three files**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app/public"
cp "../../../Vansh Iron /app/public/stock.html" stock.html
cp "../../../Vansh Iron /app/public/reports.html" reports.html
cp "../../../Vansh Iron /app/public/balance-sheet.html" balance-sheet.html
```

- [ ] **Step 2: Rebrand each file — name, title, back-links, accent color**

Run these substitutions on all three files (each file may use a slightly different green shade — `stock.html` uses `#0d3b2b`, `reports.html`/`balance-sheet.html` use `#143a2b` — replace whichever is present with VS's `#1a2a6e`):

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app/public"
for f in stock.html reports.html balance-sheet.html; do
  sed -i '' \
    -e 's/Vansh Iron/Vishesh Steels/g' \
    -e 's/#0d3b2b/#1a2a6e/g' \
    -e 's/#143a2b/#1a2a6e/g' \
    -e 's/final-invoice-VI\.html/final-invoice-VS.html/g' \
    "$f"
done
```

- [ ] **Step 3: Verify no Vansh Iron / green residue remains**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app/public"
grep -n "Vansh Iron\|#0d3b2b\|#143a2b\|final-invoice-VI" stock.html reports.html balance-sheet.html
```

Expected: no output (empty grep match = clean).

- [ ] **Step 4: Manual browser check**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app"
PORT=3500 node server.js &
```

Open `http://127.0.0.1:3500/stock.html`, `.../reports.html`, `.../balance-sheet.html` in a browser. Confirm: title bar and page heading say "Vishesh Steels", accent color on buttons/pills is navy (`#1a2a6e`) not green, the 8 seeded categories appear on the Stock page, and "← Back to Billing" links resolve (they'll 404 until Task 6 — that's expected at this point). Stop the server (`kill %1`) when done.

- [ ] **Step 5: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/stock.html" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/reports.html" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/balance-sheet.html"
git commit -m "feat(vishesh-steels): port Stock/Reports/Balance Sheet pages, rebranded to VS navy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Relocate Delivery Challan into the app

**Files:**
- Create: `Vishesh Steels/app/public/delivery_challan.html` (from `Vishesh Steels/Delivery Challan/delivery_challan.html` and its `stamp.jpeg`)

**Interfaces:**
- None — this page is standalone paperwork, does not call `/api/stock/*` (per Global Constraints: challan never deducts).

- [ ] **Step 1: Copy the file and its stamp image into the served app**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels"
cp "Delivery Challan/delivery_challan.html" app/public/delivery_challan.html
cp "Delivery Challan/stamp.jpeg" app/public/Stamp.jpeg
```

(Capitalization matches the existing `<img src="Stamp.jpeg">` reference inside the file — verify with `grep -n "src=" app/public/delivery_challan.html` and adjust the copied filename's case if it doesn't match exactly.)

- [ ] **Step 2: Verify it already carries correct VS branding (no edits expected)**

```bash
grep -n "Vishesh Steels\|Vansh Iron\|#143a2b\|#0d3b2b" "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app/public/delivery_challan.html"
```

Expected: only "Vishesh Steels" hits, no Vansh Iron / green-accent residue (this file was the original VS template Vansh Iron's own challan was adapted from, so it should need no changes).

- [ ] **Step 3: Manual check** — open `http://127.0.0.1:3500/delivery_challan.html` (server from Task 3 Step 4, or restart it), confirm it renders and the stamp image loads.

- [ ] **Step 4: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/delivery_challan.html" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/Stamp.jpeg"
git commit -m "feat(vishesh-steels): relocate Delivery Challan generator into the served app

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Back up and dedupe `final-invoice-VS.html`

**Files:**
- Create: `Vishesh Steels/final-invoice-VS.BACKUP-20260806.html` (snapshot before any edit)
- Modify: `Vishesh Steels/final-invoice-VS.html`

**Interfaces:**
- Produces: a `final-invoice-VS.html` with exactly one definition each of `qAddRow`, `qRender`, `qAmt`, `qUpd`, `qDel`, `qRecalc`, `qFmt`, `qGenerate`, `qOpen`, `reset` (currently defined 4×, 3×, or 2× depending on the function — see spec's "Cleanup" section) and identical runtime behavior to before.

- [ ] **Step 1: Snapshot before touching anything**

```bash
cp "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html" \
   "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.BACKUP-20260806.html"
```

- [ ] **Step 2: Confirm the current duplicate ranges before editing**

```bash
grep -n "^function qAddRow\|^function reset" "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
```

Expected (from prior exploration — confirm line numbers still match, they may have drifted if anything upstream changed): `qAddRow` defined at 4 line numbers, `reset` at 2. Read the full script block (`sed -n '159,315p' final-invoice-VS.html`) to see the exact current boundaries.

- [ ] **Step 3: Delete the duplicate blocks, keeping only the first, fully-working copy of each function**

Working from the bottom of the file upward (so earlier line numbers don't shift under you), delete every repeated `function qAddRow(){...}` / `qRender` / `qAmt` / `qUpd` / `qDel` / `qRecalc` / `qFmt` / `qGenerate` / `qOpen` / `reset` block after the first occurrence of each. Use the Edit tool with enough surrounding context per block to target it uniquely (the duplicate blocks are byte-identical to each other in most cases, so anchor each `old_string` on the full block text, not just the function signature, and remove one full duplicate at a time).

- [ ] **Step 4: Verify no duplicates remain and the file still parses as valid JS**

```bash
grep -c "^function qAddRow" "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
grep -c "^function reset" "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
node -e "
const fs = require('fs');
const html = fs.readFileSync('/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
new Function(script);
console.log('OK: script block is syntactically valid');
"
```

Expected: both `grep -c` counts print `1`; the `node -e` check prints `OK` with no `SyntaxError`.

- [ ] **Step 5: Manual regression check — quotation flow still works exactly as before**

```bash
open "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
```

Click "📋 Quotation" → fill customer/items → "Generate Quotation" → "Open & Print Quotation". Confirm the A4 document opens in a new tab with the correct items/totals, same as before the dedup (this flow's behavior must be byte-for-byte unchanged — only dead duplicate code was removed).

- [ ] **Step 6: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.BACKUP-20260806.html"
git commit -m "refactor(vishesh-steels): dedupe 4x-repeated quotation JS in final-invoice-VS.html

No behavior change — collapses qAddRow/qRender/qAmt/qUpd/qDel/qRecalc/qFmt/
qGenerate/qOpen/reset down to one definition each. Backup snapshot included.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire stock linking into the sale-slip flow (the "Mini Quotation" button)

**Files:**
- Modify: `Vishesh Steels/final-invoice-VS.html`

**Interfaces:**
- Consumes: `GET /api/stock/categories`, `GET /api/stock/items` from Task 1.
- Produces: module-level `stockCategories`, `stockItems`, `stockLoadFailed` — consumed by Task 7 (live refresh) and Task 8 (deduct).

- [ ] **Step 1: Add the stock-datalist markup**

In the `<body>`, right after `<div class="wrap">`, add (this list is populated by `loadStockDatalist()` below):

```html
<datalist id="stock-items-datalist"></datalist>
```

- [ ] **Step 2: Add a module-warning banner** near the top of `.wrap`, right after the datalist:

```html
<div id="module-warn-banner" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px"></div>
```

- [ ] **Step 3: Add the stock-loading and item-matching JS**, immediately after the existing `function upd(i,f,v){...}` definition (this is the exact pattern from `Vansh Iron /app/public/final-invoice-VI.html` lines 226-276, adapted to VS's row shape which has no `dualTrack`/`pcs`-only special-casing beyond what's already generic in `stockStore`):

```js
let stockCategories=[],stockItems=[];
function stockDisplayName(item){const cat=stockCategories.find(c=>c.id===item.categoryId);const base=cat?`${item.name} (${cat.name})`:item.name;return item.unit==='pcs'?`${base} — sold by piece`:base;}
let stockLoadFailed=false;
function updateModuleWarnBanner(){
  const banner=document.getElementById('module-warn-banner');
  const msgs=[];
  if(stockLoadFailed)msgs.push('Stock module failed to load — items will NOT be linked to stock or deducted this session. Open this page via the running local server (not by double-clicking the file) and reload to retry.');
  banner.style.display=msgs.length?'block':'none';
  banner.textContent=msgs.length?'⚠ '+msgs.join(' ⚠ '):'';
}
async function loadStockDatalist(){
  try{
    const [catsRes,itemsRes]=await Promise.all([fetch('/api/stock/categories'),fetch('/api/stock/items')]);
    if(!catsRes.ok||!itemsRes.ok)throw new Error('Stock API returned an error');
    stockCategories=await catsRes.json();
    stockItems=await itemsRes.json();
    document.getElementById('stock-items-datalist').innerHTML=stockItems.map(it=>`<option value="${stockDisplayName(it)}">`).join('');
    stockLoadFailed=false;
  }catch(err){
    stockLoadFailed=true;
  }
  updateModuleWarnBanner();
}
function matchStockItem(i,value){
  const trimmed=value.trim().toLowerCase();
  let match=stockItems.find(it=>stockDisplayName(it).toLowerCase()===trimmed);
  if(!match){
    const byBareName=stockItems.filter(it=>it.name.trim().toLowerCase()===trimmed);
    if(byBareName.length===1)match=byBareName[0];
  }
  rows[i].stockItemId=match?match.id:null;
  if(match){
    rows[i].name=match.name;
    const inp=document.getElementById('tbody').children[i]?.children[1]?.querySelector('input');
    if(inp)inp.value=match.name;
  }
  updateStockBadge(i);
}
function updateStockBadge(i){
  const badge=document.getElementById('stockbadge-'+i);
  if(!badge)return;
  const row=rows[i];
  const hasQty=(parseFloat(row.q)||0)>0||(parseFloat(row.p)||0)>0;
  if(!row.name.trim()||!hasQty){badge.textContent='';badge.title='';return;}
  if(!row.stockItemId){badge.textContent='⚠';badge.title='Not linked to a stock item — will NOT be deducted from stock. Pick the item from the dropdown suggestions to link it.';return;}
  const item=stockItems.find(it=>it.id===row.stockItemId);
  if(item&&item.dualTrack&&!rowDeductable(row)){
    badge.textContent='⚠';badge.title='This item tracks both Pieces and Kg — fill in both Qty(kg) and Pcs before it can be deducted.';return;
  }
  badge.textContent='🔗';badge.title='Linked to stock — will be deducted';
}
function rowDeductable(row){
  if(!row.stockItemId)return false;
  const item=stockItems.find(it=>it.id===row.stockItemId);
  if(!item)return false;
  if(item.dualTrack)return(parseFloat(row.q)||0)>0&&(parseFloat(row.p)||0)>0;
  return(parseFloat(row.q)||0)>0;
}
```

- [ ] **Step 4: Give each row an `stockItemId` field and wire the item-name input to `matchStockItem`**

Replace the existing `addRow` and the item-picker `<td>` inside `renderRows`:

```js
function addRow(){rows.push({q:'',name:'',p:'',r:'',stockItemId:null});renderRows();}
```

In `renderRows()`, replace this cell:
```js
<td><input type="text" value="${row.name}" placeholder="Item" oninput="upd(${i},'name',this.value)"></td>
```
with:
```js
<td style="position:relative"><input type="text" list="stock-items-datalist" value="${row.name}" placeholder="Item" style="padding-right:20px" oninput="upd(${i},'name',this.value);matchStockItem(${i},this.value)"><span id="stockbadge-${i}" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:12px;pointer-events:none"></span></td>
```

And at the end of `renderRows()` (after the `tb.appendChild(tr)` loop, before `recalc()`), add:
```js
rows.forEach((row,i)=>updateStockBadge(i));
```

Also update `delRow`'s reset-to-empty fallback to include the new field: `rows.push({q:'',name:'',p:'',r:'',stockItemId:null})`.

- [ ] **Step 5: Call `loadStockDatalist()` on page load**

Add right before the closing `</script>` tag (or in an existing DOMContentLoaded-equivalent spot if one exists — check first with `grep -n "DOMContentLoaded\|onload" final-invoice-VS.html`):

```js
loadStockDatalist();
```

- [ ] **Step 6: Manual check**

Start the server (`PORT=3500 node app/server.js` from the `Vishesh Steels/app` directory — note the top-level `final-invoice-VS.html` isn't served by this app yet, so for this check open `http://127.0.0.1:3500/final-invoice-VS.html` only after Task 9 copies it into `app/public/`; until then, manually copy the current work-in-progress file into `app/public/final-invoice-VS.html` to test against the running server). In `stock.html`, add one test item (e.g. "12mm" under TMT Bars, 500kg). Reload the invoice page, click "Mini Quotation" → in the Items table, type "12mm" in the Particulars box — confirm the datalist suggests it and selecting it shows a 🔗 badge once a quantity is entered.

- [ ] **Step 7: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
git commit -m "feat(vishesh-steels): link invoice item rows to stock items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Live-refreshing stock display

**Files:**
- Modify: `Vishesh Steels/final-invoice-VS.html`

**Interfaces:**
- Consumes: `loadStockDatalist()`, `stockItems` from Task 6.
- Produces: `startStockRefresh()`, `stopStockRefresh()` — consumed by Task 9 (wired into `go()`/`reset()`).

- [ ] **Step 1: Add the polling functions**, right after `loadStockDatalist()`:

```js
let stockRefreshTimer=null;
const STOCK_REFRESH_MS=30000;
function startStockRefresh(){
  stopStockRefresh();
  stockRefreshTimer=setInterval(async()=>{
    await loadStockDatalist();
    rows.forEach((row,i)=>updateStockBadge(i));
  },STOCK_REFRESH_MS);
}
function stopStockRefresh(){
  if(stockRefreshTimer){clearInterval(stockRefreshTimer);stockRefreshTimer=null;}
}
```

- [ ] **Step 2: Start/stop the poll on entering/leaving the sale-slip item step**

In `go(n)`, the branch that shows step `s3` for the sale-slip flow is the `else` path (when `dtype!=='Quotation'`, i.e. the "Mini Quotation" button — see Global Constraints for why). Add the start/stop calls so polling only runs while that step is visible:

```js
function go(n){
  document.querySelectorAll('.step').forEach(function(s){s.classList.remove('active');});
  if(n===3&&dtype==='Quotation'){stopStockRefresh();document.getElementById('s5').classList.add('active');if(qRows.length===0)qAddRow();window.scrollTo(0,0);return;}
  document.getElementById('s'+n).classList.add('active');
  if(n===3&&rows.length===0)addRow();
  if(n===3)startStockRefresh();else stopStockRefresh();
  window.scrollTo(0,0);
}
```

- [ ] **Step 3: Also stop the timer in `reset()`** (add as the first line of the function body, alongside the existing `rows=[];dtype='';qRows=[];`):

```js
stopStockRefresh();
```

- [ ] **Step 4: Manual check — two-tab staleness scenario**

With the server running and one stock item seeded at, say, 500kg: open the invoice page in **two browser tabs**. In Tab A, go to "Mini Quotation" → items step (polling starts). In `stock.html` in a third tab, do a manual "Stock In" adjustment (or deduct via Tab B's flow once Task 8 lands) to change the item's quantity. Wait up to 30s — confirm Tab A's item-picker/badge state reflects the change without a manual reload (the datalist option text includes nothing about live quantity yet by itself — this step primarily confirms the poll fires and `stockItems` updates; the visible proof comes together with Task 8's fresh-check warning).

- [ ] **Step 5: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
git commit -m "feat(vishesh-steels): poll stock every 30s while building a sale slip

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Deduct-from-stock button with fresh-check + soft negative-stock warning

**Files:**
- Modify: `Vishesh Steels/final-invoice-VS.html`

**Interfaces:**
- Consumes: `rowDeductable(row)`, `stockItems`, `loadStockDatalist()` from Tasks 6-7.
- Produces: `deductStock()` (bound to the new button's `onclick`), `performStockDeduction()` — no other task depends on these being named anything else.

- [ ] **Step 1: Add the button and note area to step `s4`** (the print/preview step), matching Vansh Iron's placement — insert `<button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button>` between the existing "🖨 Print / Save PDF" and "New" buttons in `s4`'s `.acts` div, and add a note div right after `.acts`:

```html
<div class="print-note" id="deduct-note" style="display:none"></div>
```

- [ ] **Step 2: Show the button whenever `generate()` runs**, and reset its state each time (append to the end of `generate()`, replacing the current final line `document.getElementById('print-area').innerHTML=prh;go(4);` with):

```js
  document.getElementById('print-area').innerHTML=prh;
  rows.forEach(r=>{r._deducted=false;});
  go(4);
  updateDeductButton();
}
function updateDeductButton(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  note.style.display='none';
  const matched=rows.filter(r=>r.stockItemId);
  if(matched.length){
    btn.style.display='inline-block';btn.disabled=false;btn.textContent='📦 Deduct from Stock';btn.dataset.deducted='';
  }else{
    btn.style.display='none';
  }
}
```

This replaces `generate()`'s old final line (`document.getElementById('print-area').innerHTML=prh;go(4);`) plus its closing `}`. The first `}` in the block above closes `generate()`; `updateDeductButton` is then declared as a full, separately-closed function right after it — verify with the brace-balance check in Step 3's `node -e` snippet (extend it to cover this edit too) that the script block still parses.

- [ ] **Step 3: Add the fresh-check-then-warn-then-deduct flow**, after `updateDeductButton()`:

```js
async function performStockDeduction(){
  const pending=rows.filter(r=>rowDeductable(r)&&!r._deducted);
  const succeeded=[];let failure=null;
  for(const r of pending){
    const item=stockItems.find(it=>it.id===r.stockItemId);
    const body={note:'Sale slip'};
    let label;
    if(item.dualTrack){
      body.kg=parseFloat(r.q)||0;body.pcs=parseFloat(r.p)||0;
      label=`${body.pcs} pcs / ${body.kg}kg ${r.name}`;
    }else{
      const qty=parseFloat(r.q)||0;
      body.kg=qty;
      label=`${qty}kg ${r.name}`;
    }
    try{
      const res=await fetch(`/api/stock/items/${r.stockItemId}/deduct`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const resBody=await res.json();
      if(!res.ok)throw new Error(resBody.error||'Deduct failed');
      r._deducted=true;succeeded.push(label);
    }catch(err){failure=err.message;break;}
  }
  return{succeeded,failure};
}
function projectedNegatives(freshItems){
  const pending=rows.filter(r=>rowDeductable(r)&&!r._deducted);
  const byId={};
  pending.forEach(r=>{
    const item=freshItems.find(it=>it.id===r.stockItemId);
    if(!item)return;
    const deductKg=item.dualTrack?(parseFloat(r.q)||0):(parseFloat(r.q)||0);
    const current=byId[r.stockItemId]?byId[r.stockItemId].projected:item.currentStockKg;
    const projected=current-deductKg;
    byId[r.stockItemId]={name:item.name,current:item.currentStockKg,deductKg,projected};
  });
  return Object.values(byId).filter(v=>v.projected<0);
}
async function runDeduction(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  btn.disabled=true;
  const{succeeded,failure}=await performStockDeduction();
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
async function deductStock(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  if(btn.dataset.deducted==='true')return;
  const hasPending=rows.some(r=>rowDeductable(r)&&!r._deducted);
  if(!hasPending)return;
  btn.disabled=true;
  await loadStockDatalist();
  const negatives=projectedNegatives(stockItems);
  btn.disabled=false;
  if(negatives.length){
    note.style.display='block';
    note.style.background='#fffbeb';note.style.borderColor='#fde68a';note.style.color='#92400e';
    const lines=negatives.map(n=>`${n.name}: only ${n.current}kg left, this deducts ${n.deductKg}kg`).join('; ');
    note.innerHTML=`⚠ Stock would go negative — ${lines}. `+
      `<button class="btn-s" style="margin:4px 6px 0 0" onclick="runDeduction()">Deduct Anyway</button>`+
      `<button class="btn-s" style="margin:4px 0 0 0" onclick="document.getElementById('deduct-note').style.display='none'">Cancel</button>`;
    return;
  }
  await runDeduction();
}
```

- [ ] **Step 4: Verify the script block still parses**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
new Function(script);
console.log('OK: script block is syntactically valid');
"
```

Expected: `OK`, no `SyntaxError`. Run this after every sub-step in this task that edits the `<script>` block, not just once at the end — it's the fastest way to catch a brace-matching slip like the one this plan's own self-review caught in Step 2 before it reaches manual browser testing.

- [ ] **Step 5: Manual check — the warning path**

Seed a stock item at a small quantity (e.g. 10kg). Build a sale slip deducting 60kg of it. Click "📦 Deduct from Stock" — confirm the amber warning appears with the correct current/deduct numbers and does **not** deduct yet. Click "Deduct Anyway" — confirm it now succeeds and the stock item's `currentStockKg` in `stock.html` shows `-50`.

- [ ] **Step 6: Manual check — the clean path**

Seed a stock item with plenty of stock (e.g. 500kg). Build a sale slip deducting 60kg. Click "📦 Deduct from Stock" — confirm it deducts immediately with no warning, button becomes "✓ Stock Deducted" and is disabled against double-click.

- [ ] **Step 7: Manual check — idempotency across a retry**

Stop the server mid-deduction (kill it right after clicking deduct on a 2+ item slip) to force a failure note, restart the server, click the deduct button again — confirm only the still-pending (not-yet-`_deducted`) rows get deducted, not the ones that already succeeded before the interruption.

- [ ] **Step 8: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html"
git commit -m "feat(vishesh-steels): deduct-from-stock button with fresh-check negative-stock warning

Re-fetches live stock immediately before deducting and warns (without
blocking) if any item would go negative — closes the staleness gap between
tabs while keeping the existing safe-under-concurrency write path.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Nav links, app wiring, top-level file sync

**Files:**
- Modify: `Vishesh Steels/final-invoice-VS.html`
- Create: `Vishesh Steels/app/public/final-invoice-VS.html` (copy of the finished top-level file)

**Interfaces:**
- None new — this task connects Tasks 1-8 into one servable app.

- [ ] **Step 1: Add Stock/Reports/Balance Sheet/Delivery Challan links to step `s2`**

Inside the `s2` card, after the existing `grid2` of "Quotation"/"Mini Quotation" buttons and before the `.acts` div, add:

```html
<div class="grid2" style="margin-top:10px">
  <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
  <a class="type-btn" href="reports.html" style="text-decoration:none;display:block"><div class="tl">📊 Reports</div></a>
  <a class="type-btn" href="balance-sheet.html" style="text-decoration:none;display:block"><div class="tl">🧮 Balance Sheet</div></a>
  <a class="type-btn" href="delivery_challan.html" style="text-decoration:none;display:block"><div class="tl">🚚 Delivery Challan</div></a>
</div>
```

- [ ] **Step 2: Copy the finished file into `app/public/`**

```bash
cp "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html" \
   "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app/public/final-invoice-VS.html"
```

- [ ] **Step 3: Full end-to-end manual walkthrough**

```bash
cd "/Users/vanshjalan/Desktop/Jalan Group of Industries/Vishesh Steels/app"
PORT=3500 node server.js &
```

Open `http://127.0.0.1:3500/final-invoice-VS.html`. Walk the entire flow once: pick "Mini Quotation" → fill customer + a stock-linked item → Generate → confirm the A6 preview and print button work → Deduct from Stock → confirm success note → click "📦 Stock" link → confirm the deduction shows in that item's history → click "📊 Reports" and "🧮 Balance Sheet" → confirm they load with VS branding → click "🚚 Delivery Challan" → confirm it opens. Then separately confirm the "📋 Quotation" button flow (A4, opens in new tab) still works and never touched `/api/stock/*` (check with the Network tab or `read_network_requests` that no `/api/stock` calls fire during that flow).

- [ ] **Step 4: Commit**

```bash
cd /Users/vanshjalan
git add "Desktop/Jalan Group of Industries/Vishesh Steels/final-invoice-VS.html" \
        "Desktop/Jalan Group of Industries/Vishesh Steels/app/public/final-invoice-VS.html"
git commit -m "feat(vishesh-steels): wire companion-page nav links, sync app/public copy

Completes the billing-tool port: Quotation/Mini Quotation/Stock/Reports/
Balance Sheet/Delivery Challan all reachable from one running app on
port 3500, sale-slip stock deduction protected against multi-tab staleness.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
