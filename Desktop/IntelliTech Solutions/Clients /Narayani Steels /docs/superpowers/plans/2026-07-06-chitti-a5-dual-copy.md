# Chitti A6→A5 Dual-Copy Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the Invoice/Chitti print output in `final-invoice-NS.html` from a single A6 page per slip to a single A5 page containing two identical, bordered A6-sized copies side by side with a dashed tear line between them.

**Architecture:** This is a single-file, no-build, vanilla-JS HTML app with no test framework. All logic lives in `final-invoice-NS.html`. The change is confined to: the `@media print` CSS block (page size + slip layout), and one line inside `generate()` that assembles the print HTML string. Quotation (separate blob-based `PAGE_TEMPLATE` flow) and Delivery Challan (separate file, loaded via iframe) are untouched — confirmed by grep that `@page{size:105mm...}`, `.print-slip`, and the `generate()`/`buildFirstSlip`/`buildContSlip` functions only feed `#print-area`, which is only populated by the Chitti/Invoice flow.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no bundler). Verification uses a local `python3 -m http.server` + a headless Chrome print-to-pdf render (the same technique already used elsewhere in this project for visual checks), since there is no unit test runner for this file.

## Global Constraints

- Do not modify any calculation logic (GST, totals, Old Balance/Advance, labour auto-calc, row-padding math in `buildFirstSlip`/`buildContSlip`).
- Do not touch Quotation (`qGenerate`/`qOpen`/`PAGE_TEMPLATE`) or Delivery Challan (`delivery_challan_NS.html`) — spec scope is Chitti print output only.
- Both halves of the A5 sheet must be byte-identical (same interpolated `sh` string placed twice) — no "Customer Copy"/"Office Copy" labels.
- No scaling of slip content — each half stays at its existing 105mm width / font sizes.
- `FIRST_TOTAL`/`CONT_TOTAL` (19) stay unchanged.
- File to edit: `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html` (referred to below as `final-invoice-NS.html`).

---

### Task 1: Side-by-side A5 layout (CSS + assembly change)

