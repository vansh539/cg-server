# Aaral Marketing — WhatsApp Bot + Chitti/Ledger Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Aaral Marketing as the second client of `payment-ledger-core` — a duplicated WhatsApp payment bot, plus a new licensed web dashboard for Chitti/invoice creation and per-customer ledger viewing, with WhatsApp notifications firing on every ledger-affecting event.

**Architecture:** Two Node processes (`whatsapp-bot/`, `dashboard/`) sharing one Postgres database (`aaral_bridge`) through the existing `payment-ledger-core` package. The bot owns the WhatsApp session and exposes a localhost-only `/notify` endpoint; the dashboard never touches WhatsApp directly, only that endpoint. Aaral-specific tables (`invoices`, `invoice_items`) live in the dashboard's own migration set, layered on top of the package's generic schema.

**Tech Stack:** Node.js, Express, PostgreSQL (`pg` via `payment-ledger-core`), `whatsapp-web.js`, plain HTML/CSS/vanilla JS for the dashboard frontend (no framework — matches the existing Narayani/Sai Krupa tools).

## Global Constraints

- No GST/tax fields, no formal invoice numbering series beyond a simple incrementing integer.
- No product catalog — every Chitti line item is typed freehand.
- No weight column/section on the Chitti (cement is sold by qty, not weight).
- The dashboard never calls WhatsApp directly — only via the bot's `127.0.0.1`-only `/notify` endpoint.
- Notification failures must never roll back or block a save.
- License validation reuses the exact existing HMAC scheme and shared secret already embedded in Narayani's and Sai Krupa's `server.js` — do not invent a new scheme.

---

### Task 1: Bootstrap Aaral's WhatsApp bot

**Files:**
- Create: `Clients /Aaral Marketing/whatsapp-bot/` (copied from `Clients /CoKarma/`)
- Modify: `Clients /Aaral Marketing/whatsapp-bot/package.json`
- Modify: `Clients /Aaral Marketing/whatsapp-bot/.env`

**Interfaces:**
- Produces: a running `aaral_bridge` Postgres database with `payment-ledger-core`'s schema applied, an `admins` row for Aaral's owner, and a bot process reachable at `WA_SESSION_PATH=./wa-sessions` once QR-scanned. Later tasks depend on this database existing.

- [ ] **Step 1: Copy CoKarma's bot as the starting template**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients "
mkdir -p "Aaral Marketing/whatsapp-bot"
rsync -a --exclude node_modules --exclude wa-sessions --exclude logs \
  --exclude proofs --exclude .wwebjs_cache --exclude .swarm \
  --exclude ruvector.db --exclude '*.dump' --exclude test-before.log \
  --exclude .env --exclude .env.test \
  "CoKarma/" "Aaral Marketing/whatsapp-bot/"
```

**Expected:** `Aaral Marketing/whatsapp-bot/` contains `src/`, `scripts/`, `tests/`, `ocr-service/`, `ecosystem.config.js`, `package.json`, `.env.example`, `.env.test.example`, `README.md` — no session data, logs, or proofs carried over.

- [ ] **Step 2: Rename the package**

Edit `Aaral Marketing/whatsapp-bot/package.json` — change:
```json
  "name": "cokarma-payment-bridge",
  "description": "WhatsApp payment reconciliation bridge for CoKarma customer payments",
```
to:
```json
  "name": "aaral-marketing-payment-bridge",
  "description": "WhatsApp payment reconciliation bridge for Aaral Marketing customer payments",
```

- [ ] **Step 2b: Rename the PM2 app in `ecosystem.config.js`**

Edit `Aaral Marketing/whatsapp-bot/ecosystem.config.js` — change `name: 'cokarma-bridge',` to `name: 'aaral-bridge',`. Leave every other field as-is (it already matches the tuned `kill_timeout`/`restart_delay` values from CoKarma's shutdown-handling history — see Task 2's comment).

- [ ] **Step 3: Create the `.env`**

Create `Aaral Marketing/whatsapp-bot/.env`:
```
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aaral_bridge
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
WA_SESSION_PATH=./wa-sessions
PROOFS_PATH=./proofs
CHROME_PATH=

TEST_MODE_ALLOWED_NUMBERS=
```

- [ ] **Step 4: Install and migrate**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot"
npm install
createdb aaral_bridge
npm run migrate
```

**Expected:** `Migrations complete.` printed, no errors. Verify:
```bash
psql aaral_bridge -c "\dt"
```
**Expected tables:** `customers, dues, dues_imports, payment_claims, admins, schema_migrations` (plus the `customer_balances` view under `\dv`).

- [ ] **Step 5: Seed the admin and smoke-test the connection**

```bash
node scripts/seed-admin.js <AARAL_OWNER_WHATSAPP_NUMBER> "Aaral Marketing"
node -e "require('payment-ledger-core/db').testConnection().then(() => process.exit(0))"
```
**Expected:** `Admin seeded: Aaral Marketing (...)` then `[payment-ledger-core] Database connected: aaral_bridge`.

- [ ] **Step 6: One-time OCR venv setup (manual, per machine — not scripted)**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/ocr-service"
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
(Skip if this is the same machine that already set up CoKarma's OCR venv and you're reusing the interpreter — but each client's `ocr-service/venv` is separate since it lives inside that client's own gitignored folder.)

