# Narayani Steels — Bending Charges, Dual Stock Tracking, Ledger Removal, Stock Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five changes to the Narayani Steels billing/stock tool: a Bending Charges field in the Chitti, per-item dual Pieces+Kg stock tracking, full removal of the Ledger feature, a zero-stock sort on the Stock page, and confirmation that Reports already reflects new items (no code change needed there — see Task 11).

**Architecture:** This is a single Node/Express app (`app/server.js`) backed by two flat-file JSON stores (`stockStore.js`, and `balanceSheetStore.js` which is untouched) serving static HTML+inline-JS pages from `app/public/`. `final-invoice-NS.html` is edited at the repo root (source of truth) and copied into `app/public/` before any deploy — this plan edits the root file and copies it each time. No build step, no framework — follow the existing plain-JS, single-file-per-page style throughout.

**Tech Stack:** Node.js (CommonJS), Express, `node:test` + `node:assert/strict` for `app/*.test.js`, plain inline `<script>` JS in the `.html` pages (no bundler).

## Global Constraints

- No changes to Quotation or Delivery Challan flows.
- No changes to Balance Sheet (`balance-sheet.html`, `balanceSheetStore.js`) — confirmed independent of Ledger.
- No changes to billing **amount** calculation logic (`rowAmount()`/`qAmtRaw()`) — this work is about stock quantity tracking, not pricing.
- Every existing stock item gets `dualTrack: false` and `stockPcs: 0` on migration — never fabricate a real Pieces count.
- Follow this project's existing plain-JS style (no TypeScript, no new dependencies, no framework) — this is a legacy small-business tool, not a rewrite target.
- After any edit to root `final-invoice-NS.html`, copy it to `app/public/final-invoice-NS.html` before committing (established sync convention for this project).

---

### Task 1: Bending Charges in the Chitti

**Files:**
- Modify: `final-invoice-NS.html` (root)
- Copy to: `app/public/final-invoice-NS.html`

**Interfaces:**
- Produces: a new `f-bend` input, `d-bend` display span, and a `bend` value threaded through `recalc()`, `totalsBlock()`, `buildFirstSlip()`, `buildContSlip()`, `generate()`, `reset()` — later tasks (Task 8, Task 10) build on these exact signatures.

