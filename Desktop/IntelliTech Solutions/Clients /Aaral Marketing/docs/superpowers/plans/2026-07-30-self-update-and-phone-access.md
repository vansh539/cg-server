# Aaral Self-Update Mechanism + Phone PWA Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the client self-update the deployed Aaral system (git pull + migrate + restart + auto-rollback, orchestrated by the watchdog process, triggered from a PIN-gated dashboard button) and let the owner install the existing dashboard as a home-screen app on his iPhone — without Vansh needing TeamViewer for either.

**Architecture:** A new dedicated `aaral-marketing-deploy` GitHub repo (not the mega-repo) is what the office PC pulls from. `watchdog` (already a standing PM2 process on that machine) gains local-only HTTP endpoints that drive the whole update sequence and can safely restart `dashboard`/`whatsapp-bot` without being restarted itself. A lock file doubles as both the concurrency mutex and the power-loss recovery marker. The dashboard gets a thin proxy UI plus a new admin-PIN gate (there is no per-user auth today). The phone experience reuses the exact same dashboard via a `manifest.json` + Apple meta tags + a minimal, static-assets-only service worker.

**Tech Stack:** Node.js (CommonJS, no build step), Express, PM2 (+ its Node API), Postgres via `payment-ledger-core`, plain HTML/CSS/vanilla JS (no framework, no bundler — matches the rest of this project), `node:test` for backend unit tests.

## Global Constraints

- No TypeScript, no bundler, no frontend framework — this codebase is plain Node/Express + static HTML/CSS/JS throughout. Match that.
- Migrations stay additive-only (spec requirement) — this plan never adds a down-migration; rollback always means reverting *code*, never the schema.
- Every spawned child process (git/npm) must pass `windowsHide: true`.
- Every new localhost-only service binds to `127.0.0.1`, never `0.0.0.0` (matches the existing `/notify` pattern in `whatsapp-bot/src/whatsapp/bot.js`).
- No secrets committed — PAT and PIN hash live in git-ignored `.env` files only.
- Design source of truth: `docs/superpowers/specs/2026-07-30-self-update-and-phone-access-design.md`.

---

## Task 1: Admin PIN — hashing helper

**Files:**
- Create: `dashboard/src/adminAuth.js`
- Test: `dashboard/tests/adminAuth.test.js`

**Interfaces:**
- Produces: `hashPin(pin: string): string` (hex sha256), `verifyPin(suppliedPin: string): boolean` (reads `process.env.ADMIN_PIN_HASH`), `requirePin(req, res, next)` (Express middleware, reads `req.body.pin`)

- [ ] **Step 1: Write the failing test**

```js
// dashboard/tests/adminAuth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPin, verifyPin } = require('../src/adminAuth');

test('verifyPin accepts the correct PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin('4821'), true);
});

test('verifyPin rejects a wrong PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin('0000'), false);
});

test('verifyPin rejects when no PIN is configured', () => {
  delete process.env.ADMIN_PIN_HASH;
  assert.equal(verifyPin('4821'), false);
});

test('verifyPin rejects an empty supplied PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin(''), false);
  assert.equal(verifyPin(undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "dashboard" && node --test tests/adminAuth.test.js`
Expected: FAIL with "Cannot find module '../src/adminAuth'"

- [ ] **Step 3: Write minimal implementation**

```js
// dashboard/src/adminAuth.js
'use strict';
const crypto = require('crypto');

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function verifyPin(suppliedPin) {
  const expectedHash = process.env.ADMIN_PIN_HASH;
  if (!expectedHash || !suppliedPin) return false;
  const suppliedHash = hashPin(suppliedPin);
  const a = Buffer.from(suppliedHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requirePin(req, res, next) {
  if (!verifyPin(req.body && req.body.pin)) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  next();
}

module.exports = { hashPin, verifyPin, requirePin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "dashboard" && node --test tests/adminAuth.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Add the one-time PIN-setup script**

```js
// dashboard/scripts/set-admin-pin.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { hashPin } = require('../src/adminAuth');

const pin = process.argv[2];
if (!pin || !/^\d{4,8}$/.test(pin)) {
  console.error('Usage: node scripts/set-admin-pin.js <4-8 digit PIN>');
  process.exit(1);
}

const hash = hashPin(pin);
const envPath = path.join(__dirname, '..', '.env');
let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (/^ADMIN_PIN_HASH=/m.test(contents)) {
  contents = contents.replace(/^ADMIN_PIN_HASH=.*$/m, `ADMIN_PIN_HASH=${hash}`);
} else {
  contents += `${contents === '' || contents.endsWith('\n') ? '' : '\n'}ADMIN_PIN_HASH=${hash}\n`;
}
fs.writeFileSync(envPath, contents);
console.log('Admin PIN updated. Restart aaral-dashboard for it to take effect.');
```

Add to `dashboard/package.json` `scripts`: `"set-admin-pin": "node scripts/set-admin-pin.js"`.

- [ ] **Step 6: Commit**

```bash
git add "dashboard/src/adminAuth.js" "dashboard/tests/adminAuth.test.js" "dashboard/scripts/set-admin-pin.js" "dashboard/package.json"
git commit -m "feat(aaral): add admin PIN hashing helper and set-pin script"
```

---

## Task 2: Admin PIN — gate Add Customer and Opening Balance routes

**Files:**
- Modify: `dashboard/src/routes/ledger.js`

**Interfaces:**
- Consumes: `requirePin` from Task 1 (`dashboard/src/adminAuth.js`)

- [ ] **Step 1: Add the middleware to both sensitive routes**

```js
// dashboard/src/routes/ledger.js — add near the top, after existing requires
const { requirePin } = require('../adminAuth');
```

```js
// Change the route signatures (keep the existing handler bodies unchanged):
router.post('/customers', requirePin, async (req, res) => {
  // ...existing body...
});

router.post('/customers/:id/opening-balance', requirePin, async (req, res) => {
  // ...existing body...
});
```

- [ ] **Step 2: Manual verification**

Run: `curl -X POST http://localhost:3400/api/customers -H 'Content-Type: application/json' -d '{"name":"Test","phoneNumber":"9999999999"}'`
Expected: `401 {"ok":false,"error":"Incorrect PIN"}` (no `ADMIN_PIN_HASH` set yet in dev — confirms the gate is active)

- [ ] **Step 3: Commit**

```bash
git add "dashboard/src/routes/ledger.js"
git commit -m "feat(aaral): gate Add Customer and Opening Balance behind admin PIN"
```

---

## Task 3: Admin PIN — wire the PIN field into the two existing modals

**Files:**
- Modify: `dashboard/public/index.html` (Add Customer modal)
- Modify: `dashboard/public/customer.html` (Opening Balance modal)

**Interfaces:**
- Consumes: `POST /api/customers` and `POST /api/customers/:id/opening-balance`, both now requiring `pin` in the JSON body (Task 2)

