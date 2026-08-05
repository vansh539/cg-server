'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRESET_CATEGORIES = ['M.S. Pipes', 'TMT Bars', 'M.S. Section', 'Colour Coated Sheets', 'Cement', 'Rings'];

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// `currentStockKg`/`deltaKg`/`kg`/`newTotalKg` throughout this file are the
// generic tracked quantity — for `unit:'pcs'` items (e.g. Covering Blocks)
// they hold a piece count, not literally kilograms. Kept unrenamed
// deliberately (vs. a `currentStock`/`qty` rename across this file, the
// routes, stock.html, and the Chitti's deduct payload) to keep this change
// surgical — the meaning is unit-dependent, tracked via the new `unit`
// field below, not the field name.
function computePieces(item) {
  if (item.dualTrack) return item.stockPcs;
  if (item.unit === 'pcs') return null; // the tracked quantity already *is* the piece count — no separate derived value needed
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

  function deleteItem(id) {
    ensureLoaded();
    const idx = data.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error('Item not found');
    data.items.splice(idx, 1);
    data.movements = data.movements.filter((m) => m.itemId !== id);
    save();
  }

  function round2(n) {
    return Math.round(n * 100) / 100 + 0; // +0 normalizes -0 to 0
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  // Monday-start week, matching how the shop actually thinks about a
  // "week" (not the JS/US Sunday-start convention).
  function periodBounds(type, anchor) {
    const a = startOfDay(anchor);
    if (type === 'daily') {
      const start = a;
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    if (type === 'weekly') {
      const day = a.getDay(); // 0=Sun..6=Sat
      const diffToMonday = day === 0 ? 6 : day - 1;
      const start = new Date(a);
      start.setDate(start.getDate() - diffToMonday);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    if (type === 'monthly') {
      const start = new Date(a.getFullYear(), a.getMonth(), 1);
      const end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
      return { start, end };
    }
    throw new Error('Report type must be daily, weekly, or monthly');
  }

  // Reconstructs opening/closing balances for ANY period (not just the
  // current one) by walking backward from each item's live currentStockKg —
  // undoing every movement that happened at/after the period end gives the
  // balance as it stood at that moment in the past. `stock-in` and the
  // one-time `initial` seed movement are both counted as "came in" (an item
  // is rarely created mid-reporting-period, so a dedicated bucket for
  // `initial` isn't worth the extra column); `adjustment` is kept separate
  // from both since it's a correction, not a delivery or a sale — opening +
  // stockIn - sold + adjustments always reconciles exactly to closing
  // because every movement has exactly one of these three reasons.
  function getReport({ type, date } = {}) {
    ensureLoaded();
    const anchor = date ? new Date(date) : new Date();
    if (Number.isNaN(anchor.getTime())) throw new Error('Invalid date');
    const { start, end } = periodBounds(type, anchor);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const rows = data.items.map((item) => {
      const itemMovements = data.movements.filter((m) => m.itemId === item.id);
      const afterPeriodDelta = itemMovements
        .filter((m) => new Date(m.at).getTime() >= endMs)
        .reduce((sum, m) => sum + m.deltaKg, 0);
      const closing = item.currentStockKg - afterPeriodDelta;

      const inPeriod = itemMovements.filter((m) => {
        const t = new Date(m.at).getTime();
        return t >= startMs && t < endMs;
      });
      const stockIn = inPeriod.filter((m) => m.reason === 'stock-in' || m.reason === 'initial').reduce((s, m) => s + m.deltaKg, 0);
      const sold = -inPeriod.filter((m) => m.reason === 'invoice-deduct').reduce((s, m) => s + m.deltaKg, 0);
      const adjustments = inPeriod.filter((m) => m.reason === 'adjustment').reduce((s, m) => s + m.deltaKg, 0);
      const opening = closing - stockIn + sold - adjustments;

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

    return { type, periodStart: start.toISOString(), periodEnd: end.toISOString(), rows };
  }

  function listMovements(itemId) {
    ensureLoaded();
    // Movements are always appended in chronological order, so reversing
    // gives newest-first deterministically — sorting by the `at` ISO string
    // instead would tie (and misorder) any movements written within the
    // same millisecond, which happens routinely for sync same-tick writes.
    return data.movements.filter((m) => m.itemId === itemId).reverse();
  }

  return { init, listCategories, addCategory, listItems, getItem, addItem, updateItem, deleteItem, stockIn, adjust, deduct, listMovements, getReport };
}

module.exports = { createStore, PRESET_CATEGORIES };