- [ ] **Step 7: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot"
git commit -m "feat(aaral-marketing): bootstrap WhatsApp payment bot from CoKarma template"
```

---

### Task 2: Add `/notify` endpoint and admin balance notification to Aaral's bot

**Files:**
- Modify: `Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `flows.toWhatsAppChatId(phone)`, `flows.formatBalanceLine(balance)`, `balances.getBalanceByCustomerId(id)`, `query(sql, params)` — all already imported in `bot.js`.
- Produces: `POST http://127.0.0.1:<NOTIFY_SERVICE_PORT>/notify` with body `{ phone, message }`, returning `{ sent: true }` or `{ sent: false, reason }`. Task 5's `dashboard/src/notify.js` depends on this exact contract.

- [ ] **Step 1: Add the notify HTTP server**

In `src/whatsapp/bot.js`, after the existing OCR service constants (near line 49, right after `const OCR_SERVICE_URL = ...`), add:

```javascript
// ── Notify service (internal, for the dashboard) ──────────────
// A minimal localhost-only HTTP server so the Aaral dashboard (a separate
// process) can ask this bot to send a WhatsApp message, without ever
// touching the WhatsApp session itself. Only this process may own that
// session — see the shutdown-handling history in CoKarma's design docs
// for why introducing a second owner of client is not something to risk.
const http = require('http');
const NOTIFY_SERVICE_PORT = process.env.NOTIFY_SERVICE_PORT || 5002;

function startNotifyServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { phone, message } = JSON.parse(body);
        if (!phone || !message) {
          res.writeHead(400);
          res.end(JSON.stringify({ sent: false, reason: 'phone and message are required' }));
          return;
        }
        await client.sendMessage(flows.toWhatsAppChatId(phone), message);
        res.writeHead(200);
        res.end(JSON.stringify({ sent: true }));
      } catch (e) {
        logger.error('[Notify] Failed to send message', { error: e.message });
        res.writeHead(200);
        res.end(JSON.stringify({ sent: false, reason: e.message }));
      }
    });
  });
  server.listen(NOTIFY_SERVICE_PORT, '127.0.0.1', () => {
    logger.info(`[Notify] Listening on 127.0.0.1:${NOTIFY_SERVICE_PORT}`);
  });
}
```

- [ ] **Step 2: Start the notify server once WhatsApp is ready**

Find the existing `client.on('ready', ...)` handler (around line 308):
```javascript
client.on('ready', () => {
  clearTimeout(startupWatchdog);
  logger.info('[WhatsApp] Bot connected and ready!');
  setInterval(async () => {
    try { await client.getState(); } catch (_) {}
  }, 15000);
});
```
Add `startNotifyServer();` as the first line inside it:
```javascript
client.on('ready', () => {
  clearTimeout(startupWatchdog);
  logger.info('[WhatsApp] Bot connected and ready!');
  startNotifyServer();
  setInterval(async () => {
    try { await client.getState(); } catch (_) {}
  }, 15000);
});
```

- [ ] **Step 3: Notify active admins (with balance) on CONFIRM**

