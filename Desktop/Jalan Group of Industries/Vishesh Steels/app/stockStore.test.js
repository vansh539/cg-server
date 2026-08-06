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

function daysAgoISO(n, hour = 12) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  d.setHours(hour);
  return d.toISOString();
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
  assert.equal(item.unit, 'kg'); // default when not specified — backward compatible with items created before `unit` existed
});

test('addItem with unit:"pcs" tracks a pure piece count — no weight concept, pieces is not separately computed', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Covering Block 4in', unit: 'pcs', initialStockKg: 500 });
  assert.equal(item.unit, 'pcs');
  assert.equal(item.currentStockKg, 500); // the tracked quantity itself is the piece count
  assert.equal(item.weightPerPieceKg, null);
  assert.equal(item.pieces, null); // no separate derived value — Stock already *is* pieces for this unit

  // A weightPerPieceKg passed alongside unit:'pcs' is silently ignored, not an error —
  // the UI never shows that field for this unit, a stray value shouldn't block creation.
  const item2 = store.addItem({ categoryId: cat.id, name: 'Covering Block 6in', unit: 'pcs', weightPerPieceKg: 5, initialStockKg: 200 });
  assert.equal(item2.weightPerPieceKg, null);
});

test('stockIn/adjust/deduct work identically for unit:"pcs" items — same quantity semantics, just pieces not kg', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Covering Block 4in', unit: 'pcs', initialStockKg: 500 });

  const afterStockIn = store.stockIn(item.id, 100);
  assert.equal(afterStockIn.currentStockKg, 600);
  assert.equal(afterStockIn.pieces, null);

  const afterAdjust = store.adjust(item.id, 550);
  assert.equal(afterAdjust.currentStockKg, 550);

  const afterDeduct = store.deduct(item.id, 50);
  assert.equal(afterDeduct.currentStockKg, 500);
  assert.equal(afterDeduct.unit, 'pcs');
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

test('updateItem renames an item and rejects a blank name', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Old Name', weightPerPieceKg: 5, initialStockKg: 10 });

  const renamed = store.updateItem(item.id, { name: 'New Name' });
  assert.equal(renamed.name, 'New Name');
  assert.equal(store.getItem(item.id).name, 'New Name');

  assert.throws(() => store.updateItem(item.id, { name: '  ' }), /Item name is required/);
});

test('updateItem changes weightPerPieceKg for kg-tracked items and rejects it for pcs-tracked items', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const kgItem = store.addItem({ categoryId: cat.id, name: 'Ring 10mm', weightPerPieceKg: null, initialStockKg: 100 });

  const updated = store.updateItem(kgItem.id, { weightPerPieceKg: 2.5 });
  assert.equal(updated.weightPerPieceKg, 2.5);
  assert.equal(updated.pieces, 40);

  const cleared = store.updateItem(kgItem.id, { weightPerPieceKg: null });
  assert.equal(cleared.weightPerPieceKg, null);
  assert.equal(cleared.pieces, null);

  assert.throws(() => store.updateItem(kgItem.id, { weightPerPieceKg: -1 }), /must be a positive number/);

  const pcsItem = store.addItem({ categoryId: cat.id, name: 'Covering Block', unit: 'pcs', initialStockKg: 50 });
  assert.throws(() => store.updateItem(pcsItem.id, { weightPerPieceKg: 3 }), /only applies to weight-tracked items/);
});

test('updateItem on an unknown item id throws Item not found', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.updateItem('item_ghost', { name: 'X' }), /Item not found/);
});

test('deleteItem removes the item and its movement history; unknown item throws', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Disposable Item', weightPerPieceKg: 1, initialStockKg: 10 });
  store.stockIn(item.id, 5);
  assert.equal(store.listMovements(item.id).length, 2);

  store.deleteItem(item.id);
  assert.throws(() => store.getItem(item.id), /Item not found/);
  assert.equal(store.listMovements(item.id).length, 0);
  assert.ok(!store.listItems().some((i) => i.id === item.id));

  assert.throws(() => store.deleteItem('item_ghost'), /Item not found/);
});

test('getReport reconciles opening + stockIn - sold + adjustments = closing for a single-day period', () => {
  const store = createStore(tempFile());
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Report Test Item', weightPerPieceKg: 5, initialStockKg: 100 });
  store.stockIn(item.id, 50); // 150
  store.deduct(item.id, 30, 'Chitti/Invoice'); // 120
  store.adjust(item.id, 115, 'recount'); // -5 adjustment -> 115

  const report = store.getReport({ type: 'daily' });
  const row = report.rows.find((r) => r.itemId === item.id);
  assert.equal(row.closing, 115);
  assert.equal(row.stockIn, 150); // initial (100) + stock-in (50), both count as "in"
  assert.equal(row.sold, 30);
  assert.equal(row.adjustments, -5);
  assert.equal(row.opening, 0);
  assert.equal(row.opening + row.stockIn - row.sold + row.adjustments, row.closing);
});

