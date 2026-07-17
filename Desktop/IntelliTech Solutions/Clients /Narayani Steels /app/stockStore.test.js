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