Find the CONFIRM branch in `handleAdminCommand` (around line 518-537):
```javascript
    if (parsed.command === 'CONFIRM') {
      const updated = await claims.confirmClaim(fullId, waNumber);
      if (updated) {
        await safeSend(msg, `Claim #${parsed.claimId} confirmed.`);
        const customer = await customers.findById(updated.customer_id);
        if (customer) {
          const chatId = flows.toWhatsAppChatId(customer.phone_number);
          let balanceLine = '';
          try {
            const balance = await balances.getBalanceByCustomerId(customer.id);
            if (balance) balanceLine = `\n${flows.formatBalanceLine(balance.balance)}`;
          } catch (e) {
            logger.error('[WhatsApp] Failed to fetch balance for confirmation message', { customer: customer.phone_number, error: e.message });
          }
          try {
            await client.sendMessage(chatId, `✅ Your payment of ₹${updated.amount_claimed} has been confirmed. Thank you!${balanceLine}`);
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify customer of confirmation', { customer: customer.phone_number, error: e.message });
          }
        }
      } else {
```

Insert a new block immediately after the customer-notify `try/catch` (right before the closing `}` of `if (customer) {`):
```javascript
          try {
            const { rows: activeAdmins } = await query('SELECT phone_number FROM admins WHERE active = true');
            const adminBalance = await balances.getBalanceByCustomerId(customer.id);
            const adminBalanceLine = adminBalance ? flows.formatBalanceLine(adminBalance.balance) : '';
            for (const admin of activeAdmins) {
              if (admin.phone_number.replace(/\D/g, '').slice(-10) === waNumber) continue;
              await client.sendMessage(
                flows.toWhatsAppChatId(admin.phone_number),
                `Payment of ₹${updated.amount_claimed} received from ${customer.name}. ${adminBalanceLine}`
              );
            }
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify admins of confirmation', { error: e.message });
          }
```

- [ ] **Step 4: Manual verification (no automated test — `bot.js` is the documented untested I/O layer)**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot"
npm start
```
Scan the QR, wait for `[WhatsApp] Bot connected and ready!` then `[Notify] Listening on 127.0.0.1:5002`. In another terminal:
```bash
curl -s -X POST http://127.0.0.1:5002/notify \
  -H "Content-Type: application/json" \
  -d '{"phone":"<your own WhatsApp number>","message":"Notify endpoint test"}'
```
**Expected:** `{"sent":true}` and the message actually arrives on WhatsApp. Then send a real test payment claim from a second test number and `CONFIRM` it as admin — confirm both the customer message and (for any *other* seeded admin) the admin balance message arrive.

- [ ] **Step 5: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/whatsapp-bot/src/whatsapp/bot.js"
git commit -m "feat(aaral-marketing): add /notify endpoint and admin balance notification on CONFIRM"
```

---

### Task 3: Aaral-specific schema — `invoices` and `invoice_items`

**Files:**
- Create: `Clients /Aaral Marketing/dashboard/migrations-aaral/001_create_invoices.sql`
- Create: `Clients /Aaral Marketing/dashboard/src/db/migrateAaral.js`
- Create: `Clients /Aaral Marketing/dashboard/scripts/migrate.js`
- Create: `Clients /Aaral Marketing/dashboard/package.json`
- Create: `Clients /Aaral Marketing/dashboard/.env`

**Interfaces:**
- Produces: `applyAaralMigrations(pool): Promise<void>` — Task 5's tests and Task 3's own manual verification depend on the `invoices`/`invoice_items` tables it creates.

- [ ] **Step 1: Create the dashboard package**

Create `Clients /Aaral Marketing/dashboard/package.json`:
```json
{
  "name": "aaral-marketing-dashboard",
  "version": "1.0.0",
  "description": "Chitti/invoice creation and customer ledger dashboard for Aaral Marketing",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "migrate": "node scripts/migrate.js",
    "test": "node --test --test-concurrency=1"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "payment-ledger-core": "file:../../../packages/payment-ledger-core"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Write the migration SQL**

Create `Clients /Aaral Marketing/dashboard/migrations-aaral/001_create_invoices.sql`:
```sql
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number serial UNIQUE,
  customer_id uuid REFERENCES customers(id),
  paid_now boolean NOT NULL DEFAULT true,
  unloading_charge numeric(12,2),
  subtotal numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  s_no integer NOT NULL,
  particulars text NOT NULL,
  grade text,
  vch text,
  qty numeric(12,2) NOT NULL,
  rate numeric(12,2) NOT NULL,
  amount numeric(12,2) NOT NULL
);
```

- [ ] **Step 3: Write the Aaral migration runner as a pure function**

Create `Clients /Aaral Marketing/dashboard/src/db/migrateAaral.js`:
```javascript
const fs = require('fs');
const path = require('path');

async function applyAaralMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations_aaral (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, '..', '..', 'migrations-aaral');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations_aaral WHERE filename = $1', [file]);
    if (rows.length) {
      console.log(`Skipping already-applied Aaral migration: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying Aaral migration: ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations_aaral (filename) VALUES ($1)', [file]);
  }

  console.log('Aaral migrations complete.');
}

module.exports = { applyAaralMigrations };
```

- [ ] **Step 4: Write the CLI wrapper**

Create `Clients /Aaral Marketing/dashboard/scripts/migrate.js`:
```javascript
require('dotenv').config();
const { pool } = require('payment-ledger-core/db');
const { migrate } = require('payment-ledger-core/migrate');
const { applyAaralMigrations } = require('../src/db/migrateAaral');

(async () => {
  await migrate(pool);
  await applyAaralMigrations(pool);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Create `.env` and run the migration**

Create `Clients /Aaral Marketing/dashboard/.env`:
```
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aaral_bridge
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
PORT=3400
NOTIFY_SERVICE_URL=http://127.0.0.1:5002
```

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard"
npm install
npm run migrate
```
**Expected:** `Skipping already-applied migration: 001_init.sql` (etc., from the package — already applied by Task 1) followed by `Applying Aaral migration: 001_create_invoices.sql` then `Aaral migrations complete.`

Verify:
```bash
psql aaral_bridge -c "\d invoices" -c "\d invoice_items"
```
**Expected:** both tables listed with the exact columns above.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/package.json" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/migrations-aaral" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/db/migrateAaral.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/scripts/migrate.js"
git commit -m "feat(aaral-marketing): add invoices/invoice_items schema and Aaral migration runner"
```

---

### Task 4: Dashboard server scaffold with license gate

**Files:**
- Create: `Clients /Aaral Marketing/dashboard/server.js`
- Create: `Clients /Aaral Marketing/dashboard/public/expired.html` (copied from Narayani's)
- Create: `Clients /Aaral Marketing/dashboard/public/index.html` (placeholder, replaced in Task 8)
- Create: `Clients /Aaral Marketing/dashboard/license.key` (generated, not committed)

**Interfaces:**
- Produces: an Express `app` listening on `PORT` (default 3400) at `127.0.0.1`, static files served from `public/`, gated on a valid `license.key`. Task 6 and Task 8 mount routers and add pages onto this same `app`/`public/` in place.

- [ ] **Step 1: Write `server.js`**

Create `Clients /Aaral Marketing/dashboard/server.js`, reusing the exact license-validation scheme already embedded in Narayani's and Sai Krupa's `server.js` (same shared secret — do not change it, existing licenses would break):
```javascript
'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3400;

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

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Aaral Marketing — Ledger Dashboard`);
  console.log(`  Open in browser: http://localhost:${PORT}`);
});

