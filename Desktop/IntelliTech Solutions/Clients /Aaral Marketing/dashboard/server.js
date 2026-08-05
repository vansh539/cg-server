'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { execSync } = require('child_process');
const { pool } = require('payment-ledger-core/db');
const { requireSession } = require('./src/sessionAuth');

const app  = express();
const PORT = process.env.PORT || 3400;

// Self-heals a missing SESSION_SECRET instead of relying on a manual setup
// step that's easy to skip (this app has a real history of exactly that
// class of bug) -- generates one on first boot and persists it to .env so
// existing sessions survive future restarts instead of everyone getting
// logged out every time the process restarts.
if (!process.env.SESSION_SECRET) {
  const secret = crypto.randomBytes(32).toString('hex');
  const envPath = path.join(__dirname, '.env');
  try {
    fs.appendFileSync(envPath, `${fs.existsSync(envPath) && !fs.readFileSync(envPath, 'utf8').endsWith('\n') ? '\n' : ''}SESSION_SECRET=${secret}\n`);
    console.log('[Auth] Generated a new SESSION_SECRET and saved it to .env');
  } catch (err) {
    console.error('[Auth] Could not persist a generated SESSION_SECRET to .env:', err.message);
  }
  process.env.SESSION_SECRET = secret;
}

// ─── License validation ────────────────────────────────────────────────────

const _LS = '0d7a2e955e516326ece7612a68a97d00cf62bab779e65b5cc14e819e2decfbc4';

function _getMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic csproduct get UUID /value', { encoding: 'utf8', timeout: 4000 });
      const m = out.match(/UUID=([^\r\n]+)/);
      return m ? m[1].trim() : null;
    }
  } catch (_) {}
  return null;
}

function _checkLicense() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'license.key'), 'utf8').trim();
    const dot  = raw.lastIndexOf('.');
    if (dot === -1) return 'Invalid license format';
    const payloadB64 = raw.slice(0, dot);
    const sig        = raw.slice(dot + 1);
    const expected   = crypto.createHmac('sha256', _LS).update(payloadB64).digest('hex');
    if (sig !== expected) return 'License key is invalid';
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (new Date(p.expires) < new Date()) return `License expired on ${p.expires}`;
    const machineId = _getMachineId();
    if (p.machine && p.machine !== '*' && machineId && p.machine !== machineId)
      return 'License is not valid for this machine';
    console.log(`[License] Valid — client: ${p.client}, expires: ${p.expires}`);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return 'License file (license.key) not found';
    return 'License validation error';
  }
}

const _licenseError = _checkLicense();
if (_licenseError) {
  console.error(`[License] INVALID: ${_licenseError}`);
}

// ─── Middleware ─────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Sessions persist in the same Postgres DB (not memory) so staff stay logged
// in across a self-update's process restart, matching how everything else
// in this app already survives restarts.
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));

// Health check for the update-orchestrator (watchdog) to poll after a
// restart — deliberately placed before the license-redirect middleware so
// an update's health verification isn't confused by an unrelated license
// issue; it only answers "is the process up and serving requests."
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.use('/api', require('./src/routes/auth'));
app.use(requireSession);

app.use('/api', require('./src/routes/invoices'));
app.use('/api', require('./src/routes/ledger'));
app.use('/api', require('./src/routes/quotations'));
app.use('/api', require('./src/routes/payments'));
app.use('/api', require('./src/routes/updates'));
app.use('/api', require('./src/routes/users'));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aaral Marketing — Ledger Dashboard`);
  console.log(`  On this machine:  http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) {
      console.log(`  On the network:   http://${iface.address}:${PORT}`);
    }
  }
});

module.exports = app;