- [ ] **Step 1: `index.html` — add a PIN field to the Add Customer modal**

Insert before the existing `<div id="addCustomerError">` line (currently line 99):

```html
    <div class="field-group">
      <label>Admin PIN</label>
      <input type="password" id="newCustomerPin" inputmode="numeric" autocomplete="off">
    </div>
```

Update the save handler to include the PIN and surface a wrong-PIN error:

```js
document.getElementById('saveAddCustomer').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const phoneNumber = phoneInput.value.trim();
  const pin = document.getElementById('newCustomerPin').value;
  if (!name || !phoneNumber) {
    errorEl.textContent = 'Name and phone number are both required.';
    return;
  }
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phoneNumber, pin }),
  });
  const data = await res.json();
  if (res.status === 401) {
    errorEl.textContent = 'Incorrect PIN.';
    return;
  }
  if (!data.ok) {
    errorEl.textContent = data.error;
    return;
  }
  window.location.href = `/customer.html?id=${data.customerId}`;
});
```

Also clear the new field in `openModal()`:

```js
function openModal() {
  nameInput.value = '';
  phoneInput.value = '';
  document.getElementById('newCustomerPin').value = '';
  errorEl.textContent = '';
  modal.classList.add('open');
  nameInput.focus();
}
```

- [ ] **Step 2: `customer.html` — add a PIN field to the Opening Balance modal**

Insert before the existing `<div id="oldBalanceError">` line (currently line 104):

```html
    <div class="field-group">
      <label>Admin PIN</label>
      <input type="password" id="oldBalancePin" inputmode="numeric" autocomplete="off">
    </div>
```

Update the save handler:

```js
document.getElementById('saveOldBalance').addEventListener('click', async () => {
  const amount = oldBalanceAmount.value;
  if (!amount || Number(amount) === 0) {
    oldBalanceError.textContent = 'Enter a non-zero amount.';
    return;
  }
  const res = await fetch(`/api/customers/${customerId}/opening-balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      date: oldBalanceDate.value || null,
      description: oldBalanceDescription.value.trim() || null,
      pin: document.getElementById('oldBalancePin').value,
    }),
  });
  const data = await res.json();
  if (res.status === 401) {
    oldBalanceError.textContent = 'Incorrect PIN.';
    return;
  }
  if (!data.ok) {
    oldBalanceError.textContent = data.error;
    return;
  }
  closeOldBalanceModal();
  load();
});
```

And clear it in `openOldBalanceModal()`:

```js
function openOldBalanceModal() {
  oldBalanceAmount.value = '';
  oldBalanceDate.value = new Date().toLocaleDateString('en-CA');
  oldBalanceDescription.value = '';
  document.getElementById('oldBalancePin').value = '';
  oldBalanceError.textContent = '';
  oldBalanceModal.classList.add('open');
  oldBalanceAmount.focus();
}
```

- [ ] **Step 3: Manual verification**

Run `node scripts/set-admin-pin.js 4821` in `dashboard/`, restart the dev server, open `/` in a browser, try Add Customer with a wrong PIN (expect "Incorrect PIN."), then the right one (expect success + redirect). Repeat for Opening Balance on any customer's ledger page.

- [ ] **Step 4: Commit**

```bash
git add "dashboard/public/index.html" "dashboard/public/customer.html"
git commit -m "feat(aaral): add PIN field to Add Customer and Opening Balance modals"
```

---

## Task 4: Health endpoints on dashboard and whatsapp-bot

**Files:**
- Modify: `dashboard/server.js`
- Modify: `whatsapp-bot/src/whatsapp/bot.js`

**Interfaces:**
- Produces: `GET /health` on both processes, `200 {"ok": true}` when the process is up and serving requests — this is what the watchdog update flow polls after a restart (Tasks 6-9).

- [ ] **Step 1: Dashboard — add before the license-redirect middleware**

In `dashboard/server.js`, insert right after `app.use(express.json());`:

```js
// Health check for the update-orchestrator (watchdog) to poll after a
// restart — deliberately placed before the license-redirect middleware so
// an update's health verification isn't confused by an unrelated license
// issue; it only answers "is the process up and serving requests."
app.get('/health', (_req, res) => res.json({ ok: true }));
```

- [ ] **Step 2: whatsapp-bot — add to the existing raw HTTP notify server**

In `whatsapp-bot/src/whatsapp/bot.js`, inside `startNotifyServer()`'s `http.createServer` callback, add before the existing method/URL check:

```js
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== 'POST' || (req.url !== '/notify' && req.url !== '/notify-admins')) {
```

- [ ] **Step 3: Manual verification**

Run both processes locally, then: `curl http://localhost:3400/health` → `{"ok":true}`; `curl http://localhost:5002/health` → `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add "dashboard/server.js" "whatsapp-bot/src/whatsapp/bot.js"
git commit -m "feat(aaral): add /health endpoints for the update-orchestrator to poll"
```

---

## Task 5: Create the dedicated deploy repo + sync script

**Files:**
- Create: `deploy/sync-to-deploy-repo.sh`

**Interfaces:**
- Produces: a pushed/tagged commit on the `aaral-marketing-deploy` GitHub repo, which Tasks 6-9's `git pull` on the office PC will read from.

- [ ] **Step 1: One-time repo creation (Vansh runs this himself, not scripted)**

```bash
gh repo create <your-github-org>/aaral-marketing-deploy --private
git clone https://github.com/<your-github-org>/aaral-marketing-deploy.git \
  "/Users/vanshjalan/Desktop/IntelliTech Solutions/aaral-marketing-deploy-clone"
```

- [ ] **Step 2: Write the sync script**

```bash
#!/usr/bin/env bash
# Run from Vansh's Mac whenever cutting a release. Copies this client's
# runtime code + the payment-ledger-core package it depends on into a
# separate standalone clone of the private aaral-marketing-deploy repo
# (never the mega-repo itself — see the design doc for why), rewrites the
# payment-ledger-core file: dependency to the standalone layout, commits,
# and pushes.
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CLONE="${DEPLOY_CLONE_PATH:-$SRC_ROOT/../../aaral-marketing-deploy-clone}"
VERSION_TAG="${1:-}"

if [ ! -d "$DEPLOY_CLONE/.git" ]; then
  echo "Deploy clone not found at $DEPLOY_CLONE — run the one-time gh repo create + git clone first." >&2
  exit 1
fi

echo "Syncing dashboard/ whatsapp-bot/ watchdog/ ..."
for dir in dashboard whatsapp-bot watchdog; do
  rsync -a --delete \
    --exclude 'node_modules/' --exclude '.env' --exclude '.env.production' \
    --exclude 'logs/' --exclude 'wa-sessions/' --exclude '.wwebjs_cache/' \
    --exclude 'ruvector.db' --exclude '.swarm/' --exclude '.update-lock.json' \
    "$SRC_ROOT/$dir/" "$DEPLOY_CLONE/$dir/"
done

echo "Vendoring payment-ledger-core..."
rsync -a --delete \
  --exclude 'node_modules/' --exclude '.env.test' \
  "$SRC_ROOT/../../packages/payment-ledger-core/" "$DEPLOY_CLONE/payment-ledger-core/"

echo "Rewriting payment-ledger-core dependency path for the standalone layout..."
for pkg in dashboard/package.json whatsapp-bot/package.json; do
  node -e "
    const fs = require('fs');
    const p = '$DEPLOY_CLONE/$pkg';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.dependencies['payment-ledger-core'] = 'file:../payment-ledger-core';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
done

cd "$DEPLOY_CLONE"
git add -A
if git diff --cached --quiet; then
  echo "No changes to release."
  exit 0
fi
git commit -m "release: sync from source $(date +%Y-%m-%d)"
[ -n "$VERSION_TAG" ] && git tag "$VERSION_TAG"
git push origin main
[ -n "$VERSION_TAG" ] && git push origin "$VERSION_TAG"
echo "Pushed${VERSION_TAG:+ and tagged $VERSION_TAG}."
```

```bash
chmod +x deploy/sync-to-deploy-repo.sh
```

- [ ] **Step 3: Manual verification**

Run `./deploy/sync-to-deploy-repo.sh v0.0.1-test` once against the real clone; confirm the deploy repo on GitHub now contains `dashboard/`, `whatsapp-bot/`, `watchdog/`, `payment-ledger-core/`, and that `dashboard/package.json`'s `payment-ledger-core` dependency reads `file:../payment-ledger-core`.

- [ ] **Step 4: Commit (in the source mega-repo, not the deploy clone)**

```bash
git add "deploy/sync-to-deploy-repo.sh"
git commit -m "feat(aaral): add sync script that pushes releases to aaral-marketing-deploy"
```

---

## Task 6: Watchdog — command runner with token auth and windowsHide

**Files:**
- Create: `watchdog/src/updater.js`

**Interfaces:**
- Produces: `runCommand(cmd, args, cwd): Promise<string>`, `gitAuthArgs(): string[]`, `readLock(): object|null`, `writeLock(data): void`, `clearLock(): void`, `LOCK_FILE: string`

- [ ] **Step 1: Implementation (no test yet — this is the low-level primitive Task 7-11 build on and test through)**

```js
// watchdog/src/updater.js
'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const LOCK_FILE = path.join(__dirname, '..', '.update-lock.json');

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, windowsHide: true, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

function gitAuthArgs() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error('GITHUB_PAT is not set');
  const header = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${header}`];
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}
function writeLock(data) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify(data, null, 2));
}
function clearLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

module.exports = { LOCK_FILE, runCommand, gitAuthArgs, readLock, writeLock, clearLock };
```

- [ ] **Step 2: Add a `.gitignore` for the lock file**

```
# watchdog/.gitignore
node_modules/
.env
.update-lock.json
```

- [ ] **Step 3: Commit**

```bash
git add "watchdog/src/updater.js" "watchdog/.gitignore"
git commit -m "feat(aaral): add windowsHide-safe command runner and lock-file helpers"
```

---

## Task 7: Watchdog — `checkForUpdate`

**Files:**
- Modify: `watchdog/src/updater.js`
- Create: `watchdog/tests/updater.test.js`
- Modify: `watchdog/package.json` (add `"test": "node --test"`)

**Interfaces:**
- Consumes: `gitAuthArgs()` from Task 6
- Produces: `checkForUpdate({ repoRoot, run? }): Promise<{ updateAvailable: boolean, currentVersion: string, latestVersion?: string, commitsBehind?: number }>` — `run` is injectable so tests never touch a real git repo.

- [ ] **Step 1: Write the failing test**

```js
// watchdog/tests/updater.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdate } = require('../src/updater');

test('checkForUpdate reports up to date when local HEAD matches origin/main', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc1234567';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'abc1234567';
    return '';
  };
  const result = await checkForUpdate({ repoRoot: '/fake/repo', run });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.currentVersion, 'abc1234');
  assert.ok(calls.some((c) => c.includes('fetch origin main')));
});

test('checkForUpdate reports commits behind when origin/main is ahead', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const run = async (cmd, args) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'aaa1111111';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'bbb2222222';
    if (args.includes('rev-list')) return '3';
    return '';
  };
  const result = await checkForUpdate({ repoRoot: '/fake/repo', run });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.currentVersion, 'aaa1111');
  assert.equal(result.latestVersion, 'bbb2222');
  assert.equal(result.commitsBehind, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: FAIL with "checkForUpdate is not a function"

- [ ] **Step 3: Implement `checkForUpdate` (append to `watchdog/src/updater.js`)**

```js
async function checkForUpdate({ repoRoot, run = runCommand }) {
  await run('git', [...gitAuthArgs(), 'fetch', 'origin', 'main'], repoRoot);
  const local = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  const remote = await run('git', ['rev-parse', 'origin/main'], repoRoot);
  if (local === remote) {
    return { updateAvailable: false, currentVersion: local.slice(0, 7) };
  }
  const commitCount = await run('git', ['rev-list', '--count', `${local}..${remote}`], repoRoot);
  return {
    updateAvailable: true,
    currentVersion: local.slice(0, 7),
    latestVersion: remote.slice(0, 7),
    commitsBehind: Number(commitCount),
  };
}

module.exports.checkForUpdate = checkForUpdate;
```

- [ ] **Step 4: Add the test script and run**

```json
// watchdog/package.json — add under "scripts"
"test": "node --test"
```

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add "watchdog/src/updater.js" "watchdog/tests/updater.test.js" "watchdog/package.json"
git commit -m "feat(aaral): add checkForUpdate to the watchdog updater"
```

---

## Task 8: Watchdog — `applyUpdate` happy path

**Files:**
- Modify: `watchdog/src/updater.js`
- Modify: `watchdog/tests/updater.test.js`

**Interfaces:**
- Consumes: `readLock`, `writeLock`, `clearLock`, `gitAuthArgs` from Task 6
- Produces: `applyUpdate({ repoRoot, run?, restartApps, checkHealth, npmDirs?, migrateDirs?, watchedApps?, healthTimeoutMs?, healthPollMs? }): Promise<{ ok: true, previousCommit, newCommit } | { ok: false, reason, rolledBack, rollbackError }>` — `restartApps(names: string[]): Promise<void>` and `checkHealth(appName: string): Promise<boolean>` are injected so tests never touch real PM2 or HTTP.

- [ ] **Step 1: Write the failing test (happy path only — rollback is Task 9)**

```js
// append to watchdog/tests/updater.test.js
const { applyUpdate, LOCK_FILE } = require('../src/updater');
const fs = require('fs');

test.afterEach(() => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });

test('applyUpdate pulls, installs, migrates, restarts, verifies health, and clears the lock on success', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const commands = [];
  const run = async (cmd, args) => {
    commands.push([cmd, ...args].join(' '));
    if (args.includes('rev-parse')) return 'abc1234567';
    return '';
  };
  const restarted = [];
  const restartApps = async (names) => { restarted.push(...names); };
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, true);
  assert.deepEqual(restarted, ['aaral-dashboard', 'aaral-bridge']);
  assert.ok(commands.some((c) => c.includes('pull origin main')));
  assert.ok(commands.some((c) => c.includes('npm run migrate'))); // confirms migrate actually ran, not just installed
  assert.equal(fs.existsSync(LOCK_FILE), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: FAIL with "applyUpdate is not a function"

- [ ] **Step 3: Implement `applyUpdate` and its health-wait helper (append to `watchdog/src/updater.js`)**

```js
const DEFAULT_NPM_DIRS = ['dashboard', 'whatsapp-bot', 'payment-ledger-core'];
const DEFAULT_MIGRATE_DIRS = ['dashboard', 'whatsapp-bot'];
const DEFAULT_WATCHED_APPS = ['aaral-dashboard', 'aaral-bridge'];

async function waitForHealth(watchedApps, checkHealth, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(watchedApps.map(checkHealth));
    if (results.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function applyUpdate({
  repoRoot,
  run = runCommand,
  restartApps,
  checkHealth,
  npmDirs = DEFAULT_NPM_DIRS,
  migrateDirs = DEFAULT_MIGRATE_DIRS,
  watchedApps = DEFAULT_WATCHED_APPS,
  healthTimeoutMs = 60000,
  healthPollMs = 3000,
}) {
  if (readLock()) {
    return { ok: false, reason: 'update-already-in-progress' };
  }

  const previousCommit = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  writeLock({ previousCommit, step: 'starting', startedAt: new Date().toISOString() });

  try {
    writeLock({ previousCommit, step: 'pulling', startedAt: new Date().toISOString() });
    await run('git', [...gitAuthArgs(), 'pull', 'origin', 'main'], repoRoot);

    writeLock({ previousCommit, step: 'installing', startedAt: new Date().toISOString() });
    for (const dir of npmDirs) {
      await run('npm', ['install', '--omit=dev'], path.join(repoRoot, dir));
    }

    writeLock({ previousCommit, step: 'migrating', startedAt: new Date().toISOString() });
    for (const dir of migrateDirs) {
      await run('npm', ['run', 'migrate'], path.join(repoRoot, dir));
    }

    writeLock({ previousCommit, step: 'restarting', startedAt: new Date().toISOString() });
    await restartApps(watchedApps);

    const healthy = await waitForHealth(watchedApps, checkHealth, healthTimeoutMs, healthPollMs);
    if (!healthy) throw new Error('apps did not report healthy in time');

    const newCommit = await run('git', ['rev-parse', 'HEAD'], repoRoot);
    clearLock();
    return { ok: true, previousCommit, newCommit };
  } catch (err) {
    const rollback = await rollbackTo(previousCommit, {
      repoRoot, run, npmDirs, migrateDirs, restartApps, checkHealth, watchedApps, healthTimeoutMs, healthPollMs,
    });
    clearLock();
    return { ok: false, reason: err.message, rolledBack: rollback.ok, rollbackError: rollback.ok ? null : rollback.reason };
  }
}

module.exports.applyUpdate = applyUpdate;
module.exports.waitForHealth = waitForHealth;
module.exports.DEFAULT_NPM_DIRS = DEFAULT_NPM_DIRS;
module.exports.DEFAULT_MIGRATE_DIRS = DEFAULT_MIGRATE_DIRS;
module.exports.DEFAULT_WATCHED_APPS = DEFAULT_WATCHED_APPS;
```

Note: `rollbackTo` is referenced here but implemented in Task 9 — add a temporary stub in this step (`async function rollbackTo() { return { ok: true }; }` placed above `applyUpdate`) so this task's test passes standalone, then replace the stub's body in Task 9 (do not duplicate the function).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: PASS (3 tests total: 2 from Task 7 + this one)

- [ ] **Step 5: Commit**

```bash
git add "watchdog/src/updater.js" "watchdog/tests/updater.test.js"
git commit -m "feat(aaral): add applyUpdate happy path (pull/install/migrate/restart/health-check)"
```

---

## Task 9: Watchdog — rollback on failure

**Files:**
- Modify: `watchdog/src/updater.js` (replace the Task 8 stub)
- Modify: `watchdog/tests/updater.test.js`

**Interfaces:**
- Produces: `rollbackTo(commit, { repoRoot, run, npmDirs, migrateDirs, restartApps, checkHealth, watchedApps, healthTimeoutMs, healthPollMs }): Promise<{ ok: boolean, reason?: string }>`

- [ ] **Step 1: Write the failing tests**

```js
// append to watchdog/tests/updater.test.js — add this import alongside the
// existing ones at the top of the file (writeLock wasn't needed until now)
const { writeLock } = require('../src/updater');

test('applyUpdate rolls back to the previous commit when migration fails', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  // migrateDirs has 2 entries (dashboard, whatsapp-bot), so the forward
  // attempt's very first migrate call (dashboard) is call #1 — make only
  // that one fail, so rollback's own migrate calls (#2, #3) succeed.
  let migrateCallCount = 0;
  const run = async (cmd, args) => {
    if (args[0] === 'rev-parse') return 'aaa1111111';
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'migrate') {
      migrateCallCount += 1;
      if (migrateCallCount === 1) throw new Error('migration failed: syntax error');
      return '';
    }
    return '';
  };
  const restarted = [];
  const restartApps = async (names) => { restarted.push(names); };
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  // The forward attempt fails on its first migrate call, before it ever
  // reaches the restart step — so restartApps is called exactly once,
  // from inside rollback, not twice.
  assert.equal(restarted.length, 1);
  assert.equal(fs.existsSync(LOCK_FILE), false);
});

test('applyUpdate reports rollbackError when rollback itself fails', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const run = async (cmd, args) => {
    if (args[0] === 'rev-parse') return 'aaa1111111';
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'migrate') throw new Error('migration failed');
    if (args[0] === 'reset') throw new Error('git reset failed: dirty working tree');
    return '';
  };
  const restartApps = async () => {};
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.match(result.rollbackError, /git reset failed/);
});