module.exports = app;
```

- [ ] **Step 2: Copy the expired-license page**

```bash
cp "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Narayani Steels /app/public/expired.html" \
   "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/expired.html"
```

- [ ] **Step 3: Placeholder homepage**

Create `Clients /Aaral Marketing/dashboard/public/index.html`:
```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Aaral Marketing — Dashboard</title></head>
<body><p>Dashboard scaffold running. Customer list lands in Task 8.</p></body>
</html>
```

- [ ] **Step 4: Generate the license key**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Tools"
node license-gen.js --client "Aaral Marketing" --expiry 2027-07-09
```
Copy the printed key into `Clients /Aaral Marketing/dashboard/license.key` (no trailing newline issues — paste exactly as printed). Log the issuance in `IntelliTech Solutions/License_Tracker.xlsx` per the generator's own instructions.

- [ ] **Step 5: Verify it runs**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard"
node server.js
```
**Expected:** `[License] Valid — client: Aaral Marketing, expires: 2027-07-09` then `Aaral Marketing — Ledger Dashboard`. Visit `http://localhost:3400` — placeholder page loads. Temporarily rename `license.key` and restart to confirm `http://localhost:3400/anything` redirects to `/expired.html`; rename it back.

- [ ] **Step 5b: Add the PM2 process definition**

Create `Clients /Aaral Marketing/dashboard/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'aaral-dashboard',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
      restart_delay: 30000,
      max_restarts: 5,
      min_uptime: '30s',
    },
  ],
};
```
Not started via PM2 in this plan (local verification uses `node server.js` directly) — this file is what Aaral's office server deployment (see "After this plan") will run with `pm2 start ecosystem.config.js`.

- [ ] **Step 6: Commit (license.key excluded)**

Create `Clients /Aaral Marketing/dashboard/.gitignore`:
```
node_modules/
license.key
.env
```
```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/server.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/expired.html" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/index.html" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/ecosystem.config.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/.gitignore"
git commit -m "feat(aaral-marketing): add licensed dashboard server scaffold"
```

---

### Task 5: Invoice creation logic with ledger auto-linking (TDD)

**Files:**
- Create: `Clients /Aaral Marketing/dashboard/src/invoices.js`
- Create: `Clients /Aaral Marketing/dashboard/tests/helpers/db.js`
- Create: `Clients /Aaral Marketing/dashboard/tests/invoices.test.js`
- Create: `Clients /Aaral Marketing/dashboard/.env.test`

**Interfaces:**
- Consumes: `pool` from `payment-ledger-core/db`; the `invoices`/`invoice_items`/`dues`/`payment_claims` tables from Tasks 1 & 3.
- Produces: `createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy }): Promise<{ invoice, items, dueId, claimId }>`. Task 6's route handler depends on this exact signature and return shape.

- [ ] **Step 1: Create the test database and `.env.test`**

```bash
createdb aaral_bridge_test
```
Create `Clients /Aaral Marketing/dashboard/.env.test`:
```
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aaral_bridge_test
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false
```
Run migrations against it:
```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard"
NODE_ENV=test DB_NAME=aaral_bridge_test node scripts/migrate.js
```

- [ ] **Step 2: Test helper**

Create `Clients /Aaral Marketing/dashboard/tests/helpers/db.js`:
```javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { pool } = require('payment-ledger-core/db');

async function resetDb() {
  await pool.query(
    'TRUNCATE invoice_items, invoices, payment_claims, dues, dues_imports, customers, admins RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, pool };
```

- [ ] **Step 3: Write the failing tests**

Create `Clients /Aaral Marketing/dashboard/tests/invoices.test.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { createInvoice } = require('../src/invoices');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('createInvoice with a customer and paidNow posts a due and a confirmed claim, net-zero balance', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });

  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '12', qty: 100, rate: 350 }],
    unloadingCharge: 500,
    paidNow: true,
    createdBy: '9999900000',
  });

  assert.equal(Number(result.invoice.subtotal), 35000);
  assert.equal(Number(result.invoice.total), 35500);
  assert.ok(result.dueId);
  assert.ok(result.claimId);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0);
});

test('createInvoice with a customer and on-account leaves the due open', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });

  await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'PPC Cement', grade: '53', vch: '7', qty: 50, rate: 360 }],
    unloadingCharge: null,
    paidNow: false,
    createdBy: '9999900000',
  });

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 18000);
});

test('createInvoice with no customer (walk-in) does not touch the ledger', async () => {
  const result = await createInvoice({
    customerId: null,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '3', qty: 10, rate: 350 }],
    unloadingCharge: null,
    paidNow: true,
    createdBy: '9999900000',
  });

  assert.equal(result.dueId, null);
  assert.equal(result.claimId, null);
  const { rows } = await pool.query('SELECT count(*) FROM dues');
  assert.equal(rows[0].count, '0');
});

test('createInvoice rejects an item with non-positive qty', async () => {
  await assert.rejects(
    () => createInvoice({
      customerId: null,
      items: [{ particulars: 'OPC Cement', grade: '43', vch: '3', qty: 0, rate: 350 }],
      unloadingCharge: null,
      paidNow: true,
      createdBy: '9999900000',
    }),
    /Line 1/
  );
});

test('createInvoice rejects an empty items list', async () => {
  await assert.rejects(
    () => createInvoice({ customerId: null, items: [], unloadingCharge: null, paidNow: true, createdBy: '9999900000' }),
    /line item is required/
  );
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard"
npm test
```
**Expected:** FAIL — `Cannot find module '../src/invoices'`.

