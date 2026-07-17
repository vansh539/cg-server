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