This project has no automated test harness for `final-invoice-NS.html` (it's inline HTML/JS, verified historically via a local server + manual/headless-Chrome checks — see the Verify step). Steps are still broken out bite-sized; "test" here means the manual verification step.

- [ ] **Step 1: Add the Bending Charges input to the charges grid**

In `final-invoice-NS.html`, find:
```html
        <div class="fg"><label>Unloading</label><input id="f-unload" type="number" min="0" placeholder="0" oninput="recalc()"></div>
        <div class="fg"><label>Others</label><input id="f-others" type="number" min="0" placeholder="0" oninput="recalc()"></div>
```
Replace with:
```html
        <div class="fg"><label>Unloading</label><input id="f-unload" type="number" min="0" placeholder="0" oninput="recalc()"></div>
        <div class="fg"><label>Bending Charges</label><input id="f-bend" type="number" min="0" placeholder="0" oninput="recalc()"></div>
        <div class="fg"><label>Others</label><input id="f-others" type="number" min="0" placeholder="0" oninput="recalc()"></div>
```

- [ ] **Step 2: Add the Bending Charges row to the on-screen summary box**

Find:
```html
        <div class="sr muted"><span>Unloading</span><span id="d-unload">0</span></div>
        <div class="sr muted"><span>Others</span><span id="d-others">0</span></div>
```
Replace with:
```html
        <div class="sr muted"><span>Unloading</span><span id="d-unload">0</span></div>
        <div class="sr muted"><span>Bending Charges</span><span id="d-bend">0</span></div>
        <div class="sr muted"><span>Others</span><span id="d-others">0</span></div>
```

- [ ] **Step 3: Thread `bend` through `recalc()`**

Find:
```js
function recalc(){
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const noLoading=document.getElementById('f-no-loading').checked;
  const lab=noLoading?0:Math.round(tq/1000*400);document.getElementById('f-labour').value=lab;
  const weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  document.getElementById('d-sub').textContent=fmt(sub);document.getElementById('d-lab').textContent=fmt(lab);document.getElementById('d-weigh').textContent=fmt(weigh);document.getElementById('d-freight').textContent=fmt(freight);document.getElementById('d-unload').textContent=fmt(unload);document.getElementById('d-others').textContent=fmt(others);document.getElementById('d-gst').textContent=fmt(gst);document.getElementById('d-oldbal').textContent=fmt(oldbal);document.getElementById('d-advance').textContent=fmt(advance);document.getElementById('d-tot').textContent=fmt(tot);
}
```
Replace with:
```js
function recalc(){
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const noLoading=document.getElementById('f-no-loading').checked;
  const lab=noLoading?0:Math.round(tq/1000*400);document.getElementById('f-labour').value=lab;
  const weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  document.getElementById('d-sub').textContent=fmt(sub);document.getElementById('d-lab').textContent=fmt(lab);document.getElementById('d-weigh').textContent=fmt(weigh);document.getElementById('d-freight').textContent=fmt(freight);document.getElementById('d-unload').textContent=fmt(unload);document.getElementById('d-bend').textContent=fmt(bend);document.getElementById('d-others').textContent=fmt(others);document.getElementById('d-gst').textContent=fmt(gst);document.getElementById('d-oldbal').textContent=fmt(oldbal);document.getElementById('d-advance').textContent=fmt(advance);document.getElementById('d-tot').textContent=fmt(tot);
}
```
(Task 10 removes the `oldbal`/`advance` parts of this function later — leave them in for now, this task is additive only.)

- [ ] **Step 4: Add `bend` to `totalsBlock()`, `buildFirstSlip()`, `buildContSlip()`**

Find:
```js
function totalsBlock(sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note){const qs=tq%1===0?tq:tq.toFixed(2);let r=`<tr class="sep"><td class="c">${qs}</td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2" style="font-weight:bold">Subtotal</td><td class="r">${fmt(sub)}</td></tr>`;[['Loading Charges',lab],['Kanta Charges',weigh],['Freight',freight],['Unloading',unload],['GST @18%',gst],['Others',others],['Old Balance',oldbal]].forEach(([l,v])=>{if(v>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">${l}</td><td class="r">${fmt(v)}</td></tr>`;});if(advance>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">Advance</td><td class="r">-${fmt(advance)}</td></tr>`;if(note)r+=`<tr class="charge"><td colspan="4" class="note-row">Note: ${escHtml(note)}</td><td class="r"></td></tr>`;r+=`<tr class="grand"><td colspan="4" style="text-align:right;padding-right:2mm">TOTAL</td><td class="r">${fmt(tot)}</td></tr>`;return r;}
const FIRST_TOTAL=19;
function buildFirstSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,meta,note){const{name,date,mobile,lorry}=meta;let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,FIRST_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note);return`<div class="doc"><div class="d-hdr"><div class="d-shri">||श्री||</div><div class="d-title">QUOTATION</div><div class="d-valid">Valid for 2 Hours</div></div><div class="d-meta"><span>M/s.&nbsp;<b style="font-size:11pt">${name}</b></span><span>Dt.&nbsp;<b style="font-size:11pt">${date}</b></span></div><div class="d-meta"><span>Mobile No.&nbsp;<b style="font-size:11pt">${mobile}</b></span><span style="margin-right:12mm">Lorry No.&nbsp;<b style="font-size:11pt">${lorry}</b></span></div><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
const CONT_TOTAL=19;
function buildContSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note){let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,CONT_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note);return`<div class="doc-cont"><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
```
Replace with:
```js
function totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note){const qs=tq%1===0?tq:tq.toFixed(2);let r=`<tr class="sep"><td class="c">${qs}</td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2" style="font-weight:bold">Subtotal</td><td class="r">${fmt(sub)}</td></tr>`;[['Loading Charges',lab],['Kanta Charges',weigh],['Freight',freight],['Unloading',unload],['Bending Charges',bend],['GST @18%',gst],['Others',others],['Old Balance',oldbal]].forEach(([l,v])=>{if(v>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">${l}</td><td class="r">${fmt(v)}</td></tr>`;});if(advance>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">Advance</td><td class="r">-${fmt(advance)}</td></tr>`;if(note)r+=`<tr class="charge"><td colspan="4" class="note-row">Note: ${escHtml(note)}</td><td class="r"></td></tr>`;r+=`<tr class="grand"><td colspan="4" style="text-align:right;padding-right:2mm">TOTAL</td><td class="r">${fmt(tot)}</td></tr>`;return r;}
const FIRST_TOTAL=19;
function buildFirstSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note){const{name,date,mobile,lorry}=meta;let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,FIRST_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note);return`<div class="doc"><div class="d-hdr"><div class="d-shri">||श्री||</div><div class="d-title">QUOTATION</div><div class="d-valid">Valid for 2 Hours</div></div><div class="d-meta"><span>M/s.&nbsp;<b style="font-size:11pt">${name}</b></span><span>Dt.&nbsp;<b style="font-size:11pt">${date}</b></span></div><div class="d-meta"><span>Mobile No.&nbsp;<b style="font-size:11pt">${mobile}</b></span><span style="margin-right:12mm">Lorry No.&nbsp;<b style="font-size:11pt">${lorry}</b></span></div><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
const CONT_TOTAL=19;
function buildContSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note){let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,CONT_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note);return`<div class="doc-cont"><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
```
(Note: `.d-title` still hardcodes "QUOTATION" — this is the pre-existing out-of-scope bug noted in the project's memory; do not touch it.)

- [ ] **Step 5: Add `bend` to `generate()` and `reset()`**

Find:
```js
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const lab=gc('f-labour'),weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  const meta={name:document.getElementById('f-name').value||'_______________________',date:document.getElementById('f-date').value||'________',mobile:document.getElementById('f-mobile').value||'___________',lorry:document.getElementById('f-lorry').value||'___________'};
  const note=document.getElementById('f-note').value.trim();
  const cc=[lab,weigh,freight,unload,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0),tr2=2+cc,mp1=FIRST_TOTAL-tr2;
  const chunks=rows.length<=mp1?[{items:rows,cont:false}]:[{items:rows.slice(0,mp1),cont:false},{items:rows.slice(mp1),cont:true}];
  let ph='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);ph+=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,meta,note);});
  document.getElementById('preview-wrap').innerHTML=ph;
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,gst,others,oldbal,advance,tot,meta,note);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```
Replace with:
```js
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const lab=gc('f-labour'),weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  const meta={name:document.getElementById('f-name').value||'_______________________',date:document.getElementById('f-date').value||'________',mobile:document.getElementById('f-mobile').value||'___________',lorry:document.getElementById('f-lorry').value||'___________'};
  const note=document.getElementById('f-note').value.trim();
  const cc=[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0),tr2=2+cc,mp1=FIRST_TOTAL-tr2;
  const chunks=rows.length<=mp1?[{items:rows,cont:false}]:[{items:rows.slice(0,mp1),cont:false},{items:rows.slice(mp1),cont:true}];
  let ph='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);ph+=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note);});
  document.getElementById('preview-wrap').innerHTML=ph;
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
```

Find in `reset()`:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-others','f-advance','f-oldbal','f-note'].forEach(function(id){document.getElementById(id).value='';});
```
Replace with:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-bend','f-others','f-advance','f-oldbal','f-note'].forEach(function(id){document.getElementById(id).value='';});
```

- [ ] **Step 6: Copy to `app/public/` and commit**

```bash
cp final-invoice-NS.html app/public/final-invoice-NS.html
git add final-invoice-NS.html app/public/final-invoice-NS.html
git commit -m "feat(narayani-steels): add Bending Charges to Chitti/Invoice"
```

- [ ] **Step 7: Manually verify**

```bash
cd app && (node server.js > /tmp/ns-verify.log 2>&1 &) && sleep 1.5
curl -s http://127.0.0.1:3300/final-invoice-NS.html | grep -c 'f-bend'
```
Expected: a non-zero count (the field exists in the served HTML). Then stop the server: `pkill -f "node server.js"`.
Also do a real click-through once via Claude-in-Chrome or a browser: pick Invoice, add an item, enter a Bending Charges value, Generate — confirm it appears as its own row in both the on-screen preview and the printed slip, and is included in the Grand Total, and disappears from the printed rows when left at 0.

---

### Task 2: stockStore.js — dual-track data model (`dualTrack`, `stockPcs`, migration, addItem/updateItem/stockIn/adjust/deduct)

**Files:**
- Modify: `app/stockStore.js`
- Test: `app/stockStore.test.js`

**Interfaces:**
- Produces: `item.dualTrack: boolean`, `item.stockPcs: number`; `addItem({..., dualTrack, initialStockPcs})`; `updateItem(id, {..., dualTrack})`; `stockIn(itemId, kg, pcs, note)`; `adjust(itemId, newTotalKg, newTotalPcs, note)`; `deduct(itemId, kg, pcs, note)` — the `pcs`/`newTotalPcs` params are ignored for non-dual items (pass `undefined`) and required (must resolve to a positive/finite number) for dual-track items. `computePieces(item)` returns `item.stockPcs` directly when `item.dualTrack` is true.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Write failing tests for the new data model**

Append to `app/stockStore.test.js`:
```js
test('addItem with dualTrack seeds stockPcs and tracks it independently of currentStockKg', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({
    categoryId: cats[0].id, name: 'MS Pipe 20x20', unit: 'kg',
    dualTrack: true, initialStockKg: 100, initialStockPcs: 40,
  });
  assert.equal(item.dualTrack, true);
  assert.equal(item.currentStockKg, 100);
  assert.equal(item.stockPcs, 40);
  assert.equal(item.pieces, 40); // computePieces returns the real count directly for dual-track items
});

test('addItem without dualTrack defaults dualTrack false and stockPcs 0', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'TMT 12mm', unit: 'kg', initialStockKg: 50 });
  assert.equal(item.dualTrack, false);
  assert.equal(item.stockPcs, 0);
});

test('existing items loaded from a legacy stock.json file (no dualTrack/stockPcs fields) migrate to dualTrack:false, stockPcs:0', () => {
  const file = tempFile();
  const legacy = {
    categories: [{ id: 'cat_1', name: 'TMT Bars' }],
    items: [{ id: 'item_1', categoryId: 'cat_1', name: 'Legacy Item', unit: 'kg', weightPerPieceKg: null, currentStockKg: 250 }],
    movements: [],
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(legacy, null, 2));
  const store = createStore(file);
  const item = store.getItem('item_1');
  assert.equal(item.dualTrack, false);
  assert.equal(item.stockPcs, 0);
  assert.equal(item.currentStockKg, 250); // untouched
});

test('stockIn on a dualTrack item requires both kg and pcs to be positive', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'Binding Wire', unit: 'kg', dualTrack: true, initialStockKg: 0, initialStockPcs: 0 });
  assert.throws(() => store.stockIn(item.id, 50, 0), /positive/);
  assert.throws(() => store.stockIn(item.id, 0, 10), /positive/);
  const updated = store.stockIn(item.id, 50, 10);
  assert.equal(updated.currentStockKg, 50);
  assert.equal(updated.stockPcs, 10);
});

test('stockIn on a non-dualTrack item ignores any pcs argument and behaves exactly as before', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'TMT 16mm', unit: 'kg', initialStockKg: 0 });
  const updated = store.stockIn(item.id, 100, 999, ''); // pcs=999 must be ignored, no dualTrack
  assert.equal(updated.currentStockKg, 100);
  assert.equal(updated.stockPcs, 0);
});

test('adjust on a dualTrack item sets both new totals independently', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'MS Pipe 25x25', unit: 'kg', dualTrack: true, initialStockKg: 100, initialStockPcs: 40 });
  const updated = store.adjust(item.id, 80, 30, 'correction');
  assert.equal(updated.currentStockKg, 80);
  assert.equal(updated.stockPcs, 30);
});

test('deduct on a dualTrack item requires both kg and pcs to be positive and decrements both counters', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'MS Pipe 32x32', unit: 'kg', dualTrack: true, initialStockKg: 100, initialStockPcs: 40 });
  assert.throws(() => store.deduct(item.id, 10, 0), /positive/);
  const updated = store.deduct(item.id, 10, 4, 'Chitti/Invoice');
  assert.equal(updated.currentStockKg, 90);
  assert.equal(updated.stockPcs, 36);
});

test('updateItem can toggle dualTrack on for an existing item, seeding stockPcs at 0', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'M.S. Section 40x40', unit: 'kg', initialStockKg: 500 });
  assert.equal(item.dualTrack, false);
  const updated = store.updateItem(item.id, { dualTrack: true });
  assert.equal(updated.dualTrack, true);
  assert.equal(updated.stockPcs, 0);
  assert.equal(updated.currentStockKg, 500); // kg counter untouched by the toggle
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && node --test stockStore.test.js`
Expected: FAIL — `dualTrack`/`stockPcs` undefined, `stockIn`/`adjust`/`deduct` reject the extra argument or throw for the wrong reason.

- [ ] **Step 3: Implement the data model changes in `app/stockStore.js`**

Update `computePieces`:
```js
function computePieces(item) {
  if (item.dualTrack) return item.stockPcs;
  if (item.unit === 'pcs') return null;
  return item.weightPerPieceKg ? Math.floor(item.currentStockKg / item.weightPerPieceKg) : null;
}
```

Update `load()` to migrate legacy items — find:
```js
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`stock.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
```
Replace with:
```js
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`stock.json is corrupted and could not be parsed: ${err.message}`);
      }
      // Migration: items written before dual pieces+kg tracking existed have
      // neither field — seed dualTrack:false, stockPcs:0 (never a fabricated
      // real count) and persist so this only runs once per file.
      let migrated = false;
      data.items.forEach((item) => {
        if (item.dualTrack === undefined) { item.dualTrack = false; migrated = true; }
        if (item.stockPcs === undefined) { item.stockPcs = 0; migrated = true; }
      });
      if (migrated) save();
    } else {
```

Update `addItem` — find:
```js
  function addItem({ categoryId, name, unit, weightPerPieceKg, initialStockKg }) {
    ensureLoaded();
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Item name is required');
    if (!data.categories.some((c) => c.id === categoryId)) throw new Error('Category not found');

    const resolvedUnit = unit === 'pcs' ? 'pcs' : 'kg';

    // Pieces-mode items (pure count, e.g. Covering Blocks) have no weight
    // concept at all — silently ignore any weightPerPieceKg passed for them
    // rather than erroring, since the UI simply won't show that field for
    // this unit and a stray value shouldn't block item creation.
    const weight =
      resolvedUnit === 'pcs' || weightPerPieceKg === null || weightPerPieceKg === undefined || weightPerPieceKg === ''
        ? null
        : Number(weightPerPieceKg);
    if (resolvedUnit === 'kg' && weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      throw new Error('Weight per piece must be a positive number or omitted');
    }

    const initial = initialStockKg === undefined || initialStockKg === '' ? 0 : Number(initialStockKg);
    if (!Number.isFinite(initial) || initial < 0) {
      throw new Error('Initial stock must be zero or a positive number');
    }

    const item = { id: newId('item'), categoryId, name: trimmedName, unit: resolvedUnit, weightPerPieceKg: weight, currentStockKg: initial };
    data.items.push(item);
    if (initial > 0) {
      data.movements.push({ id: newId('mv'), itemId: item.id, deltaKg: initial, reason: 'initial', note: '', at: new Date().toISOString() });
    }
    save();
    return { ...item, pieces: computePieces(item) };
  }
```
Replace with:
```js
  function addItem({ categoryId, name, unit, weightPerPieceKg, initialStockKg, dualTrack, initialStockPcs }) {
    ensureLoaded();
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Item name is required');
    if (!data.categories.some((c) => c.id === categoryId)) throw new Error('Category not found');

    const resolvedUnit = unit === 'pcs' ? 'pcs' : 'kg';
    const resolvedDualTrack = !!dualTrack;

    // Pieces-mode items (pure count, e.g. Covering Blocks) have no weight
    // concept at all — silently ignore any weightPerPieceKg passed for them
    // rather than erroring, since the UI simply won't show that field for
    // this unit and a stray value shouldn't block item creation.
    const weight =
      resolvedUnit === 'pcs' || weightPerPieceKg === null || weightPerPieceKg === undefined || weightPerPieceKg === ''
        ? null
        : Number(weightPerPieceKg);
    if (resolvedUnit === 'kg' && weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      throw new Error('Weight per piece must be a positive number or omitted');
    }

    const initial = initialStockKg === undefined || initialStockKg === '' ? 0 : Number(initialStockKg);
    if (!Number.isFinite(initial) || initial < 0) {
      throw new Error('Initial stock must be zero or a positive number');
    }
    const initialPcs = resolvedDualTrack && initialStockPcs !== undefined && initialStockPcs !== ''
      ? Number(initialStockPcs)
      : 0;
    if (resolvedDualTrack && (!Number.isFinite(initialPcs) || initialPcs < 0)) {
      throw new Error('Initial pieces must be zero or a positive number');
    }

    const item = {
      id: newId('item'), categoryId, name: trimmedName, unit: resolvedUnit,
      weightPerPieceKg: weight, currentStockKg: initial,
      dualTrack: resolvedDualTrack, stockPcs: initialPcs,
    };
    data.items.push(item);
    if (initial > 0 || (resolvedDualTrack && initialPcs > 0)) {
      data.movements.push({
        id: newId('mv'), itemId: item.id, deltaKg: initial,
        deltaPcs: resolvedDualTrack ? initialPcs : undefined,
        reason: 'initial', note: '', at: new Date().toISOString(),
      });
    }
    save();
    return { ...item, pieces: computePieces(item) };
  }
```

Update `applyDelta`, `stockIn`, `adjust`, `deduct` — find:
```js
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
```
Replace with:
```js
  function applyDelta(itemId, deltaKg, deltaPcs, reason, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    if (!Number.isFinite(deltaKg)) throw new Error('Quantity must be a number');
    if (item.dualTrack && !Number.isFinite(deltaPcs)) throw new Error('Pieces quantity must be a number');
    item.currentStockKg = item.currentStockKg + deltaKg;
    if (item.dualTrack) item.stockPcs = item.stockPcs + deltaPcs;
    data.movements.push({
      id: newId('mv'), itemId, deltaKg,
      deltaPcs: item.dualTrack ? deltaPcs : undefined,
      reason, note: note || '', at: new Date().toISOString(),
    });
    save();
    return { ...item, pieces: computePieces(item) };
  }

  function stockIn(itemId, kg, pcs, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const n = Number(kg);
    if (!item.dualTrack) {
      if (!Number.isFinite(n) || n <= 0) throw new Error('Stock-in quantity must be a positive number');
      return applyDelta(itemId, n, undefined, 'stock-in', note);
    }
    const p = Number(pcs);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Kg quantity must be a positive number');
    if (!Number.isFinite(p) || p <= 0) throw new Error('Pieces quantity must be a positive number');
    return applyDelta(itemId, n, p, 'stock-in', note);
  }

  function adjust(itemId, newTotalKg, newTotalPcs, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const n = Number(newTotalKg);
    if (!Number.isFinite(n)) throw new Error('New total must be a number');
    if (!item.dualTrack) return applyDelta(itemId, n - item.currentStockKg, undefined, 'adjustment', note);
    const p = Number(newTotalPcs);
    if (!Number.isFinite(p)) throw new Error('New pieces total must be a number');
    return applyDelta(itemId, n - item.currentStockKg, p - item.stockPcs, 'adjustment', note);
  }

  function deduct(itemId, kg, pcs, note) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const n = Number(kg);
    if (!item.dualTrack) {
      if (!Number.isFinite(n) || n <= 0) throw new Error('Deduct quantity must be a positive number');
      return applyDelta(itemId, -n, undefined, 'invoice-deduct', note);
    }
    const p = Number(pcs);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Kg quantity must be a positive number');
    if (!Number.isFinite(p) || p <= 0) throw new Error('Pieces quantity must be a positive number');
    return applyDelta(itemId, -n, -p, 'invoice-deduct', note);
  }
```

Update `updateItem` — find:
```js
  function updateItem(id, { name, weightPerPieceKg } = {}) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    if (name !== undefined) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) throw new Error('Item name is required');
      item.name = trimmedName;
    }
    if (weightPerPieceKg !== undefined) {
      if (item.unit !== 'kg') throw new Error('Weight per piece only applies to weight-tracked items');
      const weight = weightPerPieceKg === null || weightPerPieceKg === '' ? null : Number(weightPerPieceKg);
      if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
        throw new Error('Weight per piece must be a positive number or omitted');
      }
      item.weightPerPieceKg = weight;
    }
    save();
    return { ...item, pieces: computePieces(item) };
  }