- [ ] **Step 5: Implement `createInvoice`**

Create `Clients /Aaral Marketing/dashboard/src/invoices.js`:
```javascript
const { pool } = require('payment-ledger-core/db');

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one line item is required');
  }
  return items.map((item, i) => {
    const qty = Number(item.qty);
    const rate = Number(item.rate);
    if (!item.particulars || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Line ${i + 1}: particulars, qty, and rate are required and must be positive`);
    }
    return {
      sNo: i + 1,
      particulars: item.particulars,
      grade: item.grade || null,
      vch: item.vch || null,
      qty,
      rate,
      amount: Math.round(qty * rate * 100) / 100,
    };
  });
}

async function createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy }) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const total = subtotal + (unloading || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: invoiceRows } = await client.query(
      `INSERT INTO invoices (customer_id, paid_now, unloading_charge, subtotal, total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId || null, !!paidNow, unloading, subtotal, total, createdBy]
    );
    const invoice = invoiceRows[0];

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, s_no, particulars, grade, vch, qty, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, item.sNo, item.particulars, item.grade, item.vch, item.qty, item.rate, item.amount]
      );
    }

    let dueId = null;
    let claimId = null;
    if (customerId) {
      const { rows: dueRows } = await client.query(
        `INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, $2, $3) RETURNING id`,
        [customerId, `Invoice #${invoice.invoice_number}`, total]
      );
      dueId = dueRows[0].id;

      if (paidNow) {
        const { rows: claimRows } = await client.query(
          `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status, reviewed_by, reviewed_at)
           VALUES ($1, $2, 'cash', 'confirmed', $3, now()) RETURNING id`,
          [customerId, total, createdBy]
        );
        claimId = claimRows[0].id;
      }
    }

    await client.query('COMMIT');
    return { invoice, items: normalizedItems, dueId, claimId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createInvoice };
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test
```
**Expected:** all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/invoices.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/tests"
git commit -m "feat(aaral-marketing): add createInvoice with ledger auto-linking, TDD"
```

---

### Task 6: Invoice + ledger API routes, wired to notify

**Files:**
- Create: `Clients /Aaral Marketing/dashboard/src/notify.js`
- Create: `Clients /Aaral Marketing/dashboard/src/routes/invoices.js`
- Create: `Clients /Aaral Marketing/dashboard/src/routes/ledger.js`
- Modify: `Clients /Aaral Marketing/dashboard/server.js`

**Interfaces:**
- Consumes: `createInvoice` (Task 5), the bot's `POST /notify` (Task 2).
- Produces: `POST /api/invoices`, `GET /api/customers?q=`, `GET /api/customers/:id/ledger` — Task 7 and Task 8's frontend pages call these.

- [ ] **Step 1: Write the notify client**

Create `Clients /Aaral Marketing/dashboard/src/notify.js`:
```javascript
async function notify(phone, message) {
  const url = process.env.NOTIFY_SERVICE_URL || 'http://127.0.0.1:5002';
  try {
    const res = await fetch(`${url}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.sent === true;
  } catch (err) {
    console.error('[Notify] Failed to reach bot notify service:', err.message);
    return false;
  }
}

module.exports = { notify };
```

- [ ] **Step 2: Write the invoices route**

Create `Clients /Aaral Marketing/dashboard/src/routes/invoices.js`:
```javascript
const express = require('express');
const { createInvoice } = require('../invoices');
const { notify } = require('../notify');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');

const router = express.Router();

router.post('/invoices', async (req, res) => {
  try {
    const { customerId, items, unloadingCharge, paidNow, createdBy } = req.body;
    const result = await createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy });

    if (customerId) {
      const customer = await customers.findById(customerId);
      const balance = await balances.getBalanceByCustomerId(customerId);
      const balanceLine = balance ? `Balance: ₹${balance.balance}` : '';

      const customerMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received, thank you! ${balanceLine}`
        : `New invoice #${result.invoice.invoice_number} for ₹${result.invoice.total}. ${balanceLine}`;
      const adminMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received from ${customer.name}. ${balanceLine}`
        : `Invoice #${result.invoice.invoice_number} (₹${result.invoice.total}) issued to ${customer.name}. ${balanceLine}`;

      notify(customer.phone_number, customerMsg);
      const { rows: admins } = await query('SELECT phone_number FROM admins WHERE active = true');
      for (const admin of admins) notify(admin.phone_number, adminMsg);
    }

    res.json({
      ok: true,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoice_number,
      total: result.invoice.total,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  const { rows: invoiceRows } = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
  const { rows: itemRows } = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
    [req.params.id]
  );
  res.json({ invoice: invoiceRows[0], items: itemRows });
});

