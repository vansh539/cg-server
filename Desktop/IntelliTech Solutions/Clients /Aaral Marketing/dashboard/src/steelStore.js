// Iron & Steel inventory: categories, items, and an append-only movement
// ledger, on Postgres. Ported from Narayani Steels' stockStore.js (JSON
// files) -- see migrations-aaral/006_add_steel_inventory.sql for why this
// moved to the database rather than being lifted as-is.
//
// Every write to stock goes through applyDelta, inside one transaction that
// inserts the movement row and updates the item's cached total together --
// the two can never drift, and if either half fails the whole write rolls
// back rather than leaving a movement with no matching total or vice versa.

const { pool } = require('payment-ledger-core/db');

// unit='pcs' items have no weight concept -- the tracked quantity already
// *is* the piece count, so there is nothing to derive.
function computePieces(item) {
  if (item.dual_track) return Number(item.stock_pcs);
  if (item.unit === 'pcs') return null;
  return item.weight_per_piece_kg ? Math.floor(Number(item.current_stock_kg) / Number(item.weight_per_piece_kg)) : null;
}

function toItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    unit: row.unit,
    weightPerPieceKg: row.weight_per_piece_kg === null ? null : Number(row.weight_per_piece_kg),
    dualTrack: row.dual_track,
    currentStockKg: Number(row.current_stock_kg),
    stockPcs: Number(row.stock_pcs),
    pieces: computePieces(row),
  };
}

async function listCategories() {
  const { rows } = await pool.query('SELECT * FROM steel_categories ORDER BY name ASC');
  return rows;
}

async function addCategory(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Category name is required');
  const { rows } = await pool.query(
    'SELECT 1 FROM steel_categories WHERE lower(name) = lower($1)',
    [trimmed]
  );
  if (rows.length) throw new Error('Category already exists');
  const { rows: inserted } = await pool.query(
    'INSERT INTO steel_categories (name) VALUES ($1) RETURNING *',
    [trimmed]
  );
  return inserted[0];
}

async function listItems() {
  const { rows } = await pool.query('SELECT * FROM steel_items ORDER BY name ASC');
  return rows.map(toItem);
}

async function getItem(id) {
  const { rows } = await pool.query('SELECT * FROM steel_items WHERE id = $1', [id]);
  if (!rows.length) throw new Error('Item not found');
  return toItem(rows[0]);
}

