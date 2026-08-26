const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');
const { logActivity } = require('../activityLog');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 6;

router.get('/users', requireAdmin, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, username, display_name, role, active, phone_number, created_at FROM dashboard_users ORDER BY created_at'
  );
  res.json({ ok: true, users: rows });
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role, phoneNumber } = req.body;
    if (!username || !password || !displayName || !['admin', 'employee'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Username, password, display name, and a valid role are required' });
    }
    if (!phoneNumber || !phoneNumber.trim()) {
      return res.status(400).json({ ok: false, error: 'A phone number is required so this person can use the WhatsApp bot' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, role, active, phone_number, created_at`,
      [username.trim().toLowerCase(), hash, displayName.trim(), role, phoneNumber.trim()]
    );
    await logActivity(req, 'added user', `${displayName.trim()} (${role})`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'dashboard_users_username_key') {
      return res.status(400).json({ ok: false, error: 'That username is already taken' });
    }
    if (err.code === '23505' && err.constraint === 'dashboard_users_phone_number_key') {
      return res.status(400).json({ ok: false, error: 'That phone number is already assigned to another user' });
    }
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.patch('/users/:id/phone', requireAdmin, async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber || !phoneNumber.trim()) {
    return res.status(400).json({ ok: false, error: 'A phone number is required' });
  }
  try {
    const { rows } = await query(
      'UPDATE dashboard_users SET phone_number = $1 WHERE id = $2 RETURNING display_name',
      [phoneNumber.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
    await logActivity(req, 'updated phone number for', rows[0].display_name);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ ok: false, error: 'That phone number is already assigned to another user' });
    }
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    'UPDATE dashboard_users SET password_hash = $1 WHERE id = $2 RETURNING display_name',
    [hash, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  await logActivity(req, 'reset password for', rows[0].display_name);
  res.json({ ok: true });
});

// Toggling a user's active flag can lock everyone out if it removes the
// last admin able to log back in and undo it, so that specific case is
// refused outright rather than trusting whoever's clicking to notice.
router.post('/users/:id/toggle-active', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT role, active, display_name FROM dashboard_users WHERE id = $1', [req.params.id]);
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
  await logActivity(req, target.active ? 'deactivated user' : 'activated user', target.display_name);
  res.json({ ok: true, active: !target.active });
});

// Real removal, not deactivation. Safe at the DB level either way --
// activity_log.user_id is ON DELETE SET NULL and invoices/dues store
// created_by/voided_by as plain text, not a foreign key -- but a user with
// real activity_log history should be deactivated, not erased, so that
// history stays attributable to a name in the UI rather than orphaning
// silently. Same "can't remove the last active admin" guard as deactivate.
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT role, active, display_name FROM dashboard_users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
  const target = rows[0];

  if (target.role === 'admin' && target.active) {
    const { rows: activeAdmins } = await query(
      `SELECT id FROM dashboard_users WHERE role = 'admin' AND active = true`
    );
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ ok: false, error: 'Cannot delete the last active admin' });
    }
  }

  const { rows: historyRows } = await query(
    'SELECT 1 FROM activity_log WHERE user_id = $1 LIMIT 1', [req.params.id]
  );
  if (historyRows.length) {
    return res.status(400).json({ ok: false, error: 'This user has activity history — deactivate instead of deleting' });
  }

  await query('DELETE FROM dashboard_users WHERE id = $1', [req.params.id]);
  await logActivity(req, 'deleted user', target.display_name);
  res.json({ ok: true });
});

module.exports = router;