module.exports = router;
```

- [ ] **Step 3: Write the ledger route**

Create `Clients /Aaral Marketing/dashboard/src/routes/ledger.js`:
```javascript
const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');

const router = express.Router();

router.get('/customers', async (req, res) => {
  const term = req.query.q;
  if (term) {
    const results = await balances.searchBalances(term);
    return res.json(results);
  }
  const { rows } = await query('SELECT * FROM customer_balances ORDER BY name ASC');
  res.json(rows);
});

router.get('/customers/:id/ledger', async (req, res) => {
  const balance = await balances.getBalanceByCustomerId(req.params.id);
  if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

  const { rows } = await query(
    `SELECT 'invoice' AS type, id, description AS label, amount_due AS amount, created_at AS occurred_at
     FROM dues WHERE customer_id = $1
     UNION ALL
     SELECT 'payment' AS type, id, proof_type AS label, amount_claimed AS amount, reported_at AS occurred_at
     FROM payment_claims WHERE customer_id = $1 AND status = 'confirmed'
     ORDER BY occurred_at ASC`,
    [req.params.id]
  );

  let running = 0;
  const entries = rows.map((row) => {
    running += row.type === 'invoice' ? Number(row.amount) : -Number(row.amount);
    return { ...row, runningBalance: running };
  });

  res.json({ customer: { name: balance.name, phone_number: balance.phone_number, balance: balance.balance }, entries });
});

module.exports = router;
```

- [ ] **Step 4: Mount the routers**

In `Clients /Aaral Marketing/dashboard/server.js`, find the license-gate block written in Task 4:
```javascript
app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.use(express.static(path.join(__dirname, 'public')));
```
Insert the two router mounts between those two lines, so API calls are covered by the license gate the same as the static pages:
```javascript
app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.use('/api', require('./src/routes/invoices'));
app.use('/api', require('./src/routes/ledger'));

app.use(express.static(path.join(__dirname, 'public')));
```

- [ ] **Step 5: Manual verification**

With the Aaral bot running (Task 2) and `node server.js` running:
```bash
curl -s -X POST http://localhost:3400/api/invoices \
  -H "Content-Type: application/json" \
  -d '{"items":[{"particulars":"OPC Cement","grade":"43","vch":"12","qty":100,"rate":350}],"unloadingCharge":500,"paidNow":true,"createdBy":"manual-test"}'
```
**Expected:** `{"ok":true,"invoiceId":"...","invoiceNumber":1,"total":"35500.00"}` — no `customerId` given, so no notify calls fire (verify no WhatsApp messages sent). Then repeat with a real `customerId` (create one first via `psql` or the customers module) and confirm both the customer and admin WhatsApp messages arrive with the correct balance.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/notify.js" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/src/routes" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/server.js"
git commit -m "feat(aaral-marketing): wire invoice/ledger API routes and WhatsApp notify"
```

---

### Task 7: Chitti creation and print page

**Files:**
- Create: `Clients /Aaral Marketing/dashboard/public/chitti.html`

**Interfaces:**
- Consumes: `GET /api/customers?q=`, `POST /api/invoices` (Task 6).

- [ ] **Step 1: Write the Chitti page**

