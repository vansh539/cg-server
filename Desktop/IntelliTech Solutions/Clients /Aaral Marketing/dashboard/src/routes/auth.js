const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('payment-ledger-core/db');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }
  const { rows } = await query(
    'SELECT * FROM dashboard_users WHERE username = $1 AND active = true',
    [String(username).trim().toLowerCase()]
  );
  const user = rows[0];
  const valid = user && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ ok: false, error: 'Incorrect username or password' });
  }
  req.session.user = { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/auth/me', (req, res) => {
  res.json({ ok: true, user: (req.session && req.session.user) || null });
});

module.exports = router;