```
Replace with:
```js
  function updateItem(id, { name, weightPerPieceKg, dualTrack } = {}) {
    ensureLoaded();
    const item = data.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    if (name !== undefined) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) throw new Error('Item name is required');
      item.name = trimmedName;
    }
    if (weightPerPieceKg !== undefined) {
      if (item.unit !== 'kg') throw new Error('Weight per piece only applies to weight-tracked items');
      const weight = weightPerPieceKg === null || weightPerPieceKg === '' ? null : Number(weightPerPieceKg);
      if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
        throw new Error('Weight per piece must be a positive number or omitted');
      }
      item.weightPerPieceKg = weight;
    }
    if (dualTrack !== undefined) {
      // Turning this on never fabricates a real Pieces count — it just
      // starts the new counter at 0 if it isn't already tracked; turning it
      // off leaves stockPcs dormant (not reset), so no data is lost if it's
      // switched back on later.
      const next = !!dualTrack;
      if (next && item.stockPcs === undefined) item.stockPcs = 0;
      item.dualTrack = next;
    }
    save();
    return { ...item, pieces: computePieces(item) };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && node --test stockStore.test.js`
Expected: all PASS, including every pre-existing test (this step also catches any signature-order mistake breaking old call sites).

- [ ] **Step 5: Commit**

```bash
git add app/stockStore.js app/stockStore.test.js
git commit -m "feat(narayani-steels): per-item dual pieces+kg stock tracking in stockStore.js"
```

---

### Task 3: stockStore.js — `getReport()` pcs columns for dual-track items

**Files:**
- Modify: `app/stockStore.js`
- Test: `app/stockStore.test.js`

**Interfaces:**
- Consumes: `item.dualTrack`, `item.stockPcs`, `movement.deltaPcs` from Task 2.
- Produces: report rows carry `dualTrack: boolean`, and when true, additionally `openingPcs`/`stockInPcs`/`soldPcs`/`adjustmentsPcs`/`closingPcs` — Task 7 (`reports.html`) renders these.

- [ ] **Step 1: Write a failing test**

Append to `app/stockStore.test.js`:
```js
test('getReport includes pcs columns for a dualTrack item, reconciling independently of the kg column', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'MS Pipe Dual', unit: 'kg', dualTrack: true, initialStockKg: 0, initialStockPcs: 0 });
  store.stockIn(item.id, 200, 80, 'received');
  store.deduct(item.id, 50, 20, 'Chitti/Invoice');

  const report = store.getReport({ type: 'monthly', date: new Date().toISOString() });
  const row = report.rows.find((r) => r.itemId === item.id);
  assert.equal(row.dualTrack, true);
  assert.equal(row.stockIn, 200);
  assert.equal(row.sold, 50);
  assert.equal(row.closing, 150);
  assert.equal(row.stockInPcs, 80);
  assert.equal(row.soldPcs, 20);
  assert.equal(row.closingPcs, 60);
  assert.equal(row.openingPcs, row.closingPcs - row.stockInPcs + row.soldPcs - row.adjustmentsPcs);
});

test('getReport omits pcs columns for a non-dualTrack item', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const item = store.addItem({ categoryId: cats[0].id, name: 'TMT Plain', unit: 'kg', initialStockKg: 100 });
  const report = store.getReport({ type: 'monthly', date: new Date().toISOString() });
  const row = report.rows.find((r) => r.itemId === item.id);
  assert.equal(row.dualTrack, false);
  assert.equal('closingPcs' in row, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test stockStore.test.js`
Expected: FAIL — `row.dualTrack` undefined, `row.closingPcs` undefined.

- [ ] **Step 3: Implement in `getReport()`**

Find:
```js
      return {
        itemId: item.id,
        name: item.name,
        categoryId: item.categoryId,
        unit: item.unit,
        opening: round2(opening),
        stockIn: round2(stockIn),
        sold: round2(sold),
        adjustments: round2(adjustments),
        closing: round2(closing),
      };
    });