Create `Clients /Aaral Marketing/dashboard/public/chitti.html`:
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>New Chitti — Aaral Marketing</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  label { display: block; font-size: 0.85rem; color: #555; margin-top: 0.8rem; }
  input, select { padding: 0.4rem; font-size: 0.95rem; width: 100%; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem; font-size: 0.85rem; text-align: left; }
  th { background: #f2f2f2; }
  td input { border: none; width: 100%; }
  .row-amount, .totals span { font-variant-numeric: tabular-nums; }
  .totals { margin-top: 1rem; text-align: right; font-size: 1rem; }
  .totals .grand { font-weight: 700; font-size: 1.2rem; }
  button { margin-top: 1.2rem; padding: 0.6rem 1.2rem; font-size: 0.95rem; cursor: pointer; }
  #customerResults { border: 1px solid #ccc; max-height: 140px; overflow-y: auto; display: none; }
  #customerResults div { padding: 0.4rem; cursor: pointer; }
  #customerResults div:hover { background: #f2f2f2; }
  @media print {
    button, #addRow, #customerSearch, #customerResults, .no-print { display: none; }
  }
</style>
</head>
<body>

<h1>Aaral Marketing — New Chitti</h1>

<label>Customer (leave blank for a walk-in / cash sale)</label>
<input type="text" id="customerSearch" placeholder="Search by name or phone…" autocomplete="off">
<div id="customerResults"></div>
<div id="selectedCustomer" style="margin-top:0.4rem;font-size:0.9rem;color:#555;"></div>

<table id="itemsTable">
  <thead>
    <tr><th>S No.</th><th>Particulars</th><th>Grade</th><th>Vch</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
  </thead>
  <tbody></tbody>
</table>
<button id="addRow" class="no-print" type="button">+ Add line</button>

<div class="totals">
  <div>Subtotal: ₹<span id="subtotal">0.00</span></div>
  <div class="no-print">
    <label style="display:inline;">Unloading charges: ₹</label>
    <input id="unloading" type="number" min="0" step="0.01" style="width:100px;display:inline;">
  </div>
  <div class="grand">Total: ₹<span id="grandTotal">0.00</span></div>
</div>

<div class="no-print" style="margin-top:1rem;">
  <label style="display:inline;"><input type="checkbox" id="paidNow" checked style="width:auto;"> Paid now</label>
</div>

<button id="saveAndPrint" type="button">Save &amp; Print</button>
<div id="status" style="margin-top:0.6rem;font-size:0.9rem;"></div>

<script>
let selectedCustomerId = null;
const tbody = document.querySelector('#itemsTable tbody');

function addRow() {
  const tr = document.createElement('tr');
  const sNo = tbody.children.length + 1;
  tr.innerHTML = `
    <td>${sNo}</td>
    <td><input class="particulars"></td>
    <td><input class="grade"></td>
    <td><input class="vch"></td>
    <td><input class="qty" type="number" min="0" step="0.01"></td>
    <td><input class="rate" type="number" min="0" step="0.01"></td>
    <td class="row-amount">0.00</td>`;
  tbody.appendChild(tr);
  tr.querySelectorAll('.qty, .rate').forEach((el) => el.addEventListener('input', recalc));
}

function recalc() {
  let subtotal = 0;
  tbody.querySelectorAll('tr').forEach((tr) => {
    const qty = Number(tr.querySelector('.qty').value) || 0;
    const rate = Number(tr.querySelector('.rate').value) || 0;
    const amount = qty * rate;
    tr.querySelector('.row-amount').textContent = amount.toFixed(2);
    subtotal += amount;
  });
  const unloading = Number(document.getElementById('unloading').value) || 0;
  document.getElementById('subtotal').textContent = subtotal.toFixed(2);
  document.getElementById('grandTotal').textContent = (subtotal + unloading).toFixed(2);
}

document.getElementById('unloading').addEventListener('input', recalc);
document.getElementById('addRow').addEventListener('click', addRow);
addRow();

const searchInput = document.getElementById('customerSearch');
const resultsBox = document.getElementById('customerResults');
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  selectedCustomerId = null;
  const term = searchInput.value.trim();
  if (!term) { resultsBox.style.display = 'none'; return; }
  searchTimer = setTimeout(async () => {
    const res = await fetch(`/api/customers?q=${encodeURIComponent(term)}`);
    const matches = await res.json();
    resultsBox.innerHTML = '';
    matches.forEach((c) => {
      const div = document.createElement('div');
      div.textContent = `${c.name} — ${c.phone_number} (Balance: ₹${c.balance})`;
      div.addEventListener('click', () => {
        selectedCustomerId = c.customer_id;
        document.getElementById('selectedCustomer').textContent = `Selected: ${c.name} (₹${c.balance} balance)`;
        resultsBox.style.display = 'none';
        searchInput.value = c.name;
      });
      resultsBox.appendChild(div);
    });
    resultsBox.style.display = matches.length ? 'block' : 'none';
  }, 250);
});

document.getElementById('saveAndPrint').addEventListener('click', async () => {
  const items = [...tbody.querySelectorAll('tr')].map((tr) => ({
    particulars: tr.querySelector('.particulars').value,
    grade: tr.querySelector('.grade').value,
    vch: tr.querySelector('.vch').value,
    qty: tr.querySelector('.qty').value,
    rate: tr.querySelector('.rate').value,
  }));
  const body = {
    customerId: selectedCustomerId,
    items,
    unloadingCharge: document.getElementById('unloading').value || null,
    paidNow: document.getElementById('paidNow').checked,
    createdBy: 'dashboard',
  };
  const statusEl = document.getElementById('status');
  const res = await fetch('/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    statusEl.textContent = `Error: ${data.error}`;
    statusEl.style.color = '#b1402f';
    return;
  }
  statusEl.textContent = `Saved as Invoice #${data.invoiceNumber}.`;
  statusEl.style.color = '#3f7a52';
  window.print();
});
</script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

With the dashboard running, open `http://localhost:3400/chitti.html`:
1. Add two line items, confirm the amount column and totals update live.
2. Type a customer search term, confirm results appear and clicking one selects it and shows their balance.
3. Enter an unloading charge, confirm the grand total updates.
4. Click **Save & Print** with no customer selected — confirm `{ok:true}` response, no ledger row created (check via `psql aaral_bridge -c "select count(*) from dues"` stays the same), and the print dialog opens.
5. Repeat with a customer selected and **Paid now** checked — confirm the customer's balance is unchanged (net-zero) via `GET /api/customers?q=<name>`, and both a WhatsApp customer and admin message arrive.
6. Repeat with **Paid now** unchecked — confirm the customer's balance increases by the invoice total.

