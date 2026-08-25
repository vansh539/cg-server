const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const steelStore = require('../src/steelStore');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

async function tmtCategory() {
  const cats = await steelStore.listCategories();
  const cat = cats.find((c) => c.name === 'TMT Bars');
  assert.ok(cat, 'preset category missing -- migration seed not applied');
  return cat;
}

test('categories are seeded by the migration, not by application code', async () => {
  const cats = await steelStore.listCategories();
  const names = cats.map((c) => c.name).sort();
  assert.deepEqual(names, ['Colour Coated Sheets', 'M.S. Pipes', 'M.S. Section', 'Rings', 'TMT Bars']);
});

test('a duplicate category name is rejected case-insensitively', async () => {
  await assert.rejects(() => steelStore.addCategory('tmt bars'), /already exists/);
});

test('a kg-tracked item with initial stock records an opening movement', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: '12mm Fe500', unit: 'kg', initialStockKg: 500 });
  assert.equal(item.currentStockKg, 500);
  assert.equal(item.pieces, null, 'no weightPerPieceKg given -- pieces should not be fabricated');

  const movements = await steelStore.listMovements(item.id);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].reason, 'initial');
  assert.equal(movements[0].deltaKg, 500);
});

test('weightPerPieceKg derives a piece count without a dedicated counter', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: '12mm Fe500', unit: 'kg', weightPerPieceKg: 6.9, initialStockKg: 69 });
  assert.equal(item.pieces, 10);
});

test('a dual-track item moves kg and pcs together', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'Bundled Rebar', unit: 'kg', dualTrack: true, initialStockKg: 1000, initialStockPcs: 50 });
  const after = await steelStore.stockIn(item.id, 200, 10, 'delivery');
  assert.equal(after.currentStockKg, 1200);
  assert.equal(after.stockPcs, 60);
});

test('deduct rejects a non-positive quantity rather than silently no-op', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'MS Angle', unit: 'kg', initialStockKg: 100 });
  await assert.rejects(() => steelStore.deduct(item.id, 0, undefined, 'sale'), /positive number/);
  await assert.rejects(() => steelStore.deduct(item.id, -5, undefined, 'sale'), /positive number/);
});

test('deduct is allowed to go negative -- stock correctness is the operator\'s call, not a hard block', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'MS Angle', unit: 'kg', initialStockKg: 10 });
  const after = await steelStore.deduct(item.id, 25, undefined, 'sold more than counted');
  assert.equal(after.currentStockKg, -15);
});

test('adjust sets an absolute total and records the delta actually applied', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'MS Angle', unit: 'kg', initialStockKg: 100 });
  const after = await steelStore.adjust(item.id, 80, undefined, 'physical count correction');
  assert.equal(after.currentStockKg, 80);
  const movements = await steelStore.listMovements(item.id);
  assert.equal(movements[0].reason, 'adjustment');
  assert.equal(movements[0].deltaKg, -20);
});

test('the item\'s cached total and the movement ledger never drift', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'MS Angle', unit: 'kg', initialStockKg: 0 });
  await steelStore.stockIn(item.id, 500, undefined, '');
  await steelStore.deduct(item.id, 120, undefined, '');
  await steelStore.adjust(item.id, 400, undefined, '');

  const movements = await steelStore.listMovements(item.id);
  const summed = movements.reduce((sum, m) => sum + m.deltaKg, 0);
  const current = await steelStore.getItem(item.id);
  assert.equal(current.currentStockKg, summed);
});

test('deleting an item removes its movement history (ON DELETE CASCADE)', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'To Delete', unit: 'kg', initialStockKg: 5 });
  await steelStore.deleteItem(item.id);
  const { rows } = await pool.query('SELECT 1 FROM steel_movements WHERE item_id = $1', [item.id]);
  assert.equal(rows.length, 0);
});

test('weight-per-piece only applies to kg-tracked items', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'Covering Block', unit: 'pcs', initialStockKg: 40 });
  await assert.rejects(() => steelStore.updateItem(item.id, { weightPerPieceKg: 2 }), /only applies to weight-tracked/);
});

test('a daily report reconciles opening + stockIn - sold + adjustments to closing', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'Report Item', unit: 'kg', initialStockKg: 1000 });
  await steelStore.stockIn(item.id, 300, undefined, '');
  await steelStore.deduct(item.id, 150, undefined, '');
  await steelStore.adjust(item.id, 1200, undefined, '');

  const report = await steelStore.getReport({ type: 'daily', date: new Date().toISOString() });
  const row = report.rows.find((r) => r.itemId === item.id);
  assert.ok(row);
  assert.equal(row.opening + row.stockIn - row.sold + row.adjustments, row.closing);
  assert.equal(row.closing, 1200);
});

test('a report for a past period does not see movements that happened after it', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'Past Period Item', unit: 'kg', initialStockKg: 0 });
  await steelStore.stockIn(item.id, 100, undefined, '');

  const yesterday = new Date(Date.now() - 86400000);
  const report = await steelStore.getReport({ type: 'daily', date: yesterday.toISOString() });
  const row = report.rows.find((r) => r.itemId === item.id);
  assert.equal(row.opening, 0);
  assert.equal(row.stockIn, 0);
  assert.equal(row.closing, 0, 'a movement from today must not appear in yesterday\'s report');
});

test('movements are listed newest first', async () => {
  const cat = await tmtCategory();
  const item = await steelStore.addItem({ categoryId: cat.id, name: 'Order Item', unit: 'kg', initialStockKg: 0 });
  await steelStore.stockIn(item.id, 10, undefined, 'first');
  await steelStore.stockIn(item.id, 20, undefined, 'second');
  const movements = await steelStore.listMovements(item.id);
  assert.equal(movements[0].note, 'second');
  assert.equal(movements[1].note, 'first');
});
