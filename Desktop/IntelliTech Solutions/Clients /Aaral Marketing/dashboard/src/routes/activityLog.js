const express = require('express');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');

const router = express.Router();
const MAX_LIMIT = 300;

// Admin-only, per Vansh: if an employee makes an error, the client should be
// able to see exactly who did what and when -- same "employees can do
// everything except delete stuff and updates n stuff" boundary as Updates.
router.get('/activity-log', requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, MAX_LIMIT);
  const { rows } = await query(
    `SELECT id, username, display_name, action, detail, created_at
     FROM activity_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ ok: true, entries: rows });
});

module.exports = router;
