// Iron & Steel stock API. Same shape as Narayani Steels' /api/stock/* --
// ported onto src/steelStore.js (Postgres) rather than a JSON file, and
// mounted under Aaral's existing session auth instead of its own PIN gate.

const express = require('express');
const steelStore = require('../steelStore');
const { logActivity } = require('../activityLog');
const { buildSteelChittiTable } = require('../steelChittiTemplate');

const router = express.Router();

function sendStoreError(res, err) {
  res.status(400).json({ ok: false, error: err.message });
}

// Stateless chitti fragment, for the editor's Print button. Same template as
// every other consumer of chittiStyles.js's `.slip` rules, so what prints
// here can never drift from what src/steelChittiTemplate.js defines.
router.post('/steel/chitti', (req, res) => {
  try {
    const { customerName, meta, items, charges, advance, note } = req.body || {};
    res.json({ ok: true, html: buildSteelChittiTable({ customerName, meta, items, charges, advance, note }) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/steel/categories', async (req, res) => {
  res.json(await steelStore.listCategories());
});

router.post('/steel/categories', async (req, res) => {
  try {
    const cat = await steelStore.addCategory(req.body && req.body.name);
    res.status(201).json(cat);
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.get('/steel/items', async (req, res) => {
  res.json(await steelStore.listItems());
});

router.post('/steel/items', async (req, res) => {
  try {
    const item = await steelStore.addItem(req.body || {});
    await logActivity(req, 'added steel item', item.name);
    res.status(201).json(item);
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.patch('/steel/items/:id', async (req, res) => {
  try {
    res.json(await steelStore.updateItem(req.params.id, req.body || {}));
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.delete('/steel/items/:id', async (req, res) => {
  try {
    const item = await steelStore.getItem(req.params.id);
    await steelStore.deleteItem(req.params.id);
    await logActivity(req, 'deleted steel item', item.name);
    res.status(204).end();
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.post('/steel/items/:id/stock-in', async (req, res) => {
  try {
    const item = await steelStore.stockIn(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note);
    await logActivity(req, 'stocked in steel item', item.name);
    res.json(item);
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.post('/steel/items/:id/adjust', async (req, res) => {
  try {
    const item = await steelStore.adjust(req.params.id, req.body && req.body.newTotalKg, req.body && req.body.newTotalPcs, req.body && req.body.note);
    await logActivity(req, 'adjusted steel item', item.name);
    res.json(item);
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.post('/steel/items/:id/deduct', async (req, res) => {
  try {
    res.json(await steelStore.deduct(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note));
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.get('/steel/report', async (req, res) => {
  try {
    res.json(await steelStore.getReport({ type: req.query.type, date: req.query.date }));
  } catch (err) {
    sendStoreError(res, err);
  }
});

router.get('/steel/items/:id/movements', async (req, res) => {
  try {
    await steelStore.getItem(req.params.id);
    res.json(await steelStore.listMovements(req.params.id));
  } catch (err) {
    sendStoreError(res, err);
  }
});

module.exports = router;
