# Narayani Steels Mobile Billing Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `mobile/index.html`, a single self-contained iPhone-only billing tool for Narayani Steels containing only Quotation and Chitti (single A6 slip), device-locked via a one-time PIN + localStorage token, with no stock/ledger/reports/balance-sheet/challan and no server.

**Architecture:** Start from a literal copy of the current `final-invoice-NS.html` (already contains both Quotation and Chitti, fully working), then surgically remove everything out of scope (Delivery Challan, Stock/Reports/Balance Sheet nav, all stock-linking code in Chitti), convert Chitti's print CSS from Narayani's A5 dual-copy layout to Vansh Iron's single-A6 layout, add a PIN + device-token gate in front of the existing menu, add iOS home-screen meta tags, and add an auto-print trigger to the Quotation's blob print tab. Every task keeps the file loading and working — this is a trim-and-adapt job, not a rewrite.

**Tech Stack:** Plain HTML/CSS/vanilla JS, no framework, no build step, no npm dependencies. Verified via headless Chrome / Claude-in-Chrome (this codebase has no unit-test framework for its single-file HTML billing tools — `final-invoice-NS.html` itself has never had one; `.test.js` files only exist for the Node backend, which this tool deliberately doesn't have).

## Global Constraints

- Deliverable is **one single `.html` file** — no separate `.js`/`.css`/`manifest.json` files, no server, no build step, no npm dependencies (per spec `docs/superpowers/specs/2026-08-10-mobile-billing-tool-design.md`).
- Source file to copy from: `final-invoice-NS.html` at the Narayani Steels project root (NOT `app/public/final-invoice-NS.html` — that copy calls `fetch('/api/stock/...')` against a Node server this tool won't have).
- Destination: `mobile/index.html` in the Narayani Steels client folder (full path: `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile/index.html`).
- Device-lock setup code: `NARAYANI2026` (hardcoded constant near the top of the script — trivially changed later, per spec).
- Company data (GSTIN `36AAWFN9730E1ZR`, address, bank details, letterhead background image) must stay exactly as in the source file — do not alter branding/business data during this port.
- No test framework is introduced for this file. Verification is headless Chrome / Claude-in-Chrome DOM manipulation and print-to-PDF rendering, matching how every other change to this exact file has been verified in this codebase's history.
- Real iPhone/Safari confirmation is out of reach for the implementer (no physical device access) — flag it as pending user verification in the final task, don't claim it as done.

---

### Task 1: Seed the new file from the current NS source

**Files:**
- Create: `mobile/index.html` (copy of `final-invoice-NS.html`)

**Interfaces:**
- Produces: `mobile/index.html` — a byte-identical copy of the current Chitti+Quotation+Challan tool, used as the working base for every later task's diffs.

- [ ] **Step 1: Create the directory and copy the file**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
mkdir -p mobile
cp final-invoice-NS.html mobile/index.html
```

- [ ] **Step 2: Verify it's an exact copy and still valid HTML**

```bash
diff final-invoice-NS.html mobile/index.html && echo "IDENTICAL"
python3 -c "import sys; open('mobile/index.html').read(); print('readable, no encoding errors')"
```

Expected: `IDENTICAL` printed, no Python errors.

- [ ] **Step 3: Commit the baseline**

```bash
git add mobile/index.html
git commit -m "chore(narayani-mobile): seed mobile tool from final-invoice-NS.html"
```

---

### Task 2: Remove Delivery Challan and Stock/Reports/Balance Sheet nav from the menu

**Files:**
- Modify: `mobile/index.html`

**Interfaces:**
- Consumes: `mobile/index.html` from Task 1.
- Produces: a menu (`#s2`) with exactly 2 buttons (Quotation, Invoice/Chitti); no `#s7` step; no `dtype==='Challan'` branch in `go()`.

- [ ] **Step 1: Shrink the doc-type grid to 2 buttons**

Find this block (currently in the `#s2` step) and replace it:

```html
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
      <button class="type-btn" onclick="pickType('Challan',this)"><div class="tl">🚚 Delivery Challan</div></button>
      <a class="type-btn" href="stock.html" style="text-decoration:none;display:block"><div class="tl">📦 Stock</div></a>
      <a class="type-btn" href="reports.html" style="text-decoration:none;display:block"><div class="tl">📊 Reports</div></a>
      <a class="type-btn" href="balance-sheet.html" style="text-decoration:none;display:block"><div class="tl">🧮 Balance Sheet</div></a>
    </div>
```

Replace with:

```html
    <div class="grid2">
      <button class="type-btn" onclick="pickType('Quotation',this)"><div class="tl">📋 Quotation</div></button>
      <button class="type-btn" onclick="pickType('Invoice',this)"><div class="tl">🧾 Invoice / Chitti</div></button>
    </div>
```

- [ ] **Step 2: Remove the Delivery Challan step and iframe**

Delete this entire block:

```html
  <div class="step" id="s7">
    <div class="card" style="padding:0.75rem;margin-bottom:0.75rem">
      <button class="btn-s" onclick="reset()">← Back / New</button>
    </div>
    <iframe src="delivery_challan_NS.html" style="width:100%;height:90vh;border:none;border-radius:8px;"></iframe>
  </div>
```

- [ ] **Step 3: Remove the Challan branch from `go()`**

In `function go(n){...}`, find:

```js
  if(n===3&&dtype==='Challan'){document.getElementById('s7').classList.add('active');window.scrollTo(0,0);return;}
```

Delete that line entirely (the `if(n===3&&dtype==='Quotation'){...s9...}` line right above it stays).

- [ ] **Step 4: Verify with headless Chrome**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -m http.server 8791 &
SERVER_PID=$!
sleep 1
# Load the page, count .type-btn buttons on the menu step, confirm no 'Challan' or 'stock.html'/'reports.html'/'balance-sheet.html' references remain
python3 -c "
import urllib.request
html = urllib.request.urlopen('http://localhost:8791/index.html').read().decode()
assert 'Delivery Challan' not in html, 'Challan button still present'
assert 'stock.html' not in html, 'Stock link still present'
assert 'reports.html' not in html, 'Reports link still present'
assert 'balance-sheet.html' not in html, 'Balance Sheet link still present'
assert html.count('class=\"type-btn\" onclick=\"pickType') == 2, 'expected exactly 2 pickType buttons'
print('OK: menu trimmed to 2 buttons, no dead links')
"
kill $SERVER_PID
```

Expected: `OK: menu trimmed to 2 buttons, no dead links` printed, no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): trim menu to Quotation + Chitti only, remove Challan"
```

---

### Task 3: Strip all stock-linking code from the Chitti section

**Files:**
- Modify: `mobile/index.html`

**Interfaces:**
- Consumes: `mobile/index.html` from Task 2.
- Produces: a Chitti section with plain free-text Particulars (no datalist, no stock badge, no Deduct-from-Stock button), `addRow()` rows without `stockItemId`/`_deducted` fields, `generate()` without the `r._deducted=false` reset line.

This task removes, in full:
- The `#stock-items-datalist` element and `#module-warn-banner` div (in `#s3`)
- The Deduct-from-Stock button and `#deduct-note` div (in `#s4`)
- Functions: `stockDisplayName`, `updateModuleWarnBanner`, `loadStockDatalist`, `matchStockItem`, `updateStockBadge`, `rowStockQty`, `deductStock`, `unmatchedItemNames`, `performStockDeduction`, `updateDeductButton`
- Variables: `stockCategories`, `stockItems`, `stockLoadFailed`
- The trailing `loadStockDatalist();` call before `</script>`
- The `list="stock-items-datalist"` attribute and stock-badge `<span>` inside the per-row template in `renderRows()`
- `stockItemId`/`_deducted` fields from the row object literal in `addRow()`
- The `rows.forEach(r=>{r._deducted=false;});` line at the top of `generate()`

- [ ] **Step 1: Remove the datalist element and warn banner**

Find and delete:
```html
  <datalist id="stock-items-datalist"></datalist>
```
Find and delete the whole banner div (it sits right before `<div class="card"><h3>Items</h3>` in `#s3`):
```html
    <div id="module-warn-banner" style="display:none;background:#fef2f2;border:1.5px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;font-weight:600">
```
(This opening `<div>` has no visible closing tag on its own line in the source — check the following line(s) for its matching `</div>` before deleting the whole element; do not delete more than this one banner div.)

- [ ] **Step 2: Remove the Deduct-from-Stock button and note from `#s4`**

Find:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="dedu
```
(this line is long — locate it via `grep -n 'id="btn-deduct"'`). Replace the whole `.acts` div with:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button></div>
```
Delete the following line entirely:
```html
    <div class="print-note" id="deduct-note" style="display:none"></div>
```

- [ ] **Step 3: Remove the stock functions and variables**

Using `grep -n` to locate each by name in the current file state, delete these top-level declarations in full (each is a single line or single-statement block in this file's style):
- `let stockCategories=[],stockItems=[];`
- `function stockDisplayName(item){...}`
- `let stockLoadFailed=false;`
- `function updateModuleWarnBanner(){...}` (multi-line block, delete through its closing `}`)
- `async function loadStockDatalist(){...}` (multi-line block, delete through its closing `}`)
- `function matchStockItem(i,value){...}` (multi-line block, delete through its closing `}`)
- `function updateStockBadge(i){...}` (multi-line block, delete through its closing `}`)
- `function rowStockQty(row){...}`
- `function rowDeductable(row){...}` (if present — check with grep; it's referenced from `updateStockBadge`, may already be removed with it if adjacent)
- `function deductStock(){...}` (multi-line block)
- `function unmatchedItemNames(){...}` (if present)
- `function performStockDeduction(){...}` (multi-line block)
- `function updateDeductButton(){...}` (multi-line block)
- The trailing `loadStockDatalist();` line right before `</script></body></html>`

- [ ] **Step 4: Clean the row template and `addRow()`/`generate()`**

In `addRow()`, find:
```js
function addRow(){rows.push({q:'',name:'',p:'',r:'',stockItemId:null,_deducted:false});renderRows();}
```
Replace with:
```js
function addRow(){rows.push({q:'',name:'',p:'',r:''});renderRows();}
```

In `renderRows()`, remove `list="stock-items-datalist"` from the Particulars `<input>`, remove any `oninput="matchStockItem(...)"` wiring on that same input, and remove the stock-badge `<span id="stockbadge-${i}">...</span>` from the row template — grep for `stockbadge-` and `matchStockItem(` to find the exact spot in the current file.

In `generate()`, delete the line:
```js
  rows.forEach(r=>{r._deducted=false;});
```

- [ ] **Step 5: Verify zero stock references remain and Chitti still works**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
grep -ic "stock" index.html || echo "0 matches - clean"
python3 -m http.server 8791 &
SERVER_PID=$!
sleep 1
kill $SERVER_PID
```

Expected: `grep -ic "stock"` returns `0` (or the `|| echo` fallback fires) — no leftover stock references anywhere in the file. Then use Claude-in-Chrome (or headless Chrome) to actually drive the page: click Invoice/Chitti → Continue, add 2 items (e.g. Qty 500/Rate 55 and Qty 300/Rate 60), fill Kanta=200, check GST, click "Generate Document", and confirm the on-screen preview's Grand Total matches a hand calc: subtotal = 500×55+300×60=27500+18000=45500; loading=round(800/1000*400)=320; taxable=45500+320+200=46020; GST=round(46020*0.18)=8284; total=54304.

- [ ] **Step 6: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): strip all stock-linking code from Chitti"
```

---

### Task 4: Convert Chitti print output from A5 dual-copy to single A6

**Files:**
- Modify: `mobile/index.html`

**Interfaces:**
- Consumes: `mobile/index.html` from Task 3.
- Produces: Chitti print output at `@page{size:105mm 148.5mm}` with one slip per page (no tear line, no duplicate copy) — matches Vansh Iron's `final-invoice-VI.html` print behavior exactly.

This is a 3-line CSS change plus a 1-line JS change (confirmed by diffing against `final-invoice-VI.html`, which already renders a single A6 slip with byte-identical `.doc`/`.d-tbl`/etc. styling).

- [ ] **Step 1: Change the print `@page` size**

Find (inside the `@media print{...}` block):
```css
  @page{size:A4 portrait;margin:0!important}
```
Replace with:
```css
  @page{size:105mm 148.5mm;margin:0!important}
```

- [ ] **Step 2: Change `.print-slip` from a 2-column flex row to a single block**

Find:
```css
  .print-slip{display:flex;width:210mm;height:148.5mm;margin:0!important;padding:0!important;overflow:hidden}
```
Replace with:
```css
  .print-slip{display:block;width:105mm;height:148.5mm;margin:0!important;padding:0!important;overflow:hidden}
```

- [ ] **Step 3: Remove the tear-line rules and drop the inner border**

Find:
```css
  .a5-half{width:105mm!important;height:148.5mm!important;overflow:hidden;flex:0 0 105mm}
  .a5-tear{flex:0 0 0;width:0;height:148.5mm;border-left:1px dashed #000}
  .print-slip .doc,.print-slip .doc-cont{width:105mm!important;height:137mm!important;margin:0!important;border:1px solid #000!important;display:block!important;padding:2.5mm 3.5mm 2mm 3.5mm!important}
```
Replace with:
```css
  .print-slip .doc,.print-slip .doc-cont{width:105mm!important;height:137mm!important;margin:0!important;border:none!important;display:block!important;padding:2.5mm 3.5mm 2mm 3.5mm!important}
```
(This deletes the `.a5-half`/`.a5-tear` rules entirely and changes `border:1px solid #000!important` to `border:none!important` on the remaining rule — matching `final-invoice-VI.html` exactly.)

- [ ] **Step 4: Stop duplicating the slip in the `prh` builder**

In `generate()`, find the `prh` builder line (locate via `grep -n 'a5-half'`):
```js
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,meta,note);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```
Replace with:
```js
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,meta,note);prh+=`<div class="print-slip"><div style="height:9mm"></div>${sh}</div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```

- [ ] **Step 5: Update the on-screen status text**

Find (in `#s4`):
```html
    <div class="print-note">✓ Ready · <strong>A5 (2 copies) · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
```
Replace with:
```html
    <div class="print-note">✓ Ready · <strong>A6 · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
```

- [ ] **Step 6: Verify via headless Chrome print-to-PDF**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -m http.server 8791 &
SERVER_PID=$!
sleep 1
# Drive the page via Claude-in-Chrome (or Chrome --headless --print-to-pdf) to:
#   1. Pick Invoice/Chitti, fill 1 item + charges, click Generate Document
#   2. Confirm the rendered print-area contains exactly one .print-slip per chunk
#      (no nested .a5-half/.a5-tear elements) via querySelectorAll count checks
#   3. Render to PDF and confirm each page is 105mm x 148.5mm (not 210mm x 148.5mm)
kill $SERVER_PID
```

Expected: exactly 1 `.doc`/`.doc-cont` element per `.print-slip` (was 2), zero `.a5-half`/`.a5-tear` elements in the rendered DOM, PDF page size 105mm×148.5mm.

- [ ] **Step 7: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): switch Chitti print from A5 dual-copy to single A6"
```

---

### Task 5: Add the PIN + device-token lock gate

**Files:**
- Modify: `mobile/index.html`

**Interfaces:**
- Consumes: `mobile/index.html` from Task 4.
- Produces: a new `#lock` step shown before `#s2`; `localStorage` key `ns_mobile_token`; the rest of the app (`.wrap` contents) hidden until unlocked.

- [ ] **Step 1: Add the lock screen markup**

Right after `<div class="wrap">` and before the existing `<datalist id="stock-items-datalist"></datalist>` line was (now already removed in Task 3 — insert as the first child of `.wrap`, before the `app-title` div):

```html
  <div class="step active" id="lock">
    <div class="card">
      <h2>Enter Setup Code</h2>
      <div class="fg"><label>Setup code</label><input id="lock-code" type="text" inputmode="text" autocomplete="off" placeholder="Setup code"></div>
      <div id="lock-err" style="display:none;color:#b91c1c;font-size:13px;margin-bottom:10px">Incorrect code.</div>
      <div class="acts"><button class="btn-p" onclick="tryUnlock()">Unlock</button></div>
    </div>
  </div>
```

- [ ] **Step 2: Make `#s2` start hidden (not `active`) so the lock screen shows first**

Find:
```html
  <div class="step active" id="s2"><div class="card"><h2>Document type</h2>
```
Replace with:
```html
  <div class="step" id="s2"><div class="card"><h2>Document type</h2>
```

- [ ] **Step 3: Add the lock JS**

Add this near the top of the main `<script>` block, right after the existing `var dtype='',rows=[],qRows=[],qBlobUrl='',qFormat='';` line:

```js
var SETUP_CODE='NARAYANI2026',LOCK_KEY='ns_mobile_token';
function makeUnlockToken(){
  if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();
  return 'tok-'+Math.random().toString(36).slice(2)+Date.now().toString(36);
}
function isDeviceUnlocked(){return !!localStorage.getItem(LOCK_KEY);}
function tryUnlock(){
  var val=document.getElementById('lock-code').value.trim();
  if(val===SETUP_CODE){
    localStorage.setItem(LOCK_KEY,makeUnlockToken());
    showMenu();
  }else{
    document.getElementById('lock-err').style.display='block';
  }
}
function showMenu(){
  document.getElementById('lock').classList.remove('active');
  document.getElementById('s2').classList.add('active');
}
(function initLock(){
  if(isDeviceUnlocked())showMenu();
})();
```

- [ ] **Step 4: Verify the gate blocks and unblocks correctly**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -m http.server 8791 &
SERVER_PID=$!
sleep 1
kill $SERVER_PID
```

Use Claude-in-Chrome / `javascript_tool` against the running page to check, in order:
1. Fresh load (no `localStorage` entry): `#lock` is the only visible `.step`, `#s2` is not visible.
2. Type an incorrect code into `#lock-code`, click Unlock: `#lock-err` becomes visible, `#lock` is still the active step.
3. Type `NARAYANI2026` into `#lock-code`, click Unlock: `#s2` becomes the active step, `localStorage.getItem('ns_mobile_token')` is a non-empty string.
4. Reload the page (with that `localStorage` entry still present): `#s2` is immediately the active step, `#lock` never shows.
5. Clear `localStorage` (`localStorage.clear()`) and reload: back to step 1's behavior.

Expected: all 5 checks pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): add PIN + one-time device-token lock gate"
```

---

### Task 6: iOS home-screen meta tags and app icon

**Files:**
- Modify: `mobile/index.html`
- Read: `Logo.jpeg` (Narayani Steels logo, project root)

**Interfaces:**
- Consumes: `mobile/index.html` from Task 5, `Logo.jpeg`.
- Produces: `<head>` tags that make "Add to Home Screen" launch as a standalone, full-screen app with a proper icon.

- [ ] **Step 1: Generate a 180x180 PNG icon from the existing logo**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /"
sips -z 180 180 "Logo.jpeg" --out /tmp/ns-icon-180.png
python3 -c "
import base64
data = open('/tmp/ns-icon-180.png','rb').read()
b64 = base64.b64encode(data).decode()
open('/tmp/ns-icon-180.b64','w').write(b64)
print('icon base64 length:', len(b64))
"
```

- [ ] **Step 2: Insert the meta tags and icon link into `<head>`**

Find:
```html
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Narayani Steels</title>
```
Replace with (substitute `__ICON_BASE64__` with the actual contents of `/tmp/ns-icon-180.b64` from Step 1):
```html
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="NS Mobile">
<link rel="apple-touch-icon" href="data:image/png;base64,__ICON_BASE64__">
<title>Narayani Steels Mobile</title>
```

- [ ] **Step 3: Verify the tags render**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
grep -c 'apple-mobile-web-app-capable' index.html
grep -c 'apple-touch-icon' index.html
python3 -c "
html = open('index.html').read()
assert 'apple-mobile-web-app-capable' in html
assert 'data:image/png;base64,' in html
assert '__ICON_BASE64__' not in html, 'placeholder was not substituted'
print('OK')
"
```

Expected: both `grep -c` calls return `1`, Python prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): add iOS home-screen meta tags and app icon"
```

---

### Task 7: Auto-print the Quotation blob tab for a one-tap PDF share

**Files:**
- Modify: `mobile/index.html`

**Interfaces:**
- Consumes: `mobile/index.html` from Task 6.
- Produces: the `PAGE_TEMPLATE` blob document (opened by `qOpen()`) auto-fires `window.print()` once its background image has loaded, so iOS's Print Preview (and Share-as-PDF) appears immediately instead of requiring a manual print trigger.

`PAGE_TEMPLATE` is a single very long JS string (600KB+) — do this edit with a small Python script rather than the Edit tool, anchored on unique substrings, since the line is too long to read/edit directly.

- [ ] **Step 1: Locate the `.bg` background image tag and the template's closing `</html>` inside the string**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -c "
html = open('index.html').read()
idx = html.find('var PAGE_TEMPLATE=')
tmpl = html[idx:idx+2000]
print(tmpl[-400:] if len(tmpl)<2000 else 'first 2000 chars shown, search for </body>\n\\\\</html>')
print('---')
print('contains class=\"bg\" onload hook already?', 'onload=' in html[idx:idx+len(html)])
"
```

- [ ] **Step 2: Insert an auto-print script just before the template's closing `</body>\n</html>`**

Write a Python script that does a targeted string replace inside the `PAGE_TEMPLATE` variable's value only (not anywhere else in the file, since `</body>\n</html>` also appears in the outer document):

```python
import re

path = "index.html"
src = open(path, encoding="utf-8").read()

marker_start = 'var PAGE_TEMPLATE="'
start = src.index(marker_start) + len(marker_start) - 1  # keep the opening quote
# Find the end of this JS string literal: the closing '";' that ends the var statement.
# PAGE_TEMPLATE is built as a single double-quoted JS string with escaped \" internally,
# so the true terminator is the first unescaped '";' after start.
end = src.index('";', start)
literal = src[start+1:end]  # contents between the quotes, JS-escaped

old_tail = r'<\/body>\n<\/html>'
assert old_tail in literal, "expected escaped closing tags not found in PAGE_TEMPLATE"

new_tail = (
    r'<script>window.addEventListener(\"load\",function(){'
    r'var bg=document.querySelector(\".bg\");'
    r'function go(){setTimeout(function(){window.print();},150);}'
    r'if(bg&&!bg.complete){bg.addEventListener(\"load\",go);bg.addEventListener(\"error\",go);}else{go();}'
    r'});<\/script>\n'
) + old_tail

literal = literal.replace(old_tail, new_tail, 1)

new_src = src[:start+1] + literal + src[end:]
open(path, "w", encoding="utf-8").write(new_src)
print("inserted auto-print script, new PAGE_TEMPLATE length:", len(literal))
```

Run it:
```bash
python3 insert_autoprint.py   # save the script above to this filename first, or run inline via python3 -c
```

- [ ] **Step 3: Verify the JS is syntactically valid and the hook is present**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/var PAGE_TEMPLATE=(\".*?\");\n?function/s);
if(!m) throw new Error('could not isolate PAGE_TEMPLATE literal');
const tmplSrc = 'var PAGE_TEMPLATE=' + m[1] + ';';
eval(tmplSrc); // throws SyntaxError if the string literal itself is malformed
if(!PAGE_TEMPLATE.includes('window.print()')) throw new Error('auto-print hook missing');
console.log('OK: PAGE_TEMPLATE is valid JS and contains the auto-print hook, length', PAGE_TEMPLATE.length);
"
```

Expected: `OK: PAGE_TEMPLATE is valid JS and contains the auto-print hook, length <N>` with no thrown errors.

- [ ] **Step 4: Verify live via the anchor-and-slice blob technique**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -m http.server 8791 &
SERVER_PID=$!
sleep 1
kill $SERVER_PID
```

Via Claude-in-Chrome: pick Quotation → Basic format → fill 1 item + customer fields → Generate Quotation → click "Open & Print Quotation" (`qOpen()`). Confirm a new tab opens showing the rendered quotation and that Print Preview appears without a manual print trigger (on desktop Chrome this shows as `window.print()` opening the OS print dialog — confirms the hook fires; the iOS-specific Share-as-PDF behavior itself needs the on-device pass in Task 8).

- [ ] **Step 5: Commit**

```bash
git add mobile/index.html
git commit -m "feat(narayani-mobile): auto-print Quotation blob tab for one-tap PDF share"
```

---

### Task 8: Full end-to-end verification pass and delivery packaging

**Files:**
- Modify: `mobile/index.html` (only if verification surfaces a real bug)

**Interfaces:**
- Consumes: `mobile/index.html` from Task 7.
- Produces: a verified-working file ready to AirDrop, plus a clear list of what still needs on-device (real iPhone) confirmation.

- [ ] **Step 1: Full Quotation pass, all 3 formats**

Via Claude-in-Chrome against a local server, unlock the app, then for each of Basic / Including / Local:
- Fill customer To/Date/Address/GSTIN/Requirement/Note
- Add 2 items with WT/PC, Pcs, Rate
- Fill Kanta/Transport/Unloading
- Click Generate Quotation → Open & Print
- Confirm the totals shown match hand-calculated values for that format's math (Basic: GST@18% on gross; Including: no GST line, rate GST-inclusive; Local: per-MT pricing, no GST) — reuse the exact math rules documented in `docs/superpowers/specs/2026-08-10-mobile-billing-tool-design.md`'s Quotation Section.
- Confirm Bank Details and Terms/Note render in the print output for all 3 formats.

- [ ] **Step 2: Full Chitti pass**

- Fill customer Name/Date/Mobile/Lorry
- Add 3 items (mix of Qty(kg)×Rate and Pcs×Rate billing)
- Fill Kanta/Freight/Unloading/Bending/Others, check GST
- Add a multi-line Note
- Click Generate Document
- Confirm on-screen totals match hand calc, confirm the printed preview is a single A6 slip (no tear line, no duplicate), confirm the Note wraps without clipping, confirm there is no Deduct-from-Stock button anywhere on screen.

- [ ] **Step 3: Re-verify the lock gate end-to-end (fresh + returning device simulation)**

Repeat Task 5 Step 4's 5 checks once more against the fully-assembled file, to catch any regression introduced by Tasks 6-7's edits.

- [ ] **Step 4: Confirm menu has exactly 2 tiles and no dead links**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /mobile"
python3 -c "
html = open('index.html').read()
for dead in ['stock.html','reports.html','balance-sheet.html','delivery_challan_NS.html','Challan']:
    assert dead not in html, f'{dead} still referenced'
for kw in ['stockItemId','matchStockItem','performStockDeduction','a5-half','a5-tear']:
    assert kw not in html, f'{kw} still present'
print('OK: fully trimmed')
"
```

Expected: `OK: fully trimmed`.

- [ ] **Step 5: Final commit**

```bash
git add mobile/index.html
git commit -m "chore(narayani-mobile): final verification pass, ready for delivery"
```

- [ ] **Step 6: Report delivery status to the user**

State clearly in the final summary to Vansh:
- The file is ready at `mobile/index.html` for AirDrop/email to the target iPhone.
- Setup code is `NARAYANI2026` — change it in the file first if a different code is wanted (single constant, `SETUP_CODE` near the top of the script).
- After AirDropping, the on-device steps are: open in Safari → Share icon → "Add to Home Screen" → open from the Home Screen icon → enter the setup code once.
- Real iPhone/Safari confirmation (the actual Share-as-PDF flow from Print Preview, and whether the auto-print hook fires reliably on iOS Safari for the Quotation blob tab) has **not** been done — this needs Vansh's own on-device pass, since there's no physical device access available. Recommend he generate one Quotation and one Chitti on the actual iPhone and confirm both produce a shareable PDF before treating this as fully delivered.

---

## Self-Review Notes

- **Spec coverage:** Architecture (Task 1), menu/scope trim (Task 2), Chitti stock strip (Task 3), single-A6 print (Task 4), device lock (Task 5), home-screen meta/icon (Task 6), Quotation auto-print (Task 7), full verification + delivery (Task 8) — every spec section has a task.
- **Placeholder scan:** All code blocks are concrete; the one literal placeholder token (`__ICON_BASE64__` in Task 6) is explicitly substituted with a real value generated in the same task's Step 1, not left unresolved.
- **Type/name consistency:** `LOCK_KEY`/`ns_mobile_token`, `SETUP_CODE`/`NARAYANI2026`, `tryUnlock`/`isDeviceUnlocked`/`showMenu`/`makeUnlockToken` are used identically across Task 5's steps and referenced correctly in Task 8's re-verification. `.print-slip`/`.doc`/`.doc-cont` class names in Task 4 match `final-invoice-VI.html`'s actual current CSS (confirmed via direct diff before writing this plan, not assumed).
