const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 6;

router.get('/users', requireAdmin, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, username, display_name, role, active, created_at FROM dashboard_users ORDER BY created_at'
  );
  res.json({ ok: true, users: rows });
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;
    if (!username || !password || !displayName || !['admin', 'employee'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Username, password, display name, and a valid role are required' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO dashboard_users (username, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, role, active, created_at`,
      [username.trim().toLowerCase(), hash, displayName.trim(), role]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ ok: false, error: 'That username is already taken' });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await query('UPDATE dashboard_users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  if (!rowCount) return res.status(404).json({ ok: false, error: 'User not found' });
  res.json({ ok: true });
});

// Toggling a user's active flag can lock everyone out if it removes the
// last admin able to log back in and undo it, so that specific case is
// refused outright rather than trusting whoever's clicking to notice.
router.post('/users/:id/toggle-active', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT role, active FROM dashboard_users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  const target = rows[0];

  if (target.role === 'admin' && target.active) {
    const { rows: activeAdmins } = await query(
      `SELECT id FROM dashboard_users WHERE role = 'admin' AND active = true`
    );
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ ok: false, error: 'Cannot deactivate the last active admin' });
    }
  }

  await query('UPDATE dashboard_users SET active = $1 WHERE id = $2', [!target.active, req.params.id]);
  res.json({ ok: true, active: !target.active });
});

module.exports = router;