async function addItem({ categoryId, name, unit, weightPerPieceKg, initialStockKg, dualTrack, initialStockPcs }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new Error('Item name is required');
  const { rows: cat } = await pool.query('SELECT 1 FROM steel_categories WHERE id = $1', [categoryId]);
  if (!cat.length) throw new Error('Category not found');

  const resolvedUnit = unit === 'pcs' ? 'pcs' : 'kg';
  const resolvedDualTrack = !!dualTrack;

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: inserted } = await client.query(
      `INSERT INTO steel_items (category_id, name, unit, weight_per_piece_kg, dual_track, current_stock_kg, stock_pcs)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [categoryId, trimmedName, resolvedUnit, weight, resolvedDualTrack, initial, initialPcs]
    );
    const item = inserted[0];
    if (initial > 0 || (resolvedDualTrack && initialPcs > 0)) {
      await client.query(
        `INSERT INTO steel_movements (item_id, delta_kg, delta_pcs, reason, note)
         VALUES ($1, $2, $3, 'initial', '')`,
        [item.id, initial, resolvedDualTrack ? initialPcs : null]
      );
    }
    await client.query('COMMIT');
    return toItem(item);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function applyDelta(itemId, deltaKg, deltaPcs, reason, note) {
  if (!Number.isFinite(deltaKg)) throw new Error('Quantity must be a number');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM steel_items WHERE id = $1 FOR UPDATE', [itemId]);
    if (!rows.length) throw new Error('Item not found');
    const item = rows[0];
    if (item.dual_track && !Number.isFinite(deltaPcs)) throw new Error('Pieces quantity must be a number');

    const { rows: updated } = await client.query(
      `UPDATE steel_items
       SET current_stock_kg = current_stock_kg + $2,
           stock_pcs = stock_pcs + $3
       WHERE id = $1 RETURNING *`,
      [itemId, deltaKg, item.dual_track ? deltaPcs : 0]
    );
    await client.query(
      `INSERT INTO steel_movements (item_id, delta_kg, delta_pcs, reason, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, deltaKg, item.dual_track ? deltaPcs : null, reason, note || '']
    );
    await client.query('COMMIT');
    return toItem(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function stockIn(itemId, kg, pcs, note) {
  const item = await getItem(itemId);
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

async function adjust(itemId, newTotalKg, newTotalPcs, note) {
  const item = await getItem(itemId);
  const n = Number(newTotalKg);
  if (!Number.isFinite(n)) throw new Error('New total must be a number');
  if (!item.dualTrack) return applyDelta(itemId, n - item.currentStockKg, undefined, 'adjustment', note);
  const p = Number(newTotalPcs);
  if (!Number.isFinite(p)) throw new Error('New pieces total must be a number');
  return applyDelta(itemId, n - item.currentStockKg, p - item.stockPcs, 'adjustment', note);
}

async function deduct(itemId, kg, pcs, note) {
  const item = await getItem(itemId);
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

async function updateItem(id, { name, weightPerPieceKg, dualTrack } = {}) {
  const item = await getItem(id);
  const fields = [];
  const values = [id];
  let i = 1;

  if (name !== undefined) {
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Item name is required');
    values.push(trimmedName);
    fields.push(`name = $${++i}`);
  }
  if (weightPerPieceKg !== undefined) {
    if (item.unit !== 'kg') throw new Error('Weight per piece only applies to weight-tracked items');
    const weight = weightPerPieceKg === null || weightPerPieceKg === '' ? null : Number(weightPerPieceKg);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      throw new Error('Weight per piece must be a positive number or omitted');
    }
    values.push(weight);
    fields.push(`weight_per_piece_kg = $${++i}`);
  }
  if (dualTrack !== undefined) {
    values.push(!!dualTrack);
    fields.push(`dual_track = $${++i}`);
  }

  if (!fields.length) return item;
  const { rows } = await pool.query(
    `UPDATE steel_items SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return toItem(rows[0]);
}

async function deleteItem(id) {
  const { rowCount } = await pool.query('DELETE FROM steel_items WHERE id = $1', [id]);
  if (!rowCount) throw new Error('Item not found');
}

function round2(n) {
  return Math.round(n * 100) / 100 + 0;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Monday-start week, matching how the shop actually thinks about a "week".
function periodBounds(type, anchor) {
  const a = startOfDay(anchor);
  if (type === 'daily') {
    const start = a;
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (type === 'weekly') {
    const day = a.getDay();
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

// Unlike the JSON version (which had to walk backward from the live total,
// since a flat file has no cheap way to query "as of a past instant"), this
// sums the movement ledger directly for the period and everything before
// it -- opening = sum(delta) before the period start, closing = opening +
// everything inside the period. Same three-bucket reconciliation invariant:
// opening + stockIn - sold + adjustments === closing, because every
// movement has exactly one of those three reasons (or 'initial', folded
// into stockIn).
async function getReport({ type, date } = {}) {
  const anchor = date ? new Date(date) : new Date();
  if (Number.isNaN(anchor.getTime())) throw new Error('Invalid date');
  const { start, end } = periodBounds(type, anchor);

  const { rows: items } = await pool.query('SELECT * FROM steel_items ORDER BY name ASC');
  const { rows: sums } = await pool.query(
    `SELECT
       item_id,
       COALESCE(SUM(delta_kg) FILTER (WHERE occurred_at < $1), 0) AS opening_kg,
       COALESCE(SUM(delta_pcs) FILTER (WHERE occurred_at < $1), 0) AS opening_pcs,
       COALESCE(SUM(delta_kg) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason IN ('stock-in', 'initial')), 0) AS stock_in_kg,
       COALESCE(SUM(delta_pcs) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason IN ('stock-in', 'initial')), 0) AS stock_in_pcs,
       COALESCE(-SUM(delta_kg) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason = 'invoice-deduct'), 0) AS sold_kg,
       COALESCE(-SUM(delta_pcs) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason = 'invoice-deduct'), 0) AS sold_pcs,
       COALESCE(SUM(delta_kg) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason = 'adjustment'), 0) AS adjustments_kg,
       COALESCE(SUM(delta_pcs) FILTER (WHERE occurred_at >= $1 AND occurred_at < $2 AND reason = 'adjustment'), 0) AS adjustments_pcs
     FROM steel_movements
     WHERE occurred_at < $2
     GROUP BY item_id`,
    [start.toISOString(), end.toISOString()]
  );
  const byItem = new Map(sums.map((r) => [r.item_id, r]));

  const rows = items.map((item) => {
    const s = byItem.get(item.id);
    const openingKg = s ? Number(s.opening_kg) : 0;
    const stockInKg = s ? Number(s.stock_in_kg) : 0;
    const soldKg = s ? Number(s.sold_kg) : 0;
    const adjustmentsKg = s ? Number(s.adjustments_kg) : 0;

    const row = {
      itemId: item.id,
      name: item.name,
      categoryId: item.category_id,
      unit: item.unit,
      dualTrack: item.dual_track,
      opening: round2(openingKg),
      stockIn: round2(stockInKg),
      sold: round2(soldKg),
      adjustments: round2(adjustmentsKg),
      closing: round2(openingKg + stockInKg - soldKg + adjustmentsKg),
    };

    if (item.dual_track) {
      const openingPcs = s ? Number(s.opening_pcs) : 0;
      const stockInPcs = s ? Number(s.stock_in_pcs) : 0;
      const soldPcs = s ? Number(s.sold_pcs) : 0;
      const adjustmentsPcs = s ? Number(s.adjustments_pcs) : 0;
      row.openingPcs = round2(openingPcs);
      row.stockInPcs = round2(stockInPcs);
      row.soldPcs = round2(soldPcs);
      row.adjustmentsPcs = round2(adjustmentsPcs);
      row.closingPcs = round2(openingPcs + stockInPcs - soldPcs + adjustmentsPcs);
    }

    return row;
  });

  return { type, periodStart: start.toISOString(), periodEnd: end.toISOString(), rows };
}

async function listMovements(itemId) {
  const { rows } = await pool.query(
    'SELECT * FROM steel_movements WHERE item_id = $1 ORDER BY occurred_at DESC, id DESC',
    [itemId]
  );
  return rows.map((m) => ({
    id: m.id,
    itemId: m.item_id,
    deltaKg: Number(m.delta_kg),
    deltaPcs: m.delta_pcs === null ? undefined : Number(m.delta_pcs),
    reason: m.reason,
    note: m.note,
    at: m.occurred_at.toISOString(),
  }));
}

module.exports = {
  listCategories,
  addCategory,
  listItems,
  getItem,
  addItem,
  updateItem,
  deleteItem,
  stockIn,
  adjust,
  deduct,
  listMovements,
  getReport,
};