```
Replace with:
```js
      const row = {
        itemId: item.id,
        name: item.name,
        categoryId: item.categoryId,
        unit: item.unit,
        dualTrack: !!item.dualTrack,
        opening: round2(opening),
        stockIn: round2(stockIn),
        sold: round2(sold),
        adjustments: round2(adjustments),
        closing: round2(closing),
      };

      if (item.dualTrack) {
        const afterPeriodDeltaPcs = itemMovements
          .filter((m) => new Date(m.at).getTime() >= endMs)
          .reduce((sum, m) => sum + (m.deltaPcs || 0), 0);
        const closingPcs = item.stockPcs - afterPeriodDeltaPcs;
        const stockInPcs = inPeriod.filter((m) => m.reason === 'stock-in' || m.reason === 'initial').reduce((s, m) => s + (m.deltaPcs || 0), 0);
        const soldPcs = -inPeriod.filter((m) => m.reason === 'invoice-deduct').reduce((s, m) => s + (m.deltaPcs || 0), 0);
        const adjustmentsPcs = inPeriod.filter((m) => m.reason === 'adjustment').reduce((s, m) => s + (m.deltaPcs || 0), 0);
        const openingPcs = closingPcs - stockInPcs + soldPcs - adjustmentsPcs;
        row.openingPcs = round2(openingPcs);
        row.stockInPcs = round2(stockInPcs);
        row.soldPcs = round2(soldPcs);
        row.adjustmentsPcs = round2(adjustmentsPcs);
        row.closingPcs = round2(closingPcs);
      }

      return row;
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && node --test stockStore.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/stockStore.js app/stockStore.test.js
git commit -m "feat(narayani-steels): dual pcs+kg columns in stock reports"
```

---

### Task 4: server.js — routes accept `pcs`/`newTotalPcs`/`dualTrack`/`initialStockPcs`

**Files:**
- Modify: `app/server.js`
- Test: `app/server.test.js`

**Interfaces:**
- Consumes: `stockStore.stockIn(itemId, kg, pcs, note)`, `.adjust(itemId, newTotalKg, newTotalPcs, note)`, `.deduct(itemId, kg, pcs, note)` from Task 2 (positional order matters).

- [ ] **Step 1: Write a failing test**

Append to `app/server.test.js` (near the existing stock route tests):
```js
test('dualTrack stock item: stock-in/deduct/adjust require both kg and pcs; report exposes pcs columns', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const item = await (await postJson(server, '/api/stock/items', {
      categoryId: cats[0].id, name: 'Dual Test Item', unit: 'kg', dualTrack: true, initialStockKg: 0, initialStockPcs: 0,
    })).json();
    assert.equal(item.dualTrack, true);

    const badStockIn = await postJson(server, `/api/stock/items/${item.id}/stock-in`, { kg: 100 }); // pcs missing
    assert.equal(badStockIn.status, 400);

    const stockIn = await postJson(server, `/api/stock/items/${item.id}/stock-in`, { kg: 100, pcs: 40 });
    assert.equal(stockIn.status, 200);
    assert.equal((await stockIn.json()).stockPcs, 40);

    const deduct = await postJson(server, `/api/stock/items/${item.id}/deduct`, { kg: 10, pcs: 4, note: 'Chitti/Invoice' });
    assert.equal(deduct.status, 200);
    const deducted = await deduct.json();
    assert.equal(deducted.currentStockKg, 90);
    assert.equal(deducted.stockPcs, 36);

    const adjust = await postJson(server, `/api/stock/items/${item.id}/adjust`, { newTotalKg: 80, newTotalPcs: 30 });
    assert.equal(adjust.status, 200);
    const adjusted = await adjust.json();
    assert.equal(adjusted.currentStockKg, 80);
    assert.equal(adjusted.stockPcs, 30);

    const report = await (await fetch(`${baseUrl(server)}/api/stock/report?type=monthly`)).json();
    const row = report.rows.find((r) => r.itemId === item.id);
    assert.equal(row.dualTrack, true);
    assert.ok('closingPcs' in row);
  } finally {
    await close(server);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test server.test.js`
Expected: FAIL — the old `stockIn(id, kg, note)`/`deduct(id, kg, note)` signatures treat `pcs`/`note` positionally wrong, so `badStockIn` won't 400 as expected (it'll either succeed or throw the wrong error), and `dualTrack`/`stockPcs` fields won't come back correctly until Task 2 + this task's route changes are both in place. (If Task 2 is already committed, confirm this test fails specifically because the routes haven't been updated yet.)

- [ ] **Step 3: Update the three routes in `app/server.js`**

Find:
```js
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
```
Replace with:
```js
app.post('/api/stock/items/:id/stock-in', (req, res) => {
  try {
    res.json(stockStore.stockIn(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/adjust', (req, res) => {
  try {
    res.json(stockStore.adjust(req.params.id, req.body && req.body.newTotalKg, req.body && req.body.newTotalPcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/deduct', (req, res) => {
  try {
    res.json(stockStore.deduct(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});
```
(`addItem`/`updateItem` routes already pass `req.body` through unchanged — no server.js change needed there, since Task 2 added the new fields to `stockStore.js`'s own destructuring.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && node --test server.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server.js app/server.test.js
git commit -m "feat(narayani-steels): wire dual pcs+kg params through stock API routes"
```

---

### Task 5: stock.html — dual-track checkbox on Add/Edit Item, dual inputs on Stock In/Adjust

**Files:**
- Modify: `app/public/stock.html`

**Interfaces:**
- Consumes: `POST /api/stock/items` accepting `dualTrack`/`initialStockPcs`, `PATCH /api/stock/items/:id` accepting `dualTrack`, `POST .../stock-in` and `.../adjust` accepting `pcs`/`newTotalPcs` (Task 4).

No automated test harness for this file (browser-only JS) — verify manually per Step 6.

- [ ] **Step 1: Add the checkbox + pcs field to the Add Item form**

Find:
```html
    <div class="grid2">
      <div class="fg" id="new-item-weight-fg"><label>Weight/Piece (kg, optional)</label><input id="new-item-weight" type="number" min="0" step="any" placeholder="10.5" oninput="updateNewItemPreview()"></div>
      <div class="fg"><label id="new-item-stock-label">Initial Stock (kg)</label><input id="new-item-stock" type="number" min="0" step="any" placeholder="0" oninput="updateNewItemPreview()"></div>
    </div>
    <div class="pieces-preview" id="new-item-preview">Pieces: —</div>
    <div class="err" id="item-err" style="display:none"></div>
    <button class="btn-p" onclick="saveNewItem()">+ Add Item</button>
```
Replace with:
```html
    <div class="grid2">
      <div class="fg" id="new-item-weight-fg"><label>Weight/Piece (kg, optional)</label><input id="new-item-weight" type="number" min="0" step="any" placeholder="10.5" oninput="updateNewItemPreview()"></div>
      <div class="fg"><label id="new-item-stock-label">Initial Stock (kg)</label><input id="new-item-stock" type="number" min="0" step="any" placeholder="0" oninput="updateNewItemPreview()"></div>
    </div>
    <div class="pieces-preview" id="new-item-preview">Pieces: —</div>
    <div class="fg" style="flex-direction:row;align-items:center;gap:7px">
      <input id="new-item-dualtrack" type="checkbox" style="width:16px;height:16px" onchange="onNewItemDualTrackChange()">
      <label for="new-item-dualtrack" style="margin:0">Track Pieces + Kg together (both required at Stock In)</label>
    </div>
    <div class="grid2" id="new-item-dualpcs-fg" style="display:none">
      <div class="fg"><label>Initial Stock — Pieces</label><input id="new-item-stock-pcs" type="number" min="0" step="1" placeholder="0"></div>
    </div>
    <div class="err" id="item-err" style="display:none"></div>
    <button class="btn-p" onclick="saveNewItem()">+ Add Item</button>
```

- [ ] **Step 2: Add `onNewItemDualTrackChange()` and update `saveNewItem()`**

Find:
```js
async function saveNewItem() {
  const categoryId = document.getElementById('new-item-cat').value;
  const name = document.getElementById('new-item-name').value;
  const weightRaw = document.getElementById('new-item-weight').value;
  const weightPerPieceKg = newItemUnit === 'pcs' || weightRaw === '' ? null : parseFloat(weightRaw);
  const initialStockKg = parseFloat(document.getElementById('new-item-stock').value) || 0;
  const errEl = document.getElementById('item-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, name, unit: newItemUnit, weightPerPieceKg, initialStockKg }),
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
```
Replace with:
```js
function onNewItemDualTrackChange() {
  const on = document.getElementById('new-item-dualtrack').checked;
  document.getElementById('new-item-dualpcs-fg').style.display = on ? 'grid' : 'none';
}

async function saveNewItem() {
  const categoryId = document.getElementById('new-item-cat').value;
  const name = document.getElementById('new-item-name').value;
  const weightRaw = document.getElementById('new-item-weight').value;
  const weightPerPieceKg = newItemUnit === 'pcs' || weightRaw === '' ? null : parseFloat(weightRaw);
  const initialStockKg = parseFloat(document.getElementById('new-item-stock').value) || 0;
  const dualTrack = document.getElementById('new-item-dualtrack').checked;
  const initialStockPcs = dualTrack ? (parseFloat(document.getElementById('new-item-stock-pcs').value) || 0) : 0;
  const errEl = document.getElementById('item-err');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${API}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, name, unit: newItemUnit, weightPerPieceKg, initialStockKg, dualTrack, initialStockPcs }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save item');
    document.getElementById('new-item-name').value = '';
    document.getElementById('new-item-weight').value = '';
    document.getElementById('new-item-stock').value = '';
    document.getElementById('new-item-stock-pcs').value = '';
    document.getElementById('new-item-dualtrack').checked = false;
    onNewItemDualTrackChange();
    updateNewItemPreview();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}
```

- [ ] **Step 3: Dual-track inputs for Stock In / Adjust, and the checkbox on Edit**

Find:
```js
function renderExpandedRow(item) {
  const unitLabel = item.unit === 'pcs' ? 'pcs' : 'kg';
  if (openRow.mode === 'stock-in') {
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" min="0" step="any" placeholder="${item.unit === 'pcs' ? 'Pieces received' : 'Kg received'}">
      ${rowUnitToggle(item)}
      <button class="btn-p btn-sm" onclick="submitStockIn('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  if (openRow.mode === 'adjust') {
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" step="any" placeholder="New true total (${unitLabel})" value="${fmtKg(item.currentStockKg)}">
      ${rowUnitToggle(item)}
      <button class="btn-p btn-sm" onclick="submitAdjust('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  if (openRow.mode === 'edit') {
    const weightField = item.unit === 'kg'
      ? `<input id="edit-weight" type="number" min="0" step="any" placeholder="Weight/Piece (kg, optional)" value="${item.weightPerPieceKg ?? ''}">`
      : '';
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="edit-name" type="text" placeholder="Item name" value="${item.name}">
      ${weightField}
      <button class="btn-p btn-sm" onclick="submitEdit('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  return `<tr class="hist-row"><td colspan="5" id="history-cell">Loading history…</td></tr>`;
}
```
Replace with:
```js
function renderExpandedRow(item) {
  const unitLabel = item.unit === 'pcs' ? 'pcs' : 'kg';
  if (openRow.mode === 'stock-in') {
    if (item.dualTrack) {
      return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
        <input id="row-input-kg" type="number" min="0" step="any" placeholder="Kg received">
        <input id="row-input-pcs" type="number" min="0" step="1" placeholder="Pieces received">
        <button class="btn-p btn-sm" onclick="submitStockIn('${item.id}')">Save</button>
        <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
        <span class="err" id="row-err" style="display:none"></span>
      </div></td></tr>`;
    }
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" min="0" step="any" placeholder="${item.unit === 'pcs' ? 'Pieces received' : 'Kg received'}">
      ${rowUnitToggle(item)}
      <button class="btn-p btn-sm" onclick="submitStockIn('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  if (openRow.mode === 'adjust') {
    if (item.dualTrack) {
      return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
        <input id="row-input-kg" type="number" step="any" placeholder="New true total (kg)" value="${fmtKg(item.currentStockKg)}">
        <input id="row-input-pcs" type="number" step="1" placeholder="New true total (pcs)" value="${item.stockPcs}">
        <button class="btn-p btn-sm" onclick="submitAdjust('${item.id}')">Save</button>
        <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
        <span class="err" id="row-err" style="display:none"></span>
      </div></td></tr>`;
    }
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="row-input" type="number" step="any" placeholder="New true total (${unitLabel})" value="${fmtKg(item.currentStockKg)}">
      ${rowUnitToggle(item)}
      <button class="btn-p btn-sm" onclick="submitAdjust('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  if (openRow.mode === 'edit') {
    const weightField = item.unit === 'kg' && !item.dualTrack
      ? `<input id="edit-weight" type="number" min="0" step="any" placeholder="Weight/Piece (kg, optional)" value="${item.weightPerPieceKg ?? ''}">`
      : '';
    return `<tr class="hist-row"><td colspan="5"><div class="inline-form">
      <input id="edit-name" type="text" placeholder="Item name" value="${item.name}">
      ${weightField}
      <label style="display:flex;align-items:center;gap:5px;font-size:13px"><input id="edit-dualtrack" type="checkbox" ${item.dualTrack ? 'checked' : ''}> Track Pieces + Kg together</label>
      <button class="btn-p btn-sm" onclick="submitEdit('${item.id}')">Save</button>
      <button class="btn-s btn-sm" onclick="closeRow()">Cancel</button>
      <span class="err" id="row-err" style="display:none"></span>
    </div></td></tr>`;
  }
  return `<tr class="hist-row"><td colspan="5" id="history-cell">Loading history…</td></tr>`;
}
```

- [ ] **Step 4: Update `submitStockIn`, `submitAdjust`, `submitEdit` to branch on `item.dualTrack`**

Find:
```js
async function submitStockIn(itemId) {
  const item = items.find((i) => i.id === itemId);
  const kg = rowInputToStockValue(item);
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
  const item = items.find((i) => i.id === itemId);
  const newTotalKg = rowInputToStockValue(item);
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

async function submitEdit(itemId) {
  const item = items.find((i) => i.id === itemId);
  const name = document.getElementById('edit-name').value;
  const weightEl = document.getElementById('edit-weight');
  const errEl = document.getElementById('row-err');
  const body = { name };
  if (weightEl) {
    const raw = weightEl.value;
    body.weightPerPieceKg = raw === '' ? null : parseFloat(raw);
  }
  try {
    const res = await fetch(`${API}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody.error || 'Could not save');
    closeRow();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}
```
Replace with:
```js
async function submitStockIn(itemId) {
  const item = items.find((i) => i.id === itemId);
  const errEl = document.getElementById('row-err');
  const payload = item.dualTrack
    ? { kg: parseFloat(document.getElementById('row-input-kg').value), pcs: parseFloat(document.getElementById('row-input-pcs').value) }
    : { kg: rowInputToStockValue(item) };
  try {
    const res = await fetch(`${API}/items/${itemId}/stock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  const item = items.find((i) => i.id === itemId);
  const errEl = document.getElementById('row-err');
  const payload = item.dualTrack
    ? { newTotalKg: parseFloat(document.getElementById('row-input-kg').value), newTotalPcs: parseFloat(document.getElementById('row-input-pcs').value) }
    : { newTotalKg: rowInputToStockValue(item) };
  try {
    const res = await fetch(`${API}/items/${itemId}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

async function submitEdit(itemId) {
  const item = items.find((i) => i.id === itemId);
  const name = document.getElementById('edit-name').value;
  const weightEl = document.getElementById('edit-weight');
  const dualTrackEl = document.getElementById('edit-dualtrack');
  const errEl = document.getElementById('row-err');
  const body = { name };
  if (weightEl) {
    const raw = weightEl.value;
    body.weightPerPieceKg = raw === '' ? null : parseFloat(raw);
  }
  if (dualTrackEl) body.dualTrack = dualTrackEl.checked;
  try {
    const res = await fetch(`${API}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody.error || 'Could not save');
    closeRow();
    await loadAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}
```

- [ ] **Step 5: Fix the Stock column's unit label for dual-track items and keep the Pieces column real**

`renderItems()`'s `stockLabel` currently labels the Stock column `pcs` whenever `item.unit==='pcs'` — for a dual-track item, `currentStockKg` is always a real kg quantity regardless of `unit`, so this must always read `kg` for dual-track items. Find (inside `renderItems()`):
```js
      const stockLabel = `${fmtKg(item.currentStockKg)} ${item.unit === 'pcs' ? 'pcs' : 'kg'}`;
```
Replace with:
```js
      const stockLabel = `${fmtKg(item.currentStockKg)} ${item.unit === 'pcs' && !item.dualTrack ? 'pcs' : 'kg'}`;
```
This is the only item-list rendering change needed for dual-track display — the table already has a separate "Pieces" column (`item.pieces`, from Task 2's `computePieces()`), which now shows a real independently-tracked count instead of a derived estimate whenever `item.dualTrack` is true. No new columns.

- [ ] **Step 6: Manually verify**

```bash
cd app && (node server.js > /tmp/ns-verify.log 2>&1 &) && sleep 1.5
CAT=$(curl -s http://127.0.0.1:3300/api/stock/categories | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST http://127.0.0.1:3300/api/stock/items -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CAT\",\"name\":\"__TEST_DUAL__\",\"unit\":\"kg\",\"dualTrack\":true,\"initialStockKg\":0,\"initialStockPcs\":0}"
```
Note the returned `"id"`, then:
```bash
ITEM=<paste the id>
curl -s -X POST http://127.0.0.1:3300/api/stock/items/$ITEM/stock-in -H 'Content-Type: application/json' -d '{"kg":100,"pcs":40}'
curl -s -X DELETE http://127.0.0.1:3300/api/stock/items/$ITEM
pkill -f "node server.js"
```
Expected: stock-in response shows `currentStockKg:100, stockPcs:40`; delete cleans up (confirm no leftover test data, same discipline as the earlier report-bug investigation this session). Then do one real browser pass (Claude-in-Chrome or manual): add a dual-track item via the UI form, Stock In with both fields, Adjust, Edit toggling the checkbox off and back on — confirm no console errors and the table shows the right numbers throughout.

- [ ] **Step 7: Commit**

```bash
git add app/public/stock.html
git commit -m "feat(narayani-steels): dual pieces+kg tracking UI on Stock page"
```

---

### Task 6: stock.html — zero-stock items sorted to the bottom with a divider

**Files:**
- Modify: `app/public/stock.html`

- [ ] **Step 1: Add a zero-stock helper and CSS**

Find:
```css
.stbl td.neg{color:#dc2626;font-weight:700}
```
Replace with:
```css
.stbl td.neg{color:#dc2626;font-weight:700}
.stbl tr.zero-row{opacity:.45}
.stbl tr.stock-divider td{padding:0;border-top:2px dashed #ddd;border-bottom:none;height:1px}
```

- [ ] **Step 2: Partition and render with a divider**

Find:
```js
function renderItems() {
  const heading = document.getElementById('items-heading');
  const searching = searchQuery.length > 0;
  let visibleItems;
  if (searching) {
    heading.textContent = `Search results for "${document.getElementById('stock-search').value.trim()}"`;
    visibleItems = items.filter((i) => i.name.toLowerCase().includes(searchQuery));
  } else {
    const cat = categories.find((c) => c.id === selectedCatId);
    heading.textContent = cat ? `Items — ${cat.name}` : 'Items';
    visibleItems = items.filter((i) => i.categoryId === selectedCatId);
  }
  const tbody = document.getElementById('items-tbody');
  document.getElementById('empty-note').style.display = visibleItems.length ? 'none' : 'block';
  document.getElementById('empty-note').textContent = searching ? 'No items match your search.' : 'No items in this category yet.';
  tbody.innerHTML = visibleItems
    .map((item) => {
      const stockLabel = `${fmtKg(item.currentStockKg)} ${item.unit === 'pcs' && !item.dualTrack ? 'pcs' : 'kg'}`;
      const nameCell = searching ? `${item.name} <span style="color:#999;font-size:11px">(${catName(item.categoryId)})</span>` : item.name;
      const rows = [
        `<tr><td>${nameCell}</td><td>${item.unit === 'pcs' ? '—' : (item.weightPerPieceKg ?? '—')}</td><td class="r${item.currentStockKg < 0 ? ' neg' : ''}">${stockLabel}</td><td class="r">${item.pieces ?? '—'}</td><td class="actions"><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','stock-in')">+ Stock In</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','adjust')">Adjust</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','edit')">Edit</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','history')">History</button><button class="btn-s btn-sm" onclick="deleteItemPrompt('${item.id}')" style="color:#dc2626">Delete</button></td></tr>`,
      ];
      if (openRow && openRow.itemId === item.id) rows.push(renderExpandedRow(item));
      return rows.join('');
    })
    .join('');
}
```
Replace with:
```js
function isZeroStock(item) {
  if (item.dualTrack) return item.currentStockKg === 0 && item.stockPcs === 0;
  return item.currentStockKg === 0;
}

function renderItemRow(item, searching, zero) {
  const stockLabel = `${fmtKg(item.currentStockKg)} ${item.unit === 'pcs' && !item.dualTrack ? 'pcs' : 'kg'}`;
  const nameCell = searching ? `${item.name} <span style="color:#999;font-size:11px">(${catName(item.categoryId)})</span>` : item.name;
  const rows = [
    `<tr class="${zero ? 'zero-row' : ''}"><td>${nameCell}</td><td>${item.unit === 'pcs' || item.dualTrack ? '—' : (item.weightPerPieceKg ?? '—')}</td><td class="r${item.currentStockKg < 0 ? ' neg' : ''}">${stockLabel}</td><td class="r">${item.pieces ?? '—'}</td><td class="actions"><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','stock-in')">+ Stock In</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','adjust')">Adjust</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','edit')">Edit</button><button class="btn-s btn-sm" onclick="toggleRow('${item.id}','history')">History</button><button class="btn-s btn-sm" onclick="deleteItemPrompt('${item.id}')" style="color:#dc2626">Delete</button></td></tr>`,
  ];
  if (openRow && openRow.itemId === item.id) rows.push(renderExpandedRow(item));
  return rows.join('');
}

function renderItems() {
  const heading = document.getElementById('items-heading');
  const searching = searchQuery.length > 0;
  let visibleItems;
  if (searching) {
    heading.textContent = `Search results for "${document.getElementById('stock-search').value.trim()}"`;
    visibleItems = items.filter((i) => i.name.toLowerCase().includes(searchQuery));
  } else {
    const cat = categories.find((c) => c.id === selectedCatId);
    heading.textContent = cat ? `Items — ${cat.name}` : 'Items';
    visibleItems = items.filter((i) => i.categoryId === selectedCatId);
  }
  const tbody = document.getElementById('items-tbody');
  document.getElementById('empty-note').style.display = visibleItems.length ? 'none' : 'block';
  document.getElementById('empty-note').textContent = searching ? 'No items match your search.' : 'No items in this category yet.';

  // Stable partition: items with any stock left first (original order kept),
  // then a divider, then zero-stock items (also original order kept) — no
  // alphabetizing, negative (over-deducted) stock stays in the top group
  // since it needs attention, not burial at the bottom.
  const inStock = visibleItems.filter((i) => !isZeroStock(i));
  const outStock = visibleItems.filter(isZeroStock);

  let html = inStock.map((item) => renderItemRow(item, searching, false)).join('');
  if (inStock.length && outStock.length) html += `<tr class="stock-divider"><td colspan="5"></td></tr>`;
  html += outStock.map((item) => renderItemRow(item, searching, true)).join('');
  tbody.innerHTML = html;
}
```

- [ ] **Step 2: Manually verify**

Start the server locally, open Stock, and confirm: a category with a mix of zero and non-zero stock items shows the divider once, in-stock items on top in their original order, zero-stock items dimmed below it; a category with no zero-stock items shows no divider; an item with negative stock stays in the top group.

- [ ] **Step 3: Commit**

```bash
git add app/public/stock.html
git commit -m "feat(narayani-steels): sort zero-stock items to the bottom on the Stock page"
```

---

### Task 7: reports.html — combined pcs/kg cells for dual-track rows

**Files:**
- Modify: `app/public/reports.html`

**Interfaces:**
- Consumes: `row.dualTrack`, `row.openingPcs`/`stockInPcs`/`soldPcs`/`adjustmentsPcs`/`closingPcs` from Task 3.

- [ ] **Step 1: Add a combined-cell formatter and use it for dual-track rows**

Find:
```js
function sumRows(rows) {
  return rows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      stockIn: acc.stockIn + r.stockIn,
      sold: acc.sold + r.sold,
      adjustments: acc.adjustments + r.adjustments,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, stockIn: 0, sold: 0, adjustments: 0, closing: 0 }
  );
}
```
Replace with:
```js
function sumRows(rows) {
  return rows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      stockIn: acc.stockIn + r.stockIn,
      sold: acc.sold + r.sold,
      adjustments: acc.adjustments + r.adjustments,
      closing: acc.closing + r.closing,
      openingPcs: acc.openingPcs + (r.openingPcs || 0),
      stockInPcs: acc.stockInPcs + (r.stockInPcs || 0),
      soldPcs: acc.soldPcs + (r.soldPcs || 0),
      adjustmentsPcs: acc.adjustmentsPcs + (r.adjustmentsPcs || 0),
      closingPcs: acc.closingPcs + (r.closingPcs || 0),
      hasDual: acc.hasDual || !!r.dualTrack,
    }),
    { opening: 0, stockIn: 0, sold: 0, adjustments: 0, closing: 0, openingPcs: 0, stockInPcs: 0, soldPcs: 0, adjustmentsPcs: 0, closingPcs: 0, hasDual: false }
  );
}

// Renders a quantity cell as the plain kg/count number for a normal row or
// category, or as "X pcs / Y kg" when pieces are tracked independently
// (a single dual-track item, or a category subtotal containing at least
// one). `signedFmt` formats the kg/count side exactly like the caller
// already did (signed() for movement columns, plain rounding for
// opening/closing) — passed in so this helper doesn't need to know which
// column it's rendering.
function combinedCell(kgVal, pcsVal, isDual, signedFmt) {
  if (!isDual) return signedFmt(kgVal);
  return `${signedFmt(pcsVal)} pcs / ${signedFmt(kgVal)} kg`;
}
```

- [ ] **Step 2: Use `combinedCell()` in `renderRows()`**

Find:
```js
  catIds.forEach((catId) => {
    const items = byCat[catId];
    const totals = sumRows(items);
    const collapsed = collapsedCats.has(catId);
    html += `<tr class="cat-row${collapsed ? ' collapsed' : ''}" onclick="toggleCat('${catId}')">
      <td>${catName(catId)}</td>
      <td>${fmtQty(totals.opening, items[0].unit)}</td>
      <td class="in">${signed(totals.stockIn)}</td>
      <td class="sold">${totals.sold ? '-' + Math.round(totals.sold * 100) / 100 : 0}</td>
      <td class="${totals.adjustments < 0 ? 'adj-neg' : ''}">${signed(totals.adjustments)}</td>
      <td>${fmtQty(totals.closing, items[0].unit)}</td>
    </tr>`;
    items.forEach((r) => {
      html += `<tr class="item-row${collapsed ? ' hidden' : ''}">
        <td style="padding-left:16px">${r.name}</td>
        <td>${fmtQty(r.opening, r.unit)}</td>
        <td class="in">${signed(r.stockIn)}</td>
        <td class="sold">${r.sold ? '-' + Math.round(r.sold * 100) / 100 : 0}</td>
        <td class="${r.adjustments < 0 ? 'adj-neg' : ''}">${signed(r.adjustments)}</td>
        <td>${fmtQty(r.closing, r.unit)}</td>
      </tr>`;
    });
  });
```
Replace with:
```js
  catIds.forEach((catId) => {
    const items = byCat[catId];
    const totals = sumRows(items);
    const collapsed = collapsedCats.has(catId);
    const soldFmt = (v) => (v ? '-' + Math.round(v * 100) / 100 : 0);
    html += `<tr class="cat-row${collapsed ? ' collapsed' : ''}" onclick="toggleCat('${catId}')">
      <td>${catName(catId)}</td>
      <td>${combinedCell(totals.opening, totals.openingPcs, totals.hasDual, (v) => fmtQty(v, items[0].unit))}</td>
      <td class="in">${combinedCell(totals.stockIn, totals.stockInPcs, totals.hasDual, signed)}</td>
      <td class="sold">${combinedCell(totals.sold, totals.soldPcs, totals.hasDual, soldFmt)}</td>
      <td class="${totals.adjustments < 0 ? 'adj-neg' : ''}">${combinedCell(totals.adjustments, totals.adjustmentsPcs, totals.hasDual, signed)}</td>
      <td>${combinedCell(totals.closing, totals.closingPcs, totals.hasDual, (v) => fmtQty(v, items[0].unit))}</td>
    </tr>`;
    items.forEach((r) => {
      const rSoldFmt = (v) => (v ? '-' + Math.round(v * 100) / 100 : 0);
      html += `<tr class="item-row${collapsed ? ' hidden' : ''}">
        <td style="padding-left:16px">${r.name}</td>
        <td>${combinedCell(r.opening, r.openingPcs, r.dualTrack, (v) => fmtQty(v, r.unit))}</td>
        <td class="in">${combinedCell(r.stockIn, r.stockInPcs, r.dualTrack, signed)}</td>
        <td class="sold">${combinedCell(r.sold, r.soldPcs, r.dualTrack, rSoldFmt)}</td>
        <td class="${r.adjustments < 0 ? 'adj-neg' : ''}">${combinedCell(r.adjustments, r.adjustmentsPcs, r.dualTrack, signed)}</td>
        <td>${combinedCell(r.closing, r.closingPcs, r.dualTrack, (v) => fmtQty(v, r.unit))}</td>
      </tr>`;
    });
  });
```

- [ ] **Step 3: Manually verify**

With a dual-track item stocked-in/deducted (from Task 5's manual verification), open `reports.html` for the relevant category/period and confirm the row and its category subtotal show `"X pcs / Y kg"` in every quantity cell, while a category with no dual-track items still shows plain numbers exactly as before.

- [ ] **Step 4: Commit**

```bash
git add app/public/reports.html
git commit -m "feat(narayani-steels): show combined pieces+kg figures for dual-track items in Reports"
```

---

### Task 8: final-invoice-NS.html — Chitti requires both Qty(kg) and Pcs for dual-track stock items

**Files:**
- Modify: `final-invoice-NS.html` (root)
- Copy to: `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: `item.dualTrack` from the `/api/stock/items` response (Task 2); `POST /api/stock/items/:id/deduct` accepting `{kg, pcs, note}` (Task 4).

- [ ] **Step 1: Add `rowDeductable()` and rewrite `unmatchedItemNames()`, `updateStockBadge()`, `performStockDeduction()`, `deductStock()`**

Find:
```js
function unmatchedItemNames(){
  // Rows that have a real name + quantity entered but never got linked to a
  // stock item — these are silently excluded from performStockDeduction, so
  // surface them explicitly wherever deduction results are reported instead
  // of letting "Deducted: X, Y" quietly imply everything was deducted.
  return rows.filter(r=>r.name.trim()&&!r.stockItemId&&((parseFloat(r.q)||0)>0||(parseFloat(r.p)||0)>0)).map(r=>r.name);
}
async function performStockDeduction(){
  const pending=rows.filter(r=>r.stockItemId&&rowStockQty(r)>0&&!r._deducted);
  const succeeded=[];let failure=null;
  for(const r of pending){
    const item=stockItems.find(it=>it.id===r.stockItemId);
    const isPcs=item&&item.unit==='pcs';
    const qty=rowStockQty(r);
    try{
      // The stock API's kg field is a generic tracked-quantity field — for
      // pcs items it holds piece count, same convention as stockStore.js.
      const res=await fetch(`/api/stock/items/${r.stockItemId}/deduct`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kg:qty,note:'Chitti/Invoice'})});
      const body=await res.json();
      if(!res.ok)throw new Error(body.error||'Deduct failed');
      r._deducted=true;succeeded.push(`${qty}${isPcs?' pcs':'kg'} ${r.name}`);
    }catch(err){failure=err.message;break;}
  }
  return{succeeded,failure};
}
async function deductStock(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  if(btn.dataset.deducted==='true')return;
  const hasPending=rows.some(r=>r.stockItemId&&rowStockQty(r)>0&&!r._deducted);
  if(!hasPending)return;
```
Replace with:
```js
function rowDeductable(row){
  if(!row.stockItemId)return false;
  const item=stockItems.find(it=>it.id===row.stockItemId);
  if(!item)return false;
  if(item.dualTrack)return(parseFloat(row.q)||0)>0&&(parseFloat(row.p)||0)>0;
  return rowStockQty(row)>0;
}
function unmatchedItemNames(){
  // Rows that have a real name + quantity entered but either never got
  // linked to a stock item, or ARE linked to a dual-track item missing one
  // of its two required fields — both cases are silently excluded from
  // performStockDeduction, so surface them explicitly wherever deduction
  // results are reported instead of letting "Deducted: X, Y" quietly imply
  // everything was deducted.
  return rows.filter(r=>{
    if(!r.name.trim())return false;
    const hasAny=(parseFloat(r.q)||0)>0||(parseFloat(r.p)||0)>0;
    if(!hasAny)return false;
    if(!r.stockItemId)return true;
    const item=stockItems.find(it=>it.id===r.stockItemId);
    return item&&item.dualTrack&&!rowDeductable(r);
  }).map(r=>{
    const item=r.stockItemId&&stockItems.find(it=>it.id===r.stockItemId);
    return item&&item.dualTrack?`${r.name} (needs both Qty(kg) and Pcs)`:r.name;
  });
}
async function performStockDeduction(){
  const pending=rows.filter(r=>rowDeductable(r)&&!r._deducted);
  const succeeded=[];let failure=null;
  for(const r of pending){
    const item=stockItems.find(it=>it.id===r.stockItemId);
    const isPcs=item&&item.unit==='pcs';
    const body={note:'Chitti/Invoice'};
    let label;
    if(item.dualTrack){
      body.kg=parseFloat(r.q)||0;body.pcs=parseFloat(r.p)||0;
      label=`${body.pcs} pcs / ${body.kg}kg ${r.name}`;
    }else{
      // The stock API's kg field is a generic tracked-quantity field — for
      // pcs items it holds piece count, same convention as stockStore.js.
      const qty=rowStockQty(r);
      body.kg=qty;
      label=`${qty}${isPcs?' pcs':'kg'} ${r.name}`;
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
async function deductStock(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  if(btn.dataset.deducted==='true')return;
  const hasPending=rows.some(r=>rowDeductable(r)&&!r._deducted);
  if(!hasPending)return;
```

- [ ] **Step 2: Rewrite `updateStockBadge()`**

Find:
```js
function updateStockBadge(i){
  const badge=document.getElementById('stockbadge-'+i);
  if(!badge)return;
  const row=rows[i];
  const hasQty=(parseFloat(row.q)||0)>0||(parseFloat(row.p)||0)>0;
  if(!row.name.trim()||!hasQty){badge.textContent='';badge.title='';}
  else if(row.stockItemId){badge.textContent='🔗';badge.title='Linked to stock — will be deducted';}
  else{badge.textContent='⚠';badge.title='Not linked to a stock item — will NOT be deducted from stock. Pick the item from the dropdown suggestions to link it.';}
}
```
Replace with:
```js
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
```

- [ ] **Step 3: Copy to `app/public/` and commit**

```bash
cp final-invoice-NS.html app/public/final-invoice-NS.html
git add final-invoice-NS.html app/public/final-invoice-NS.html
git commit -m "feat(narayani-steels): Chitti requires both Qty(kg) and Pcs for dual-track stock items"
```

- [ ] **Step 4: Manually verify**

Add a dual-track stock item (Task 5), then in the Chitti add a row naming that item with only Qty(kg) filled (no Pcs) — confirm the badge shows ⚠ with the "needs both" tooltip and the row is excluded from "Deduct from Stock". Fill in both fields — confirm the badge turns 🔗 and deduction succeeds, decrementing both counters (check via Stock page or `/api/stock/items`).

---

### Task 9: Remove Ledger — delete files, strip server.js

**Files:**
- Delete: `app/public/ledger.html`, `app/public/customer.html`, `app/public/invoice.html`, `app/ledgerStore.js`, `app/ledgerStore.test.js`
- Modify: `app/server.js`, `app/server.test.js`

**Interfaces:**
- Produces: `app/server.js` no longer requires `./ledgerStore`, has no `/api/ledger/*` routes, and its remaining Balance Sheet PDF code still has `CHROME_PATH` and `pdfFmt` available (both are reused there — confirmed by grep before this plan was written; do not delete them).

- [ ] **Step 1: Delete the Ledger-only files**

```bash
git rm app/public/ledger.html app/public/customer.html app/public/invoice.html app/ledgerStore.js app/ledgerStore.test.js
```

- [ ] **Step 2: Remove the ledger require and init block from `app/server.js`**

Find:
```js
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');
const { createStore: createBalanceSheetStore } = require('./balanceSheetStore');
```
Replace with:
```js
const { createStore } = require('./stockStore');
const { createStore: createBalanceSheetStore } = require('./balanceSheetStore');
```

Find:
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

const BALANCE_SHEET_DATA_PATH = process.env.BALANCE_SHEET_DATA_PATH || path.join(__dirname, 'data', 'balance-sheet.json');
```
Replace with:
```js
const BALANCE_SHEET_DATA_PATH = process.env.BALANCE_SHEET_DATA_PATH || path.join(__dirname, 'data', 'balance-sheet.json');
```

- [ ] **Step 3: Remove the entire `/api/ledger/*` routes block**

Delete everything from the line `app.use('/api/ledger', requireLedger);` through (and including) the closing `});` of the `app.get('/api/ledger/invoices/:id', ...)` route that immediately precedes `app.use('/api/balance-sheet', requireBalanceSheet);` — i.e. delete this whole contiguous block (verify the boundary: the line right after your deletion must be `app.use('/api/balance-sheet', requireBalanceSheet);`, untouched):

```js
app.use('/api/ledger', requireLedger);

app.get('/api/ledger/customers', (req, res) => {
  res.json(ledgerStore.listCustomers());
});
```
... (every `app.get`/`app.post`/`app.patch`/`app.delete` on an `/api/ledger/...` path, including `formatBalanceLine()`'s definition which lives in the middle of this block and is used nowhere outside it) ...
```js
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
Everything between (and including) those two boundaries is deleted. The line immediately after, `app.use('/api/balance-sheet', requireBalanceSheet);`, stays untouched immediately following where this block was.

- [ ] **Step 4: Remove the Invoice PDF rendering block, keeping `CHROME_PATH` and `pdfFmt`**

Find the section starting with the comment `// ─── Invoice PDF rendering (single A6 copy, mirrors the real Chitti slip) ─────` and ending right before the comment `// ─── Balance Sheet PDF rendering ──────────────────────────────────────────────`. Within that span:
- Delete the explanatory comment block (the `//` lines describing why this re-implements the client-side slip functions).
- **Keep** `const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';` exactly as-is.
- **Keep** `function pdfFmt(v) { return \`${Math.round(v).toLocaleString('en-IN')}\`; }` exactly as-is, but update the comment immediately above it (see below) since it no longer serves an invoice renderer that's about to be deleted.
- Delete `pdfColgroup`, `pdfThead`, `pdfRowAmount`, `pdfTableRows`, `pdfEmptyRows`, `pdfTotalsBlock`, `PDF_SLIP_TOTAL`, `pdfBuildFirstSlip`, `pdfBuildContSlip`, `renderInvoicePdf` in their entirety.
- Delete the two routes `app.get('/api/ledger/invoices/:id/pdf', ...)` and `app.post('/api/ledger/invoices/:id/send-whatsapp', ...)` in their entirety.

Concretely, find:
```js
// ─── Invoice PDF rendering (single A6 copy, mirrors the real Chitti slip) ─────
//
// This intentionally re-implements the same table/slip-building functions
// that live client-side in final-invoice-NS.html's inline script
// (colgroup/thead/tableRows/emptyRows/totalsBlock/buildFirstSlip/
// buildContSlip) — reusing that code directly isn't practical since it's
// written for the DOM inside a page-scoped <script>, not as a standalone
// module. If the client-side slip layout changes, this needs a matching
// manual update. Differences from the physical print: single copy (not the
// A5 dual-copy side-by-side sheet meant for a physical printer — a WhatsApp
// PDF only needs one copy) and A6 page size (matching the original
// single-slip size before the A5 dual-copy feature was added). The known
// pre-existing bug where the header always reads "QUOTATION" regardless of
// document type is deliberately left as-is here too, so the PDF matches
// exactly what the shop already prints — not something this task was asked
// to fix.
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function pdfFmt(v) {
```
Replace with:
```js
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Shared with Balance Sheet PDF rendering below — the invoice-PDF renderer
// that used to also depend on this (and on CHROME_PATH above) was removed
// along with Ledger.
function pdfFmt(v) {
```
(this leaves `CHROME_PATH` and the `pdfFmt` function signature/body untouched, just trims the now-inapplicable comment above them)

Then delete everything from the blank line after `pdfFmt`'s closing `}` through the end of the `send-whatsapp` route's closing `});` — i.e. `pdfColgroup` through `renderInvoicePdf`, and both `/api/ledger/invoices/:id/pdf` / `/api/ledger/invoices/:id/send-whatsapp` routes. The line immediately after your deletion must be the comment `// ─── Balance Sheet PDF rendering ──────────────────────────────────────────────`, untouched.

- [ ] **Step 5: Remove the two dangling test-only exports**

Find (at the very bottom of the file):
```js
module.exports = app;
module.exports.pdfRowAmount = pdfRowAmount;
module.exports.pdfTableRows = pdfTableRows;
```
Replace with:
```js
module.exports = app;
```

- [ ] **Step 6: Strip Ledger from `app/server.test.js`**

Remove the `process.env.LEDGER_DATA_PATH = ...` line (find `process.env.LEDGER_DATA_PATH = path.join(tmpDir, 'ledger.json');` and delete it — leave the `STOCK_DATA_PATH` line above it untouched).

Delete every `test(...)` block whose name references `ledger` (`GET /api/ledger/customers starts empty`, `POST /api/ledger/customers creates a customer, validates input`, `POST /api/ledger/invoices creates an invoice...`, `POST /api/ledger/customers/:id/old-balance and /cash-paid...`, `GET /api/ledger/invoices/:id returns the snapshot...`, `DELETE /api/ledger/entries/:id on an invoice entry...`, `DELETE /api/ledger/customers/:id cascades...`, `DELETE /api/ledger/reset requires...`) and the `pdfRowAmount bills piece-rate rows...` test (it exercises the now-deleted `app.pdfRowAmount`/`app.pdfTableRows` exports).

- [ ] **Step 7: Run the full test suite**

Run: `cd app && npm test`
Expected: all remaining tests PASS (stock + balance-sheet tests untouched and green); no reference to `ledgerStore`/`ledger.json`/`pdfRowAmount`/`pdfTableRows` remains anywhere in `app/`.

```bash
grep -rn "ledgerStore\|require('./ledgerStore')\|pdfRowAmount\|pdfTableRows" app/*.js
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add -A app/server.js app/server.test.js
git commit -m "chore(narayani-steels): remove Ledger backend (ledgerStore, routes, invoice PDF/WhatsApp)"
```

---

### Task 10: Remove Ledger UI from the Chitti + doc-type grid

**Files:**
- Modify: `final-invoice-NS.html` (root)
- Copy to: `app/public/final-invoice-NS.html`

**Interfaces:**
- Consumes: nothing new. Builds on Task 1's `bend`-inclusive functions and Task 8's `rowDeductable()`/badge logic — this task removes `oldbal`/`advance`/customer-linking from the same functions Task 1 extended, and simplifies `updateDeductButton()` (a function Task 8 did not touch).

- [ ] **Step 1: Remove the Ledger tile from the doc-type grid, drop to 6 columns**

Find:
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
Replace with:
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

- [ ] **Step 2: Remove the Customer select and the Advance/Old Balance fields from the Chitti form**

Find:
```html
      <div class="fg"><label>Ledger Customer (optional — links this invoice to their account)</label><select id="f-customer" onchange="onCustomerPick()"><option value="">— Walk-in, not tracked —</option></select></div>
      <div class="grid2">
```
Replace with:
```html
      <div class="grid2">
```

Find:
```html
      <div class="charges-grid">
        <div class="fg"><label>Advance</label><input id="f-advance" type="number" min="0" placeholder="0" oninput="recalc()"></div>
        <div class="fg"><label>Old Balance</label><input id="f-oldbal" type="number" min="0" placeholder="0" oninput="recalc()"></div>
      </div>
```
Delete this block entirely.

- [ ] **Step 3: Remove Old Balance/Advance from the on-screen summary box**

Find:
```html
        <div class="sr muted"><span>Old Balance</span><span id="d-oldbal">0</span></div>
        <div class="sr muted"><span>Advance</span><span id="d-advance">0</span></div>
```
Delete this block entirely (the `Grand Total` row right after it stays).

- [ ] **Step 4: Remove the "Finalize & Send" button and the ledger-note div**

Find:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" id="btn-record-invoice" onclick="recordInvoice()" style="display:none">✅ Finalize & Send</button><button class="btn-s" onclick="reset()">New</button></div>
    <div class="print-note" id="deduct-note" style="display:none"></div>
    <div class="print-note" id="ledger-note" style="display:none"></div>
```
Replace with:
```html
    <div class="acts"><button class="btn-s" onclick="go(3)">← Edit</button><button class="btn-p" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn-s" id="btn-deduct" onclick="deductStock()" style="display:none">📦 Deduct from Stock</button><button class="btn-s" onclick="reset()">New</button></div>
    <div class="print-note" id="deduct-note" style="display:none"></div>
```

- [ ] **Step 5: Strip `oldbal`/`advance` out of `recalc()`, `totalsBlock()`, `buildFirstSlip()`, `buildContSlip()`, `generate()`**

Find:
```js
function recalc(){
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const noLoading=document.getElementById('f-no-loading').checked;
  const lab=noLoading?0:Math.round(tq/1000*400);document.getElementById('f-labour').value=lab;
  const weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  document.getElementById('d-sub').textContent=fmt(sub);document.getElementById('d-lab').textContent=fmt(lab);document.getElementById('d-weigh').textContent=fmt(weigh);document.getElementById('d-freight').textContent=fmt(freight);document.getElementById('d-unload').textContent=fmt(unload);document.getElementById('d-bend').textContent=fmt(bend);document.getElementById('d-others').textContent=fmt(others);document.getElementById('d-gst').textContent=fmt(gst);document.getElementById('d-oldbal').textContent=fmt(oldbal);document.getElementById('d-advance').textContent=fmt(advance);document.getElementById('d-tot').textContent=fmt(tot);
}
```
Replace with:
```js
function recalc(){
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const noLoading=document.getElementById('f-no-loading').checked;
  const lab=noLoading?0:Math.round(tq/1000*400);document.getElementById('f-labour').value=lab;
  const weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const tot=taxable+gst;
  document.getElementById('d-sub').textContent=fmt(sub);document.getElementById('d-lab').textContent=fmt(lab);document.getElementById('d-weigh').textContent=fmt(weigh);document.getElementById('d-freight').textContent=fmt(freight);document.getElementById('d-unload').textContent=fmt(unload);document.getElementById('d-bend').textContent=fmt(bend);document.getElementById('d-others').textContent=fmt(others);document.getElementById('d-gst').textContent=fmt(gst);document.getElementById('d-tot').textContent=fmt(tot);
}
```

Find:
```js
function totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note){const qs=tq%1===0?tq:tq.toFixed(2);let r=`<tr class="sep"><td class="c">${qs}</td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2" style="font-weight:bold">Subtotal</td><td class="r">${fmt(sub)}</td></tr>`;[['Loading Charges',lab],['Kanta Charges',weigh],['Freight',freight],['Unloading',unload],['Bending Charges',bend],['GST @18%',gst],['Others',others],['Old Balance',oldbal]].forEach(([l,v])=>{if(v>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">${l}</td><td class="r">${fmt(v)}</td></tr>`;});if(advance>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">Advance</td><td class="r">-${fmt(advance)}</td></tr>`;if(note)r+=`<tr class="charge"><td colspan="4" class="note-row">Note: ${escHtml(note)}</td><td class="r"></td></tr>`;r+=`<tr class="grand"><td colspan="4" style="text-align:right;padding-right:2mm">TOTAL</td><td class="r">${fmt(tot)}</td></tr>`;return r;}
const FIRST_TOTAL=19;
function buildFirstSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note){const{name,date,mobile,lorry}=meta;let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,FIRST_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note);return`<div class="doc"><div class="d-hdr"><div class="d-shri">||श्री||</div><div class="d-title">QUOTATION</div><div class="d-valid">Valid for 2 Hours</div></div><div class="d-meta"><span>M/s.&nbsp;<b style="font-size:11pt">${name}</b></span><span>Dt.&nbsp;<b style="font-size:11pt">${date}</b></span></div><div class="d-meta"><span>Mobile No.&nbsp;<b style="font-size:11pt">${mobile}</b></span><span style="margin-right:12mm">Lorry No.&nbsp;<b style="font-size:11pt">${lorry}</b></span></div><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
const CONT_TOTAL=19;
function buildContSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note){let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,CONT_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note);return`<div class="doc-cont"><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
```
Replace with:
```js
function totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note){const qs=tq%1===0?tq:tq.toFixed(2);let r=`<tr class="sep"><td class="c">${qs}</td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2" style="font-weight:bold">Subtotal</td><td class="r">${fmt(sub)}</td></tr>`;[['Loading Charges',lab],['Kanta Charges',weigh],['Freight',freight],['Unloading',unload],['Bending Charges',bend],['GST @18%',gst],['Others',others]].forEach(([l,v])=>{if(v>0)r+=`<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">${l}</td><td class="r">${fmt(v)}</td></tr>`;});if(note)r+=`<tr class="charge"><td colspan="4" class="note-row">Note: ${escHtml(note)}</td><td class="r"></td></tr>`;r+=`<tr class="grand"><td colspan="4" style="text-align:right;padding-right:2mm">TOTAL</td><td class="r">${fmt(tot)}</td></tr>`;return r;}
const FIRST_TOTAL=19;
function buildFirstSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,meta,note){const{name,date,mobile,lorry}=meta;let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,FIRST_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note);return`<div class="doc"><div class="d-hdr"><div class="d-shri">||श्री||</div><div class="d-title">QUOTATION</div><div class="d-valid">Valid for 2 Hours</div></div><div class="d-meta"><span>M/s.&nbsp;<b style="font-size:11pt">${name}</b></span><span>Dt.&nbsp;<b style="font-size:11pt">${date}</b></span></div><div class="d-meta"><span>Mobile No.&nbsp;<b style="font-size:11pt">${mobile}</b></span><span style="margin-right:12mm">Lorry No.&nbsp;<b style="font-size:11pt">${lorry}</b></span></div><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
const CONT_TOTAL=19;
function buildContSlip(ic,isLast,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note){let tbody=tableRows(ic);const tc=isLast?2+[lab,weigh,freight,unload,bend,gst,others].filter(v=>v>0).length+(note?note.split('\n').length:0):0;tbody+=emptyRows(Math.max(0,CONT_TOTAL-ic.length-tc));if(isLast)tbody+=totalsBlock(sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note);return`<div class="doc-cont"><table class="d-tbl">${colgroup()}${thead()}<tbody>${tbody}</tbody></table></div>`;}
```

Find:
```js
function generate(){
  rows.forEach(r=>{r._deducted=false;});
  recordedInvoiceId=null;
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const lab=gc('f-labour'),weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const oldbal=gc('f-oldbal'),advance=gc('f-advance');
  const tot=taxable+gst+oldbal-advance;
  const meta={name:document.getElementById('f-name').value||'_______________________',date:document.getElementById('f-date').value||'________',mobile:document.getElementById('f-mobile').value||'___________',lorry:document.getElementById('f-lorry').value||'___________'};
  const note=document.getElementById('f-note').value.trim();
  const cc=[lab,weigh,freight,unload,bend,gst,others,oldbal,advance].filter(v=>v>0).length+(note?note.split('\n').length:0),tr2=2+cc,mp1=FIRST_TOTAL-tr2;
  const chunks=rows.length<=mp1?[{items:rows,cont:false}]:[{items:rows.slice(0,mp1),cont:false},{items:rows.slice(mp1),cont:true}];
  let ph='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);ph+=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note);});
  document.getElementById('preview-wrap').innerHTML=ph;
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,oldbal,advance,tot,meta,note);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
  document.getElementById('print-area').innerHTML=prh;go(4);updateDeductButton();updateRecordInvoiceButton();
}
```
Replace with:
```js
function generate(){
  rows.forEach(r=>{r._deducted=false;});
  let sub=0,tq=0;rows.forEach(r=>{sub+=rowAmount(r);tq+=parseFloat(r.q)||0;});
  const lab=gc('f-labour'),weigh=gc('f-weigh'),freight=gc('f-freight'),unload=gc('f-unload'),bend=gc('f-bend'),others=gc('f-others');
  const taxable=sub+lab+weigh+freight+unload+bend+others;
  const gst=document.getElementById('f-gst').checked?Math.round(taxable*0.18):0;
  const tot=taxable+gst;
  const meta={name:document.getElementById('f-name').value||'_______________________',date:document.getElementById('f-date').value||'________',mobile:document.getElementById('f-mobile').value||'___________',lorry:document.getElementById('f-lorry').value||'___________'};
  const note=document.getElementById('f-note').value.trim();
  const cc=[lab,weigh,freight,unload,bend,gst,others].filter(v=>v>0).length+(note?note.split('\n').length:0),tr2=2+cc,mp1=FIRST_TOTAL-tr2;
  const chunks=rows.length<=mp1?[{items:rows,cont:false}]:[{items:rows.slice(0,mp1),cont:false},{items:rows.slice(mp1),cont:true}];
  let ph='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);ph+=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,meta,note);});
  document.getElementById('preview-wrap').innerHTML=ph;
  let prh='';chunks.forEach((c,idx)=>{const il=(idx===chunks.length-1);const sh=c.cont?buildContSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,note):buildFirstSlip(c.items,il,sub,tq,lab,weigh,freight,unload,bend,gst,others,tot,meta,note);prh+=`<div class="print-slip"><div class="a5-half"><div style="height:9mm"></div>${sh}</div><div class="a5-tear"></div><div class="a5-half"><div style="height:9mm"></div>${sh}</div></div>`;if(!il)prh+=`<div class="page-break"></div>`;});
  document.getElementById('print-area').innerHTML=prh;go(4);updateDeductButton();
}
```

- [ ] **Step 6: Delete `loadLedgerCustomers()`, `onCustomerPick()`, `updateRecordInvoiceButton()`, `setLedgerNote()`, `recordInvoice()`; simplify `updateDeductButton()`**

Find:
```js
let ledgerCustomers=[];
async function loadLedgerCustomers(){
  try{
    const res=await fetch('/api/ledger/customers');
    if(!res.ok)throw new Error('Ledger API returned an error');
    ledgerCustomers=await res.json();
    const sel=document.getElementById('f-customer');
    sel.innerHTML='<option value="">— Walk-in, not tracked —</option>'+ledgerCustomers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    ledgerLoadFailed=false;
  }catch(err){
    ledgerLoadFailed=true;
  }
  updateModuleWarnBanner();
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
    if(!res.ok||typeof cust.balance!=='number')throw new Error(cust.error||'Could not load this customer\'s balance');
    oldbalEl.value=cust.balance;
    oldbalEl.readOnly=true;oldbalEl.style.background='#f0f0f0';oldbalEl.style.color='#666';
    recalc();
  }catch(err){
    // Previously this silently left whatever was in the field — if it still
    // held a PRIOR customer's old balance (or a deleted customer's stale
    // selection), that wrong number could get printed on this customer's
    // invoice with nothing indicating the fetch had failed. Now it clears
    // the field and locks it, so a stale/wrong balance can never be printed
    // — the operator has to notice the field is empty and retry instead.
    oldbalEl.value='';
    oldbalEl.readOnly=true;oldbalEl.style.background='#fef2f2';oldbalEl.style.color='#991b1b';
    oldbalEl.title=`Could not load old balance: ${err.message}. Re-select the customer to retry.`;
    recalc();
  }
}
```
Delete this entire block (both functions and the `ledgerCustomers` variable).

Find:
```js
let recordedInvoiceId=null;
function updateRecordInvoiceButton(){
  const btn=document.getElementById('btn-record-invoice');
  const custId=document.getElementById('f-customer').value;
  document.getElementById('ledger-note').style.display='none';
  if(dtype==='Invoice'&&custId){
    btn.style.display='inline-block';btn.disabled=false;btn.textContent='✅ Finalize & Send';
  }else{
    btn.style.display='none';
  }
}
function setLedgerNote(kind,text){
  const note=document.getElementById('ledger-note');
  note.style.display='block';
  note.textContent=text;
  if(kind==='ok'){note.style.background='#f0fdf4';note.style.borderColor='#bbf7d0';note.style.color='#166534';}
  else if(kind==='warn'){note.style.background='#fffbeb';note.style.borderColor='#fde68a';note.style.color='#92400e';}
  else{note.style.background='#fef2f2';note.style.borderColor='#fecaca';note.style.color='#991b1b';}
}
async function recordInvoice(){
```
... (the entire `recordInvoice()` function body, ending at its closing `}`) ...
```js
function updateDeductButton(){
  const btn=document.getElementById('btn-deduct'),note=document.getElementById('deduct-note');
  note.style.display='none';
  const matched=rows.filter(r=>r.stockItemId);
  const custId=document.getElementById('f-customer').value;
  // When a ledger customer is linked, "Finalize & Send" absorbs stock
  // deduction into its own flow (see recordInvoice()) — showing this
  // standalone button too would let both fire independently and risk
  // double-deducting the same rows. Only shown for walk-in invoices now.
  if(dtype==='Invoice'&&matched.length&&!custId){
    btn.style.display='inline-block';btn.disabled=false;btn.textContent='📦 Deduct from Stock';btn.dataset.deducted='';
  }else{
    btn.style.display='none';
  }
}
```
Replace this whole span (from `let recordedInvoiceId=null;` through the end of the old `updateDeductButton()`) with just:
```js
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
```

- [ ] **Step 7: Drop the `ledgerLoadFailed` flag and its banner message**

Find:
```js
let stockLoadFailed=false,ledgerLoadFailed=false;
function updateModuleWarnBanner(){
  const banner=document.getElementById('module-warn-banner');
  const msgs=[];
  if(stockLoadFailed)msgs.push('Stock module failed to load — items will NOT be linked to stock or deducted this session. Reload the page to retry.');
  if(ledgerLoadFailed)msgs.push('Ledger module failed to load — customer linking/Finalize & Send unavailable this session. Reload the page to retry.');
  banner.style.display=msgs.length?'block':'none';
  banner.textContent=msgs.length?'⚠ '+msgs.join(' ⚠ '):'';
}
```
Replace with:
```js
let stockLoadFailed=false;
function updateModuleWarnBanner(){
  const banner=document.getElementById('module-warn-banner');
  const msgs=[];
  if(stockLoadFailed)msgs.push('Stock module failed to load — items will NOT be linked to stock or deducted this session. Reload the page to retry.');
  banner.style.display=msgs.length?'block':'none';
  banner.textContent=msgs.length?'⚠ '+msgs.join(' ⚠ '):'';
}
```

- [ ] **Step 8: Update `reset()` and the file's init call**

Find:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-bend','f-others','f-advance','f-oldbal','f-note'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('f-customer').value='';
  document.getElementById('f-oldbal').readOnly=false;document.getElementById('f-oldbal').style.background='';document.getElementById('f-oldbal').style.color='';
  document.getElementById('f-gst').checked=false;
```
Replace with:
```js
  ['f-name','f-date','f-mobile','f-lorry','f-labour','f-weigh','f-freight','f-unload','f-bend','f-others','f-note'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('f-gst').checked=false;
```

Find (the last line of the file):
```js
loadStockDatalist();
loadLedgerCustomers();
```
Replace with:
```js
loadStockDatalist();
```

- [ ] **Step 9: Copy to `app/public/` and commit**

```bash
cp final-invoice-NS.html app/public/final-invoice-NS.html
git add final-invoice-NS.html app/public/final-invoice-NS.html
git commit -m "chore(narayani-steels): remove Ledger UI from the Chitti (customer, old balance, advance, finalize & send)"
```

- [ ] **Step 10: Manually verify**

```bash
grep -n "ledger\|Ledger\|f-customer\|f-oldbal\|f-advance\|recordInvoice" final-invoice-NS.html app/public/final-invoice-NS.html
```
Expected: no output. Then start the server locally, confirm the doc-type grid shows 6 tiles with no Ledger tile, `ledger.html`/`customer.html`/`invoice.html` 404 (`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3300/ledger.html` → `404`), and a full Invoice flow (fill items, charges including Bending, Generate, Deduct from Stock) still works end to end with no console errors.

---

### Task 11: Full-suite verification + deploy checklist note

**Files:**
- None modified (verification + a memory/process note only — no code).

- [ ] **Step 1: Run the full automated test suite**

Run: `cd app && npm test`
Expected: all tests pass (stock, balance-sheet; no ledger tests remain).

- [ ] **Step 2: Confirm Reports still reflects new items on current source (re-verify after all other changes)**

```bash
cd app && (node server.js > /tmp/ns-verify.log 2>&1 &) && sleep 1.5
CAT=$(curl -s http://127.0.0.1:3300/api/stock/categories | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
NEW=$(curl -s -X POST http://127.0.0.1:3300/api/stock/items -H 'Content-Type: application/json' -d "{\"categoryId\":\"$CAT\",\"name\":\"__TEST_REPORTS_FINAL__\",\"unit\":\"kg\",\"initialStockKg\":0}" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s "http://127.0.0.1:3300/api/stock/report?type=daily" | grep -c "__TEST_REPORTS_FINAL__"
curl -s -X DELETE http://127.0.0.1:3300/api/stock/items/$NEW
pkill -f "node server.js"
```
Expected: the grep count is `1` (row present), and the delete cleans up with no leftover test data — same discipline as the original investigation this plan is based on.

- [ ] **Step 3: Full manual click-through**

Using a locally-run server (and Claude-in-Chrome or a real browser): Bending Charges prints and totals correctly on Invoice; a dual-track item's Stock In → Chitti deduct → Reports round-trip shows correct combined pcs/kg figures throughout; Ledger's absence doesn't break Chitti, Stock, Reports, or Balance Sheet; Stock's zero-stock sort/divider renders correctly.

- [ ] **Step 4: Note the deploy checklist addition (no code — this is process, not implementation)**

The next TeamViewer deploy to the shop PC must ship the **complete** `app/` file set (`server.js`, `stockStore.js`, every `public/*.html`, and no longer `ledgerStore.js`/`ledger.html`/`customer.html`/`invoice.html`) rather than only the files changed since the last deploy — this both delivers everything in this plan and closes the "Reports doesn't show new items" gap, which was root-caused to a stale partial deploy, not a code bug (see the design spec's Task 5 write-up). No commit needed for this step — it's guidance for whoever runs the next TeamViewer session, already captured in the design spec at `docs/superpowers/specs/2026-08-05-billing-stock-updates-design.md`.