test('getReport reconstructs past-period balances by walking backward from current stock, excluding later movements', () => {
  const file = tempFile();
  const store = createStore(file);
  const [cat] = store.listCategories();
  const item = store.addItem({ categoryId: cat.id, name: 'Historical Item', weightPerPieceKg: 2, initialStockKg: 0 });
  store.stockIn(item.id, 100); // movement: stock-in, will be backdated to 2 days ago
  store.stockIn(item.id, 50); // movement: stock-in, will be backdated to yesterday
  store.deduct(item.id, 20, 'Chitti/Invoice'); // stays "today"

  // Backdate by rewriting the two oldest movements in place (both currently
  // share reason 'stock-in', so target them via a fresh store reload + array order).
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stockInMovements = raw.movements.filter((m) => m.itemId === item.id && m.reason === 'stock-in');
  assert.equal(stockInMovements.length, 2);
  stockInMovements[0].at = daysAgoISO(2);
  stockInMovements[1].at = daysAgoISO(1);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  const fresh = createStore(file);
  assert.equal(fresh.getItem(item.id).currentStockKg, 130); // 100 + 50 - 20, unaffected by backdating

  const today = fresh.getReport({ type: 'daily' });
  const todayRow = today.rows.find((r) => r.itemId === item.id);
  assert.equal(todayRow.stockIn, 0);
  assert.equal(todayRow.sold, 20);
  assert.equal(todayRow.closing, 130);
  assert.equal(todayRow.opening, 150); // balance as it stood before today's deduct

  const yesterday = fresh.getReport({ type: 'daily', date: daysAgoISO(1) });
  const yRow = yesterday.rows.find((r) => r.itemId === item.id);
  assert.equal(yRow.stockIn, 50);
  assert.equal(yRow.sold, 0);
  assert.equal(yRow.opening, 100); // before yesterday's stock-in
  assert.equal(yRow.closing, 150); // after yesterday's stock-in, before today's deduct

  const twoDaysAgo = fresh.getReport({ type: 'daily', date: daysAgoISO(2) });
  const tRow = twoDaysAgo.rows.find((r) => r.itemId === item.id);
  assert.equal(tRow.stockIn, 100);
  assert.equal(tRow.opening, 0);
  assert.equal(tRow.closing, 100);
});

test('getReport weekly period is Monday-start and monthly period is calendar-month', () => {
  const store = createStore(tempFile());
  const weekly = store.getReport({ type: 'weekly' });
  const weekStart = new Date(weekly.periodStart);
  assert.equal(weekStart.getDay(), 1); // Monday
  const weekEnd = new Date(weekly.periodEnd);
  assert.equal((weekEnd - weekStart) / (1000 * 60 * 60 * 24), 7);

  const monthly = store.getReport({ type: 'monthly' });
  const monthStart = new Date(monthly.periodStart);
  assert.equal(monthStart.getDate(), 1);
  const monthEnd = new Date(monthly.periodEnd);
  assert.equal(monthEnd.getMonth(), (monthStart.getMonth() + 1) % 12);
});

test('getReport rejects an invalid type', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.getReport({ type: 'yearly' }), /daily, weekly, or monthly/);
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

// Reproduces a real production incident: on Windows, renaming a .tmp file
// over the live stock.json can transiently fail with EPERM/EBUSY if another
// process (antivirus, Windows Search Indexer, a backup/sync agent) has a
// momentary open handle on the destination — this never happens on POSIX,
// where rename() is atomic regardless of other open handles. A client saw
// exactly this mid-way through deducting several Chitti line items: the
// first two succeeded, the third's save() hit the transient lock and threw,
// stopping the sequential deduction loop with the rest undeducted.
test('save() retries past a transient Windows EPERM/EBUSY on rename instead of failing the whole operation', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    calls++;
    if (calls <= 2) {
      const err = new Error('EPERM: operation not permitted, rename');
      err.code = 'EPERM';
      throw err;
    }
    return realRename(...args);
  };
  try {
    const item = store.addItem({ categoryId: cats[0].id, name: 'Retry Test Item', unit: 'kg', initialStockKg: 100 });
    assert.equal(item.currentStockKg, 100);
    assert.ok(calls >= 3); // failed twice, succeeded on the 3rd attempt
  } finally {
    fs.renameSync = realRename;
  }
});

test('save() gives up and throws after exhausting retries on a persistent rename failure', () => {
  const store = createStore(tempFile());
  const cats = store.listCategories();
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error('EPERM: operation not permitted, rename');
    err.code = 'EPERM';
    throw err;
  };
  try {
    assert.throws(() => store.addItem({ categoryId: cats[0].id, name: 'Persistent Fail Item', unit: 'kg' }), /EPERM/);
  } finally {
    fs.renameSync = realRename;
  }
});