- [ ] **Step 3: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/chitti.html"
git commit -m "feat(aaral-marketing): add Chitti creation and print page"
```

---

### Task 8: Ledger dashboard — customer list and per-customer detail

**Files:**
- Modify: `Clients /Aaral Marketing/dashboard/public/index.html`
- Create: `Clients /Aaral Marketing/dashboard/public/customer.html`

**Interfaces:**
- Consumes: `GET /api/customers?q=`, `GET /api/customers/:id/ledger` (Task 6).

- [ ] **Step 1: Replace the placeholder homepage with the customer list**

Overwrite `Clients /Aaral Marketing/dashboard/public/index.html`:
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Aaral Marketing — Customers</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; color: #1a1a1a; }
  h1 { font-size: 1.3rem; display: flex; justify-content: space-between; align-items: center; }
  h1 a { font-size: 0.85rem; }
  input { padding: 0.5rem; width: 100%; box-sizing: border-box; font-size: 0.95rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e2e2e2; padding: 0.5rem; text-align: left; font-size: 0.9rem; }
  th { color: #666; font-size: 0.75rem; text-transform: uppercase; }
  td.balance { text-align: right; font-variant-numeric: tabular-nums; }
  .owes { color: #b1402f; }
  .credit { color: #3f7a52; }
  .settled { color: #888; }
  tr { cursor: pointer; }
  tr:hover { background: #f7f7f7; }
</style>
</head>
<body>

<h1>Customers <a href="/chitti.html">+ New Chitti</a></h1>
<input type="text" id="search" placeholder="Search by name or phone…">
<table>
  <thead><tr><th>Name</th><th>Phone</th><th style="text-align:right;">Balance</th></tr></thead>
  <tbody id="rows"></tbody>
</table>

<script>
const rowsEl = document.getElementById('rows');

function balanceClass(balance) {
  if (Number(balance) > 0) return 'owes';
  if (Number(balance) < 0) return 'credit';
  return 'settled';
}

async function load(term) {
  const url = term ? `/api/customers?q=${encodeURIComponent(term)}` : '/api/customers';
  const res = await fetch(url);
  const customers = await res.json();
  rowsEl.innerHTML = '';
  customers.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.name}</td><td>${c.phone_number}</td><td class="balance ${balanceClass(c.balance)}">₹${c.balance}</td>`;
    tr.addEventListener('click', () => { window.location.href = `/customer.html?id=${c.customer_id}`; });
    rowsEl.appendChild(tr);
  });
}

document.getElementById('search').addEventListener('input', (e) => load(e.target.value.trim()));
load();
</script>
</body>
</html>
```

- [ ] **Step 2: Write the per-customer ledger detail page**

Create `Clients /Aaral Marketing/dashboard/public/customer.html`:
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Customer Ledger — Aaral Marketing</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; color: #1a1a1a; }
  a.back { font-size: 0.85rem; }
  h1 { font-size: 1.3rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border-bottom: 1px solid #e2e2e2; padding: 0.5rem; text-align: left; font-size: 0.9rem; }
  th { color: #666; font-size: 0.75rem; text-transform: uppercase; }
  td.amount, td.running { text-align: right; font-variant-numeric: tabular-nums; }
  tr.invoice td.amount { color: #b1402f; }
  tr.payment td.amount { color: #3f7a52; }
</style>
</head>
<body>

<a class="back" href="/">&larr; All customers</a>
<h1 id="customerName">Loading…</h1>

<table>
  <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Balance</th></tr></thead>
  <tbody id="rows"></tbody>
</table>

<script>
const params = new URLSearchParams(window.location.search);
const customerId = params.get('id');

async function load() {
  const res = await fetch(`/api/customers/${customerId}/ledger`);
  const { customer, entries } = await res.json();
  const rowsEl = document.getElementById('rows');
  rowsEl.innerHTML = '';
  entries.forEach((e) => {
    const tr = document.createElement('tr');
    tr.className = e.type;
    const date = new Date(e.occurred_at).toLocaleDateString();
    const sign = e.type === 'invoice' ? '+' : '-';
    tr.innerHTML = `<td>${date}</td><td>${e.type}</td><td>${e.label}</td><td class="amount">${sign}₹${Number(e.amount).toFixed(2)}</td><td class="running">₹${e.runningBalance.toFixed(2)}</td>`;
    rowsEl.appendChild(tr);
  });
  document.getElementById('customerName').textContent = `${customer.name} — ${customer.phone_number} (Balance: ₹${customer.balance})`;
}

load();
</script>
</body>
</html>
```

- [ ] **Step 3: Manual verification**

With the dashboard running and at least one customer with a mix of on-account and paid invoices (from Task 7's manual testing):
1. Open `http://localhost:3400/` — confirm the customer list loads with correct balances and color-coding (red = owes, green = credit, grey = settled).
2. Type a search term — confirm the list filters.
3. Click a customer row — confirm `/customer.html?id=...` loads their full ledger, chronological, with a running balance column that matches the customer list's current balance on the last row.

- [ ] **Step 4: Commit**

```bash
cd "/Users/vanshjalan"
git add "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/index.html" \
        "Desktop/IntelliTech Solutions/Clients /Aaral Marketing/dashboard/public/customer.html"
git commit -m "feat(aaral-marketing): add customer list and per-customer ledger detail views"
```

---

## After this plan

Not covered here, deliberately deferred to a follow-up (per the design doc's non-goals and the existing "second client onboarding" runbook):
- PM2 process management + `ecosystem.config.js` for the dashboard (mirror the bot's existing one).
- Cloudflare Tunnel setup for remote dashboard access.
- Machine-locking the license (currently wildcard `*`, same as Narayani's pattern pre-lock).
- Deploying both processes to Aaral's actual office server (this plan builds and verifies locally first).