**Files:**
- Modify: `final-invoice-NS.html:68` (`@page` rule)
- Modify: `final-invoice-NS.html:73` (`.print-slip` rule)
- Modify: `final-invoice-NS.html:74` (`.print-slip .doc,.print-slip .doc-cont` rule)
- Modify: `final-invoice-NS.html:254` (`generate()`'s print-assembly loop)

**Interfaces:**
- Consumes: existing `buildFirstSlip()` / `buildContSlip()` return values (unchanged signatures, unchanged HTML they produce) — this task only changes how that returned HTML (`sh`) is wrapped before being appended to `prh`.
- Produces: `#print-area` now contains, per logical page, one `<div class="print-slip">` with two `<div class="a5-half">` children (each wrapping an unchanged copy of `sh`) and one `<div class="a5-tear">` divider between them. Task 2 and Task 3 rely on this exact structure (`a5-half` / `a5-tear` class names) when they verify multi-page behavior and the status text.

- [ ] **Step 1: Capture baseline (confirm current single-slip source pattern exists)**

Run:
```bash
grep -n 'class="print-slip"><div style="height:9mm"></div>${sh}</div>' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected: one match, on line 254 (the current single-copy assembly template literal). This confirms the exact old string we're about to replace.

- [ ] **Step 2: Edit the `@page` size (line 68)**

In `final-invoice-NS.html`, replace:
```css
  @page{size:105mm 148.5mm;margin:0!important}
```
with:
```css
  @page{size:210mm 148.5mm;margin:0!important}
```

- [ ] **Step 3: Edit `.print-slip` to a flex row spanning the new A5 width (line 73)**

Replace:
```css
  .print-slip{display:block;width:105mm;height:148.5mm;margin:0!important;padding:0!important;overflow:hidden}
```
with:
```css
  .print-slip{display:flex;width:210mm;height:148.5mm;margin:0!important;padding:0!important;overflow:hidden}
```

- [ ] **Step 4: Add `.a5-half`/`.a5-tear` and restore the per-slip border (line 74)**

Replace:
```css
  .print-slip .doc,.print-slip .doc-cont{width:105mm!important;height:137mm!important;margin:0!important;border:none!important;display:block!important;padding:2.5mm 3.5mm 2mm 3.5mm!important}
```
with:
```css
  .a5-half{width:105mm!important;height:148.5mm!important;overflow:hidden;flex:0 0 105mm}
  .a5-tear{flex:0 0 0;width:0;height:148.5mm;border-left:1px dashed #000}
  .print-slip .doc,.print-slip .doc-cont{width:105mm!important;height:137mm!important;margin:0!important;border:1px solid #000!important;display:block!important;padding:2.5mm 3.5mm 2mm 3.5mm!important}
```

(The page already has a global `*{box-sizing:border-box;margin:0;padding:0}` rule at line 8, so adding a 1px border to `.doc`/`.doc-cont` does not push their rendered width past 105mm.)

- [ ] **Step 5: Edit `generate()`'s print-assembly loop to duplicate each slip side by side (line 254)**

Replace:
```js
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,meta);prh+=`<div class="print-slip"><div style="height:9mm"></div>${sh}</div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```
with:
```js
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,meta);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```

Note `sh` is interpolated twice from the same variable — the two halves are guaranteed identical by construction, not by a separate render call.

- [ ] **Step 6: Confirm the old pattern is gone and the new one is present**

Run:
```bash
grep -c 'class="print-slip"><div style="height:9mm"></div>${sh}</div>' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
grep -c 'class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div>' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected: first command prints `0`, second prints `1`.

- [ ] **Step 7: Runtime verification — generate a single-page Chitti and inspect the produced print HTML**

Start a local server in the background:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /" && python3 -m http.server 8891 > /tmp/ns-http.log 2>&1 &
```

Using the Claude-in-Chrome tools: navigate to `http://localhost:8891/final-invoice-NS.html`, then run this via the JS execution tool:
```js
dtype='Invoice';
rows=[{q:'500',name:'MS Angle 50x50',p:'20',r:'52'},{q:'300',name:'MS Flat 40x6',p:'15',r:'55'}];
document.getElementById('f-name').value='Test Customer';
document.getElementById('f-date').value='06/07/2026';
document.getElementById('f-mobile').value='9876543210';
document.getElementById('f-lorry').value='TS08AB1234';
generate();
const html=document.getElementById('print-area').innerHTML;
JSON.stringify({slips:(html.match(/class="print-slip"/g)||[]).length,halves:(html.match(/class="a5-half"/g)||[]).length,tears:(html.match(/class="a5-tear"/g)||[]).length,pageBreaks:(html.match(/class="page-break"/g)||[]).length});
```
Expected result: `{"slips":1,"halves":2,"tears":1,"pageBreaks":0}`.

- [ ] **Step 8: Visual verification via headless Chrome print-to-pdf**

Create a temp copy of the page that auto-fills the same sample data and calls `generate()` on load, then print it to PDF headlessly:
```bash
SCRATCH=/private/tmp/claude-501/-Users-vanshjalan/aa0be7f9-1f0d-4415-968a-e188f76e4967/scratchpad
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html" "$SCRATCH/test-chitti-a5.html"
python3 - "$SCRATCH/test-chitti-a5.html" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()
snippet = """<script>
window.addEventListener('load', function(){
  dtype='Invoice';
  rows=[{q:'500',name:'MS Angle 50x50',p:'20',r:'52'},{q:'300',name:'MS Flat 40x6',p:'15',r:'55'}];
  document.getElementById('f-name').value='Test Customer';
  document.getElementById('f-date').value='06/07/2026';
  document.getElementById('f-mobile').value='9876543210';
  document.getElementById('f-lorry').value='TS08AB1234';
  generate();
});
</script></body>"""
content = content.replace("</body>", snippet, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PYEOF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=3000 --print-to-pdf="$SCRATCH/test-chitti-a5.pdf" "file://$SCRATCH/test-chitti-a5.html"
pdftoppm -png -r 150 "$SCRATCH/test-chitti-a5.pdf" "$SCRATCH/test-chitti-a5"
```
Then read `$SCRATCH/test-chitti-a5-1.png` with the Read tool. Confirm visually: one landscape A5 page, two identical bordered slips side by side, a dashed vertical line between them, no clipped/overflowing content in either half.

- [ ] **Step 9: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /" && git add final-invoice-NS.html && git commit -m "feat(narayani-steels): print Chitti as A5 sheet with two side-by-side copies"
```

---

### Task 2: Verify multi-page (continuation slip) behavior

**Files:**
- Modify: `final-invoice-NS.html` (only if Step 2 below finds a bug — otherwise no code changes in this task)
- Read: `final-invoice-NS.html:238-241` (`FIRST_TOTAL`, `buildFirstSlip`, `CONT_TOTAL`, `buildContSlip` — for reference, unchanged)

**Interfaces:**
- Consumes: the `a5-half`/`a5-tear`/`print-slip` structure produced by Task 1.
- Produces: confirmation (or a fix) that continuation pages get the same side-by-side treatment as the first page, with exactly one `page-break` between logical pages (not per half).

- [ ] **Step 1: Determine the item count needed to force a continuation page**

With no additional charges filled in, `cc=0` so `tr2=2` and `mp1=FIRST_TOTAL-tr2=19-2=17`. So 18+ items forces a second (continuation) chunk. Use 20 items for a clear margin.

- [ ] **Step 2: Generate a 20-item Chitti and inspect the produced print HTML**

Reuse the server from Task 1 (or restart it the same way if it's no longer running: `cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /" && python3 -m http.server 8891 > /tmp/ns-http.log 2>&1 &`). Navigate to `http://localhost:8891/final-invoice-NS.html` and run via the JS execution tool:
```js
dtype='Invoice';
rows=Array.from({length:20},(_,i)=>({q:'100',name:'Item '+(i+1),p:'5',r:'50'}));
document.getElementById('f-name').value='Test Customer';
document.getElementById('f-date').value='06/07/2026';
document.getElementById('f-mobile').value='9876543210';
document.getElementById('f-lorry').value='TS08AB1234';
generate();
const html=document.getElementById('print-area').innerHTML;
JSON.stringify({slips:(html.match(/class="print-slip"/g)||[]).length,halves:(html.match(/class="a5-half"/g)||[]).length,tears:(html.match(/class="a5-tear"/g)||[]).length,pageBreaks:(html.match(/class="page-break"/g)||[]).length});
```
Expected result: `{"slips":2,"halves":4,"tears":2,"pageBreaks":1}` — two A5 sheets (first slip + continuation), each duplicated into two halves, and exactly one page-break separating the two sheets.

- [ ] **Step 3: If the counts don't match expected, diagnose and fix**

If this fails, the most likely cause is the `if(!il)prh+='<div class="page-break"></div>'` placement relative to the new wrapper `div.print-slip` — it should still fire once per `chunks.forEach` iteration (i.e., once per logical page), which Task 1's edit preserves (the page-break line was not touched, only the content of `prh+=` immediately above it). If a bug is found, fix it in `final-invoice-NS.html`, re-run Step 2's script to confirm `{"slips":2,"halves":4,"tears":2,"pageBreaks":1}`, then:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /" && git add final-invoice-NS.html && git commit -m "fix(narayani-steels): correct page-break placement for multi-page A5 chitti"
```
If Step 2 already passed, no fix or commit is needed for this task.

- [ ] **Step 4: Visual verification of both pages**

Repeat Task 1 Step 8's headless print-to-pdf pipeline, but with the 20-item `rows` array from Step 2 above in the injected `<script>` snippet, and check `$SCRATCH/test-chitti-a5-1.png` and `$SCRATCH/test-chitti-a5-2.png` (pdftoppm names multi-page output `-1.png`, `-2.png`, etc.). Confirm both pages show two identical bordered halves each, with correct item distribution (17 items on page 1, remaining 3 on page 2 continuation — matching `mp1=17`), and totals only appearing on the last page (per existing `buildContSlip`/`buildFirstSlip` `isLast` logic, unchanged).

---

### Task 3: Update on-screen status text from A6 to A5

**Files:**
- Modify: `final-invoice-NS.html:140`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: nothing consumed by later tasks — this is the final, independent cleanup task.

- [ ] **Step 1: Confirm current text**

Run:
```bash
grep -n 'print-note">✓ Ready' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected: line 140 containing `✓ Ready · <strong>A6 · Margins: None · Scale: 100% · Backgrounds: ON</strong>`.

- [ ] **Step 2: Edit the text**

Replace:
```html
    <div class="print-note">✓ Ready · <strong>A6 · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
```
with:
```html
    <div class="print-note">✓ Ready · <strong>A5 (2 copies) · Margins: None · Scale: 100% · Backgrounds: ON</strong></div>
```

- [ ] **Step 3: Verify**

Run:
```bash
grep -n 'print-note">✓ Ready' "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /final-invoice-NS.html"
```
Expected: line now reads `✓ Ready · <strong>A5 (2 copies) · Margins: None · Scale: 100% · Backgrounds: ON</strong>`.

Using the Claude-in-Chrome tools on the already-running local server (`http://localhost:8891/final-invoice-NS.html`), click "Invoice / Chitti" → "Continue →" → fill any sample item → "Generate Document", and visually confirm step `#s4` now shows "A5 (2 copies)" instead of "A6".

- [ ] **Step 4: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /" && git add final-invoice-NS.html && git commit -m "chore(narayani-steels): update Chitti print-note text from A6 to A5"
```