test('applyUpdate rejects a second call while one is already in progress', async () => {
  writeLock({ previousCommit: 'zzz', step: 'pulling', startedAt: new Date().toISOString() });
  const run = async () => '';
  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true });
  assert.deepEqual(result, { ok: false, reason: 'update-already-in-progress' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: FAIL — the stubbed `rollbackTo` from Task 8 always returns `{ ok: true }`, so the "rollback itself fails" test fails, and the "rolls back to the previous commit" test's `restarted.length` assertion fails (stub never restarts).

- [ ] **Step 3: Replace the Task 8 stub with the real implementation**

```js
async function rollbackTo(commit, { repoRoot, run, npmDirs, migrateDirs, restartApps, checkHealth, watchedApps, healthTimeoutMs, healthPollMs }) {
  try {
    await run('git', ['reset', '--hard', commit], repoRoot);
    for (const dir of npmDirs) {
      await run('npm', ['install', '--omit=dev'], path.join(repoRoot, dir));
    }
    for (const dir of migrateDirs) {
      await run('npm', ['run', 'migrate'], path.join(repoRoot, dir));
    }
    await restartApps(watchedApps);
    const healthy = await waitForHealth(watchedApps, checkHealth, healthTimeoutMs, healthPollMs);
    if (!healthy) return { ok: false, reason: 'apps unhealthy after rollback' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add "watchdog/src/updater.js" "watchdog/tests/updater.test.js"
git commit -m "feat(aaral): add rollback-on-failure and concurrency lock to applyUpdate"
```

---

## Task 10: Watchdog — power-loss recovery on startup

**Files:**
- Modify: `watchdog/src/updater.js`
- Modify: `watchdog/tests/updater.test.js`

**Interfaces:**
- Consumes: `rollbackTo`, `readLock`, `clearLock` (already in this file)
- Produces: `recoverInterruptedUpdate({ repoRoot, run?, restartApps, checkHealth, notifyAdmins }): Promise<void>` — call this once at watchdog boot, before the update HTTP server starts accepting requests (Task 12).

- [ ] **Step 1: Write the failing tests**

```js
// append to watchdog/tests/updater.test.js
const { recoverInterruptedUpdate } = require('../src/updater');

test('recoverInterruptedUpdate does nothing when there is no lock file', async () => {
  const notified = [];
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run: async () => '', restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.equal(notified.length, 0);
});

test('recoverInterruptedUpdate rolls back and alerts when a stale lock is found', async () => {
  writeLock({ previousCommit: 'aaa1111111', step: 'installing', startedAt: new Date().toISOString() });
  const notified = [];
  const run = async () => '';
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.equal(fs.existsSync(LOCK_FILE), false);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /interrupted/i);
  assert.match(notified[0], /auto-recovered/i);
});

test('recoverInterruptedUpdate sends an urgent alert when rollback itself fails', async () => {
  writeLock({ previousCommit: 'aaa1111111', step: 'installing', startedAt: new Date().toISOString() });
  const notified = [];
  const run = async (cmd, args) => { if (args[0] === 'reset') throw new Error('disk full'); return ''; };
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.match(notified[0], /recovery FAILED/i);
  assert.match(notified[0], /disk full/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: FAIL with "recoverInterruptedUpdate is not a function"

- [ ] **Step 3: Implement (append to `watchdog/src/updater.js`)**

```js
async function recoverInterruptedUpdate({ repoRoot, run = runCommand, restartApps, checkHealth, notifyAdmins }) {
  const lock = readLock();
  if (!lock) return;

  const result = await rollbackTo(lock.previousCommit, {
    repoRoot, run,
    npmDirs: DEFAULT_NPM_DIRS, migrateDirs: DEFAULT_MIGRATE_DIRS, watchedApps: DEFAULT_WATCHED_APPS,
    restartApps, checkHealth, healthTimeoutMs: 60000, healthPollMs: 3000,
  });
  clearLock();

  if (result.ok) {
    await notifyAdmins(
      `⚠️ *Aaral update was interrupted* (likely a power loss) while updating past commit ${lock.previousCommit.slice(0, 7)}. Auto-recovered successfully.`
    );
  } else {
    await notifyAdmins(
      `🚨 *Aaral update recovery FAILED* after an interruption — needs manual attention on the office PC. Reason: ${result.reason}`
    );
  }
}

module.exports.recoverInterruptedUpdate = recoverInterruptedUpdate;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "watchdog" && node --test tests/updater.test.js`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add "watchdog/src/updater.js" "watchdog/tests/updater.test.js"
git commit -m "feat(aaral): auto-recover an update interrupted by power loss on watchdog startup"
```

---

## Task 11: Watchdog — local HTTP update server

**Files:**
- Create: `watchdog/src/updateServer.js`

**Interfaces:**
- Consumes: `checkForUpdate`, `applyUpdate` from `watchdog/src/updater.js`
- Produces: `startUpdateServer({ restartApps, checkHealth, notifyAdmins }): http.Server`, listening on `127.0.0.1:${UPDATE_SERVICE_PORT}` (default `5003`), exposing `GET /update/check`, `GET /update/status`, `POST /update/apply`.

- [ ] **Step 1: Implementation (mirrors the existing raw-http style already used in `whatsapp-bot/src/whatsapp/bot.js`'s notify server — no Express dependency needed here)**

```js
// watchdog/src/updateServer.js
'use strict';
const http = require('http');
const path = require('path');
const updater = require('./updater');

const UPDATE_SERVICE_PORT = process.env.UPDATE_SERVICE_PORT || 5003;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let currentStatus = { state: 'idle' };

function startUpdateServer({ restartApps, checkHealth, notifyAdmins }) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/update/check') {
      updater.checkForUpdate({ repoRoot: REPO_ROOT })
        .then((result) => { res.writeHead(200); res.end(JSON.stringify(result)); })
        .catch((err) => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
      return;
    }

    if (req.method === 'GET' && req.url === '/update/status') {
      res.writeHead(200);
      res.end(JSON.stringify(currentStatus));
      return;
    }

    if (req.method === 'POST' && req.url === '/update/apply') {
      if (currentStatus.state === 'running') {
        res.writeHead(409);
        res.end(JSON.stringify({ ok: false, reason: 'update-already-in-progress' }));
        return;
      }
      currentStatus = { state: 'running', startedAt: new Date().toISOString() };
      res.writeHead(202);
      res.end(JSON.stringify({ ok: true, started: true }));

      updater.applyUpdate({ repoRoot: REPO_ROOT, restartApps, checkHealth })
        .then((result) => {
          currentStatus = { state: result.ok ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), result };
          if (result.ok) {
            notifyAdmins(`✅ *Aaral updated* to commit ${result.newCommit.slice(0, 7)}.`);
          } else if (result.rolledBack) {
            notifyAdmins(`⚠️ *Aaral update failed* (${result.reason}) — rolled back to the previous version successfully.`);
          } else {
            notifyAdmins(`🚨 *Aaral update failed AND rollback failed* — needs manual attention on the office PC. Reason: ${result.rollbackError}`);
          }
        })
        .catch((err) => {
          currentStatus = { state: 'failed', finishedAt: new Date().toISOString(), result: { ok: false, reason: err.message } };
        });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (err) => {
    console.error('[UpdateServer] Failed to start:', err.message);
  });
  server.listen(UPDATE_SERVICE_PORT, '127.0.0.1', () => {
    console.log(`[UpdateServer] Listening on 127.0.0.1:${UPDATE_SERVICE_PORT}`);
  });
  return server;
}

module.exports = { startUpdateServer };
```

- [ ] **Step 2: Manual verification**

Start watchdog locally with a real (throwaway) git clone as `REPO_ROOT` and a valid `GITHUB_PAT`; `curl http://127.0.0.1:5003/update/check` and confirm a real JSON response reflecting that repo's actual state.

- [ ] **Step 3: Commit**

```bash
git add "watchdog/src/updateServer.js"
git commit -m "feat(aaral): add watchdog's local-only update HTTP server"
```

---

## Task 12: Wire the updater into `watchdog.js`

**Files:**
- Modify: `watchdog/watchdog.js`
- Modify: `watchdog/.env.example`
- Modify: `watchdog/.env.production`

**Interfaces:**
- Consumes: `startUpdateServer` (Task 11), `recoverInterruptedUpdate` (Task 10), the existing `pm2` connection and `notifyAdmins` already in this file.

- [ ] **Step 1: Add the env vars**

```
# append to both watchdog/.env.example and watchdog/.env.production
GITHUB_PAT=
UPDATE_SERVICE_PORT=5003
DASHBOARD_HEALTH_URL=http://127.0.0.1:3400/health
BRIDGE_HEALTH_URL=http://127.0.0.1:5002/health
```

(`.env.production`'s `GITHUB_PAT` stays blank in the template — filled in by hand on-site during deploy, same convention as `DB_PASSWORD` in the existing dashboard/whatsapp-bot templates.)

- [ ] **Step 2: Add `restartApps`, `checkHealth`, and the startup wiring to `watchdog.js`**

Insert near the top, after the existing `const WATCHED_APPS = ...` line:

```js
const { startUpdateServer } = require('./src/updateServer');
const { recoverInterruptedUpdate } = require('./src/updater');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HEALTH_URLS = {
  'aaral-dashboard': process.env.DASHBOARD_HEALTH_URL || 'http://127.0.0.1:3400/health',
  'aaral-bridge': process.env.BRIDGE_HEALTH_URL || 'http://127.0.0.1:5002/health',
};

function restartApps(names) {
  return Promise.all(names.map((name) => new Promise((resolve, reject) => {
    pm2.restart(name, (err) => (err ? reject(err) : resolve()));
  })));
}

async function checkHealth(appName) {
  try {
    const res = await fetch(HEALTH_URLS[appName], { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}
```

Replace the existing `pm2.connect(err => { ... })` block's body to also run recovery and start the update server once connected:

```js
pm2.connect(err => {
  if (err) {
    console.error('[Watchdog] Could not connect to local PM2 daemon:', err.message);
    process.exit(1);
  }

  pm2.launchBus((err, bus) => {
    if (err) {
      console.error('[Watchdog] Could not attach to PM2 bus:', err.message);
      return;
    }
    bus.on('process:event', packet => {
      if (packet.event !== 'restart') return;
      const name = packet.process?.name;
      if (!WATCHED_APPS.includes(name)) return;
      restartLog[name] = restartLog[name] || [];
      restartLog[name].push(Date.now());
      if (!alertState[name]) alertState[name] = { alerted: false, lastAlertedAt: 0 };
      alertState[name].lastRestartAt = Date.now();
    });
    console.log('[Watchdog] Attached to PM2 bus, watching:', WATCHED_APPS.join(', '));
  });

  recoverInterruptedUpdate({ repoRoot: REPO_ROOT, restartApps, checkHealth, notifyAdmins })
    .then(() => {
      startUpdateServer({ restartApps, checkHealth, notifyAdmins });
    })
    .catch((recoveryErr) => {
      console.error('[Watchdog] Interrupted-update recovery threw unexpectedly:', recoveryErr.message);
      startUpdateServer({ restartApps, checkHealth, notifyAdmins });
    });
});
```

- [ ] **Step 3: Manual verification**

Restart `aaral-watchdog` locally via `pm2 restart aaral-watchdog`; confirm the log shows `[UpdateServer] Listening on 127.0.0.1:5003` and, with no stale lock file present, no recovery-alert WhatsApp message fires.

- [ ] **Step 4: Commit**

```bash
git add "watchdog/watchdog.js" "watchdog/.env.example" "watchdog/.env.production"
git commit -m "feat(aaral): wire update recovery and the local update server into watchdog startup"
```

---

## Task 13: Dashboard — proxy routes to watchdog

**Files:**
- Create: `dashboard/src/routes/updates.js`
- Modify: `dashboard/server.js`
- Modify: `dashboard/.env.production` (add `WATCHDOG_URL`)

**Interfaces:**
- Consumes: `requirePin` (Task 1), watchdog's `/update/check`, `/update/status`, `/update/apply` (Task 11)
- Produces: `GET /api/updates/check`, `GET /api/updates/status`, `POST /api/updates/apply` (PIN-gated)

- [ ] **Step 1: Implementation**

```js
// dashboard/src/routes/updates.js
'use strict';
const express = require('express');
const { requirePin } = require('../adminAuth');

const router = express.Router();
const WATCHDOG_URL = process.env.WATCHDOG_URL || 'http://127.0.0.1:5003';

router.get('/updates/check', async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/check`, { signal: AbortSignal.timeout(15000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

router.get('/updates/status', async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/status`, { signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

router.post('/updates/apply', requirePin, async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/apply`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

module.exports = router;
```

- [ ] **Step 2: Wire it in `dashboard/server.js`**

```js
app.use('/api', require('./src/routes/invoices'));
app.use('/api', require('./src/routes/ledger'));
app.use('/api', require('./src/routes/quotations'));
app.use('/api', require('./src/routes/payments'));
app.use('/api', require('./src/routes/updates'));
```

- [ ] **Step 3: Add the env var**

```
# append to dashboard/.env.production
WATCHDOG_URL=http://127.0.0.1:5003
```

- [ ] **Step 4: Manual verification**

With watchdog running locally, `curl http://localhost:3400/api/updates/check` and confirm it returns the same JSON watchdog's own `/update/check` returned in Task 11's verification.

- [ ] **Step 5: Commit**

```bash
git add "dashboard/src/routes/updates.js" "dashboard/server.js" "dashboard/.env.production"
git commit -m "feat(aaral): add dashboard proxy routes for update check/apply/status"
```

---

## Task 14: Dashboard — Updates panel UI

**Files:**
- Create: `dashboard/public/updates.html`

**Interfaces:**
- Consumes: `GET /api/updates/check`, `GET /api/updates/status`, `POST /api/updates/apply` (Task 13)

- [ ] **Step 1: Implementation**

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Updates — Aaral Marketing</title>
<link rel="icon" href="/assets/aaral-logo-small.png">
<link rel="stylesheet" href="/styles.css">
<style>
  .updates-card { padding: 1.8rem; max-width: 560px; margin: 0 auto; }
  .updates-status { font-size: 0.95rem; color: var(--ink-muted); margin: 1rem 0; }
  .updates-status.ok { color: var(--moss); }
  .updates-status.err { color: var(--rust); }
</style>
</head>
<body>

<div class="hero">
  <div class="hero-inner">
    <div class="hero-top">
      <div class="brand-mark">
        <img src="/assets/aaral-logo-header.png" alt="Aaral Marketing">
        <div class="brand-text">
          <h1>Aaral Marketing</h1>
          <p>Cement &amp; Building Materials Ledger</p>
        </div>
      </div>
      <nav class="hero-nav">
        <a href="/">Customers</a>
        <a href="/quotation.html">New Quotation</a>
        <a href="/chitti.html">New Chitti</a>
        <a href="/payment.html">New Payment</a>
        <a class="active" href="/updates.html">Updates</a>
      </nav>
    </div>
  </div>
  <svg class="hero-wave" viewBox="0 0 1440 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,50 C240,90 480,10 720,50 C960,90 1200,10 1440,50 L1440,100 L0,100 Z" fill="#00aeef" opacity="0.22"/>
    <path d="M0,65 C240,35 480,95 720,65 C960,35 1200,95 1440,65 L1440,100 L0,100 Z" fill="#7fd8f7" opacity="0.3"/>
    <path d="M0,80 C240,60 480,100 720,80 C960,60 1200,100 1440,80 L1440,100 L0,100 Z" fill="#ece7dc" opacity="1"/>
  </svg>
</div>

<div class="page">
  <div class="card updates-card">
    <h3>Software updates</h3>
    <div id="updatesStatus" class="updates-status">Checking…</div>
    <button class="btn-primary" id="checkBtn" type="button">Check for Updates</button>
    <button class="btn-primary" id="applyBtn" type="button" style="display:none; margin-left:0.6rem;">Update Now</button>
  </div>
</div>

<div class="modal-backdrop" id="pinModal">
  <div class="modal-box">
    <h3>Admin PIN required</h3>
    <div class="field-group">
      <label>PIN</label>
      <input type="password" id="pinInput" inputmode="numeric" autocomplete="off">
    </div>
    <div id="pinError" style="color:var(--rust); font-size:0.85rem; margin-bottom:0.4rem;"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="cancelPin" type="button">Cancel</button>
      <button class="btn-primary" id="confirmPin" type="button">Confirm</button>
    </div>
  </div>
</div>

<script>
const statusEl = document.getElementById('updatesStatus');
const checkBtn = document.getElementById('checkBtn');
const applyBtn = document.getElementById('applyBtn');
const pinModal = document.getElementById('pinModal');
const pinInput = document.getElementById('pinInput');
const pinError = document.getElementById('pinError');
let pollTimer = null;

async function check() {
  statusEl.className = 'updates-status';
  statusEl.textContent = 'Checking…';
  applyBtn.style.display = 'none';
  try {
    const res = await fetch('/api/updates/check');
    const data = await res.json();
    if (data.updateAvailable) {
      statusEl.textContent = `Update available: v${data.latestVersion} (${data.commitsBehind} change${data.commitsBehind === 1 ? '' : 's'} behind current v${data.currentVersion}).`;
      applyBtn.style.display = 'inline-block';
    } else {
      statusEl.className = 'updates-status ok';
      statusEl.textContent = `Up to date (v${data.currentVersion}).`;
    }
  } catch (err) {
    statusEl.className = 'updates-status err';
    statusEl.textContent = 'Could not reach the update service.';
  }
}

function openPinModal() {
  pinInput.value = '';
  pinError.textContent = '';
  pinModal.classList.add('open');
  pinInput.focus();
}
function closePinModal() { pinModal.classList.remove('open'); }

checkBtn.addEventListener('click', check);
applyBtn.addEventListener('click', openPinModal);
document.getElementById('cancelPin').addEventListener('click', closePinModal);
pinModal.addEventListener('click', (e) => { if (e.target === pinModal) closePinModal(); });

document.getElementById('confirmPin').addEventListener('click', async () => {
  const res = await fetch('/api/updates/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pinInput.value }),
  });
  const data = await res.json();
  if (res.status === 401) {
    pinError.textContent = 'Incorrect PIN.';
    return;
  }
  closePinModal();
  applyBtn.style.display = 'none';
  statusEl.className = 'updates-status';
  statusEl.textContent = 'Update started — this can take a couple of minutes. Do not close this page.';
  pollTimer = setInterval(poll, 3000);
});

async function poll() {
  const res = await fetch('/api/updates/status');
  const data = await res.json();
  if (data.state === 'running') return;
  clearInterval(pollTimer);
  if (data.state === 'succeeded') {
    statusEl.className = 'updates-status ok';
    statusEl.textContent = `Updated successfully to v${data.result.newCommit.slice(0, 7)}.`;
  } else if (data.state === 'failed') {
    statusEl.className = 'updates-status err';
    statusEl.textContent = data.result.rolledBack
      ? `Update failed and was rolled back safely (${data.result.reason}).`
      : `Update failed and rollback also failed (${data.result.rollbackError}) — this needs Vansh to remote in.`;
  }
}

check();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

Open `/updates.html`, confirm "Checking…" resolves to either "Up to date" or "Update available," and that Update Now correctly prompts for PIN, rejects a wrong one, and (with the right one) shows the polling message.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/public/updates.html"
git commit -m "feat(aaral): add the Updates panel UI"
```

---

## Task 15: Add "Updates" to the nav on every existing page

**Files:**
- Modify: `dashboard/public/index.html`
- Modify: `dashboard/public/customer.html`
- Modify: `dashboard/public/quotation.html`
- Modify: `dashboard/public/chitti.html`
- Modify: `dashboard/public/payment.html`
- Modify: `dashboard/public/invoice.html`
- Modify: `dashboard/public/receipt.html`

**Interfaces:**
- None — pure navigation markup.

- [ ] **Step 1: Add one line to each page's `hero-nav`, immediately after the existing "New Payment" link**

`index.html` (after line 38):
```html
        <a href="/payment.html">New Payment</a>
        <a href="/updates.html">Updates</a>
```

`customer.html` (after line 47), `quotation.html` (after line 39), `invoice.html` (after line 25), `payment.html` (after line 49 — this one's own "New Payment" link keeps its `class="active"`), `chitti.html` (after line 86), `receipt.html` (after line 41) — same single line added in each:
```html
        <a href="/updates.html">Updates</a>
```

- [ ] **Step 2: Manual verification**

Load each of the 7 pages and confirm an "Updates" link appears in the nav and goes to `/updates.html`.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/public/index.html" "dashboard/public/customer.html" "dashboard/public/quotation.html" \
        "dashboard/public/chitti.html" "dashboard/public/payment.html" "dashboard/public/invoice.html" "dashboard/public/receipt.html"
git commit -m "feat(aaral): add Updates link to the dashboard nav on every page"
```

---

## Task 16: PWA — generate icons and write the manifest

**Files:**
- Create: `dashboard/scripts/generate-pwa-icons.js`
- Modify: `dashboard/package.json` (add `sharp` devDependency)
- Create: `dashboard/public/manifest.json`
- Create (generated, then committed): `dashboard/public/assets/aaral-icon-180.png`, `dashboard/public/assets/aaral-icon-512.png`

**Interfaces:**
- Produces: two square icon PNGs on a solid navy background (the source logo has a transparent background, which iOS renders poorly as a home-screen icon without a solid fill behind it) and the manifest file referencing them.

- [ ] **Step 1: Add the dependency**

```json
// dashboard/package.json — add under "devDependencies" (create the key if absent)
"devDependencies": {
  "sharp": "^0.33.5"
}
```

Run: `cd "dashboard" && npm install`

- [ ] **Step 2: Write the generator script**

```js
// dashboard/scripts/generate-pwa-icons.js
'use strict';
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'aaral-logo-master.png');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets');
const BACKGROUND = '#191048'; // matches --navy in styles.css

async function makeIcon(size, filename) {
  const logo = await sharp(SRC)
    .resize(Math.round(size * 0.72), Math.round(size * 0.72), { fit: 'inside' })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT_DIR, filename));
  console.log(`Wrote ${filename}`);
}

(async () => {
  await makeIcon(180, 'aaral-icon-180.png');
  await makeIcon(512, 'aaral-icon-512.png');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add to `dashboard/package.json` `scripts`: `"generate-pwa-icons": "node scripts/generate-pwa-icons.js"`.

- [ ] **Step 3: Run it and inspect the output**

Run: `cd "dashboard" && npm run generate-pwa-icons`
Expected: two new files under `public/assets/`; open both and confirm the logo is centered on a solid navy square, not transparent.

- [ ] **Step 4: Write the manifest**

```json
// dashboard/public/manifest.json
{
  "name": "Aaral Marketing",
  "short_name": "Aaral",
  "description": "Cement & Building Materials Ledger",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ece7dc",
  "theme_color": "#191048",
  "icons": [
    { "src": "/assets/aaral-icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "/assets/aaral-icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add "dashboard/scripts/generate-pwa-icons.js" "dashboard/package.json" "dashboard/public/manifest.json" \
        "dashboard/public/assets/aaral-icon-180.png" "dashboard/public/assets/aaral-icon-512.png"
git commit -m "feat(aaral): generate PWA icons and add manifest.json"
```

---

## Task 17: PWA — Apple meta tags + manifest link + guarded service-worker registration on every page

**Files:**
- Modify: `dashboard/public/index.html`
- Modify: `dashboard/public/customer.html`
- Modify: `dashboard/public/quotation.html`
- Modify: `dashboard/public/chitti.html`
- Modify: `dashboard/public/payment.html`
- Modify: `dashboard/public/invoice.html`
- Modify: `dashboard/public/receipt.html`
- Modify: `dashboard/public/updates.html`

**Interfaces:**
- Consumes: `dashboard/public/manifest.json` (Task 16), `dashboard/public/sw.js` (Task 18)

- [ ] **Step 1: Add these 6 lines to every page's `<head>`, immediately after the existing `<link rel="icon" ...>` line**

```html
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Aaral Marketing">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#191048">
<link rel="apple-touch-icon" href="/assets/aaral-icon-180.png">
```

(`updates.html` already has this from how it was written in Task 14 if that task is done after this one — since Task 14 came first in this plan, add these 6 lines to `updates.html` too, in the same place.)

- [ ] **Step 2: Add the guarded service-worker registration to every page, immediately before the closing `</body>` tag**

```html
<script>
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
</script>
```

This is deliberately guarded on `window.isSecureContext` — the current deploy plan serves the dashboard over plain `http://` (LAN and Tailscale both), which is not a secure context, so the service worker will simply never register there and this silently no-ops. **The iPhone install path does not depend on the service worker at all** — it works from the manifest + Apple meta tags added in Step 1, which iOS honors over plain HTTP. The service worker only matters if this is ever served over HTTPS later (e.g. via `tailscale cert`), which is out of scope for this plan.

- [ ] **Step 3: Manual verification**

On each page, view source and confirm the manifest link, Apple meta tags, and touch icon are present; open DevTools console and confirm no service-worker registration error appears (it should simply not attempt registration over `http://`).

- [ ] **Step 4: Commit**

```bash
git add "dashboard/public/index.html" "dashboard/public/customer.html" "dashboard/public/quotation.html" \
        "dashboard/public/chitti.html" "dashboard/public/payment.html" "dashboard/public/invoice.html" \
        "dashboard/public/receipt.html" "dashboard/public/updates.html"
git commit -m "feat(aaral): add PWA manifest link, Apple meta tags, and guarded SW registration to all pages"
```

---

## Task 18: PWA — minimal static-assets-only service worker

**Files:**
- Create: `dashboard/public/sw.js`

**Interfaces:**
- None — this file is fetched directly by the browser via the registration added in Task 17.

- [ ] **Step 1: Implementation**

```js
// dashboard/public/sw.js
const CACHE_NAME = 'aaral-static-v1';
const STATIC_PATHS = ['/styles.css', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStaticAsset = url.pathname === '/styles.css'
    || url.pathname === '/manifest.json'
    || url.pathname.startsWith('/assets/');
  if (!isStaticAsset) return; // never intercept HTML pages or /api/* — ledger data must always be live

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
```

- [ ] **Step 2: Manual verification**

Serve the dashboard over `https://localhost:3400` (a temporary local self-signed setup, or `http://localhost` which counts as a secure context) — confirm in DevTools → Application → Service Workers that `sw.js` registers, and DevTools → Network confirms `/api/customers` calls are never served `(from ServiceWorker)`.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/public/sw.js"
git commit -m "feat(aaral): add minimal static-assets-only service worker"
```

---

## Pre-go-live checklist (do this on the real office PC, not before)

- [ ] Run `node scripts/set-admin-pin.js <real PIN>` in `dashboard/` with a PIN only Vansh and the owner know
- [ ] Fill in the real `GITHUB_PAT` in `watchdog/.env` (fine-grained, read-only, scoped only to `aaral-marketing-deploy`)
- [ ] Run `./deploy/sync-to-deploy-repo.sh v1.0.0` once to seed the deploy repo before the office PC's first `git clone`
- [ ] Add a `git clone` step for `aaral-marketing-deploy` into `deploy/windows-server-setup.ps1`'s existing setup sequence, in place of copying the folder tree by hand
- [ ] Interrupt an update by killing power mid-`npm install` on a test box — confirm auto-recovery on reboot
- [ ] Trigger Update from two browser tabs at once — confirm the second is rejected
- [ ] Watch the physical screen through a full update cycle — confirm zero visible windows
- [ ] Install the PWA on the client's actual iPhone over Tailscale, off the office wifi — confirm standalone launch and live data
