require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const cron = require('node-cron');
const { logger } = require('../utils/logger');
const { createConnection } = require('./connection');
const { createHealthMonitor } = require('./healthMonitor');
const { isFatalSessionError, withTimeout } = require('./sessionErrors');
const { clearSessionCache } = require('./sessionCacheClean');
const { query } = require('payment-ledger-core/db');
const customers = require('payment-ledger-core/ledger/customers');
const claims = require('payment-ledger-core/ledger/claims');
const balances = require('payment-ledger-core/ledger/balances');
const duesImport = require('payment-ledger-core/imports/duesImport');
const flows = require('./flows');

const SESSION_DIR = process.env.WA_SESSION_PATH || './wa-sessions';
const PROOFS_DIR = process.env.PROOFS_PATH || './proofs';
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

// Guard against whatsapp-web.js replaying old chat history as 'message' events
// on (re)connect — without this, linking a session with pre-existing chats
// fires the handler for real messages that predate the bot entirely, causing
// it to "welcome" people who never messaged it. msg.timestamp is Unix seconds.
// Fail CLOSED: a message with no timestamp at all is treated as historical,
// not live — confirmed in testing that some replayed messages carry no
// timestamp, which let them slip past a fail-open version of this check.
const BOT_START_TIME = Math.floor(Date.now() / 1000);

// Extra safety net for testing: when set, ONLY these numbers (plus seeded
// admins) can trigger any reply at all — everyone else is silently ignored.
// Set TEST_MODE_ALLOWED_NUMBERS in .env (comma-separated, any format) while
// testing on a personal/real number. Leave unset in production so real
// customers aren't blocked.
const TEST_MODE_ALLOWED_NUMBERS = (process.env.TEST_MODE_ALLOWED_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/\D/g, '').slice(-10))
  .filter(Boolean);

// ── OCR Service (Python/PaddleOCR) ────────────────────────────
// A small local Python worker (ocr-service/) runs PaddleOCR, which reads
// the ₹ symbol correctly — Tesseract cannot (confirmed live: it always
// misreads ₹ as a phantom leading digit fused onto the amount, e.g.
// ₹3,500 → "23,500", regardless of character whitelisting, image
// upscaling, or Tesseract's own official "best" quality model). Node
// spawns this worker once at startup and talks to it over localhost
// HTTP; screenshots skip OCR entirely if it never comes up, same
// graceful-degradation philosophy as any other OCR failure.
const OCR_SERVICE_PORT = process.env.OCR_SERVICE_PORT || 5001;
const OCR_SERVICE_URL = `http://127.0.0.1:${OCR_SERVICE_PORT}`;
const OCR_SERVICE_DIR = path.join(__dirname, '..', '..', 'ocr-service');

// ── Notify service (internal, for the dashboard) ────────────────
// A minimal localhost-only HTTP server so the Aaral dashboard (a separate
// process) can ask this bot to send a WhatsApp message, without ever
// touching the WhatsApp session itself. Only this process may own that
// session — see the shutdown-handling history in CoKarma's design docs
// for why introducing a second owner of client is not something to risk.
const http = require('http');
const NOTIFY_SERVICE_PORT = process.env.NOTIFY_SERVICE_PORT || 5002;
let notifyServerStarted = false;

// Bumped whenever the request/response shape between this service and the
// dashboard changes. The dashboard compares it against its own copy, so a
// half-finished deploy (one app updated, the other not) announces itself as a
// version mismatch instead of presenting as a mysterious runtime bug.
const WA_CONTRACT = 1;
const WA_SEND_TIMEOUT_MS = 90000;

// Every await below talks to a Chrome that may already be half-dead. Without a
// deadline a stalled page never rejects, the HTTP request never responds, and
// the dashboard's Send button spins forever with no error anywhere — which is
// indistinguishable from "the service is down".
async function sendWhatsApp(chatId, payload, caption) {
  const c = client;
  if (!c) throw new Error('session closed: WhatsApp client is not available');
  return withTimeout(
    caption ? c.sendMessage(chatId, payload, { caption }) : c.sendMessage(chatId, payload),
    WA_SEND_TIMEOUT_MS,
    'WhatsApp send'
  );
}

function startNotifyServer() {
  // Guard against binding twice — this is now called once at boot rather than
  // from client.on('ready'), but keep the guard so a stray call is harmless.
  if (notifyServerStarted) return;
  notifyServerStarted = true;

  const server = http.createServer((req, res) => {
    // Per-request logging. Its absence is exactly why the equivalent failure on
    // the SMSA deployment needed an on-site visit to diagnose: an unchanging
    // log is NOT evidence that a request never arrived, but with no per-request
    // line there was no way to tell the two apart from the logs alone.
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(`[Notify] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
    });

    if (req.method === 'GET' && req.url === '/health') {
      // Deliberately 200 whenever the PROCESS is alive, with the WhatsApp state
      // reported in the body rather than encoded in the status code.
      //
      // The watchdog treats a non-200 as "restart this app", and the updater
      // treats it as "roll the deploy back". Both of those are wrong responses
      // to "WhatsApp is reconnecting" — restarting mid-reconnect is actively
      // harmful, and it previously caused good deploys to be rolled back
      // (which is why the health timeout had to be stretched to 210s).
      // Anything that cares about WhatsApp specifically reads .wa.state.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        contract: WA_CONTRACT,
        uptimeSec: Math.floor(process.uptime()),
        wa: connection ? connection.getStatus() : { state: 'starting', number: null, lastError: null, recovering: false },
      }));
      return;
    }

    // Read-only status for the dashboard's WhatsApp panel.
    if (req.method === 'GET' && req.url === '/wa/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        contract: WA_CONTRACT,
        ...(connection ? connection.getStatus() : { state: 'starting' }),
      }));
      return;
    }

    // The pairing QR as a data URL, so staff can re-link the phone from the
    // dashboard instead of someone reading a terminal over remote desktop.
    if (req.method === 'GET' && req.url === '/wa/qr') {
      const qr = connection ? connection.getQr() : null;
      if (!qr) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'no QR pending', state: connection ? connection.getStatus().state : 'starting' }));
        return;
      }
      qrToDataUrl(qr)
        .then((dataUrl) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, dataUrl }));
        })
        .catch((e) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: e.message }));
        });
      return;
    }

    if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }

    // Repair (keeps the pairing, no phone needed) and Re-pair (purges
    // credentials, needs a QR scan). Offered in that order in the UI so the
    // destructive one is never the first thing anybody reaches for.
    if (req.url === '/wa/recover' || req.url === '/wa/reset') {
      const isReset = req.url === '/wa/reset';
      if (!connection) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'connection not initialised yet' }));
        return;
      }
      (isReset ? connection.reset() : connection.recover('requested from dashboard'))
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...result, ...connection.getStatus() }));
        })
        .catch((e) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        });
      return;
    }

    if (req.url !== '/notify' && req.url !== '/notify-admins') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        if (req.url === '/notify-admins') {
          // Used by watchdog/ (a separate PM2 process on this same machine)
          // to push an ops alert (e.g. a crash-loop) straight to whoever is
          // in the `admins` table — no customer phone number involved.
          const { message } = JSON.parse(body);
          if (!message) {
            res.writeHead(400);
            res.end(JSON.stringify({ sent: false, reason: 'message is required' }));
            return;
          }
          await notifyAdmins(message);
          res.writeHead(200);
          res.end(JSON.stringify({ sent: true }));
          return;
        }

        const { phone, message, pdfBase64, filename } = JSON.parse(body);
        if (!phone || !message) {
          res.writeHead(400);
          res.end(JSON.stringify({ sent: false, reason: 'phone and message are required' }));
          return;
        }
        const chatId = flows.toWhatsAppChatId(phone);
        if (pdfBase64) {
          const media = new MessageMedia('application/pdf', pdfBase64, filename || 'invoice.pdf');
          await sendWhatsApp(chatId, media, message);
        } else {
          await sendWhatsApp(chatId, message);
        }
        res.writeHead(200);
        res.end(JSON.stringify({ sent: true }));
      } catch (e) {
        // A dead-session error used to be returned as a string and then
        // forgotten, leaving the bot permanently "connected" while every
        // subsequent send failed identically until someone restarted it by
        // hand. Now it triggers a background rebuild, so the retry the user is
        // about to attempt anyway stands a real chance of working.
        const recovering = connection ? connection.noteSendFailure(e.message) : false;
        logger.error('[Notify] SEND FAILED', { error: e.message, recovering });
        res.writeHead(200);
        res.end(JSON.stringify({ sent: false, reason: e.message, recovering }));
      }
    });
  });
  server.on('error', (err) => {
    // A failure here (e.g. port already in use) must never take down the
    // WhatsApp bot itself — the dashboard's notify calls just get "failed
    // to reach bot" and degrade gracefully, same as an OCR outage.
    logger.error('[Notify] Server failed to start', { error: err.message, port: NOTIFY_SERVICE_PORT });
  });
  server.listen(NOTIFY_SERVICE_PORT, '127.0.0.1', () => {
    logger.info(`[Notify] Listening on 127.0.0.1:${NOTIFY_SERVICE_PORT} (contract ${WA_CONTRACT})`);
  });
}
const OCR_VENV_PYTHON = process.platform === 'win32'
  ? path.join(OCR_SERVICE_DIR, 'venv', 'Scripts', 'python.exe')
  : path.join(OCR_SERVICE_DIR, 'venv', 'bin', 'python');
const OCR_SERVER_SCRIPT = path.join(OCR_SERVICE_DIR, 'server.py');

let ocrServiceProcess = null;

function startOcrService() {
  if (!fs.existsSync(OCR_VENV_PYTHON)) {
    logger.warn('[OCR] venv not found, skipping OCR service startup — see ocr-service/README.md', { expected: OCR_VENV_PYTHON });
    return;
  }
  ocrServiceProcess = spawn(OCR_VENV_PYTHON, [OCR_SERVER_SCRIPT], {
    env: { ...process.env, OCR_SERVICE_PORT: String(OCR_SERVICE_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ocrServiceProcess.stdout.on('data', (d) => logger.info(`[OCR] ${d.toString().trim()}`));
  ocrServiceProcess.stderr.on('data', (d) => logger.warn(`[OCR] ${d.toString().trim()}`));
  ocrServiceProcess.on('exit', (code) => {
    logger.warn('[OCR] Python OCR service exited', { code });
    ocrServiceProcess = null;
  });
}

async function waitForOcrService(timeoutMs = 30000, intervalMs = 500) {
  if (!ocrServiceProcess) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OCR_SERVICE_URL}/health`);
      if (res.ok) {
        logger.info('[OCR] Python OCR service ready');
        return;
      }
    } catch (e) {
      // Not up yet — keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  logger.warn('[OCR] Python OCR service did not become ready in time — screenshots will skip OCR this session');
}

function stopOcrService() {
  return new Promise((resolve) => {
    if (!ocrServiceProcess) { resolve(); return; }
    const proc = ocrServiceProcess;
    const forceKillTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) { /* already dead */ }
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

function stopOcrServiceSync() {
  if (ocrServiceProcess) {
    try { ocrServiceProcess.kill('SIGTERM'); } catch (e) { /* already dead */ }
  }
}

// ── Chrome Cleanup ─────────────────────────────────────────────
// Kills orphaned Chrome and wipes stale Singleton/lock files that make the
// next launch hang forever. Same fix as the Jalan Group bot — must run at
// both STARTUP and EXIT.
function chromeCleanup() {
  const sessionDir = path.resolve(SESSION_DIR, 'session');
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore', shell: true, timeout: 10000 }); } catch (_) {}
    try {
      if (fs.existsSync(sessionDir)) {
        for (const f of fs.readdirSync(sessionDir)) {
          if (f.startsWith('Singleton') || f === 'DevToolsActivePort') {
            try { fs.unlinkSync(path.join(sessionDir, f)); } catch (_) {}
          }
        }
      }
      const lock = path.join(sessionDir, 'Default', 'LOCK');
      if (fs.existsSync(lock)) try { fs.unlinkSync(lock); } catch (_) {}
    } catch (_) {}
  } else {
    try { execSync('pkill -9 -f "wa-sessions" 2>/dev/null || true', { stdio: 'ignore' }); } catch (_) {}
    try {
      execSync(
        `find "${sessionDir}" -maxdepth 1 \\( -name "Singleton*" -o -name "DevToolsActivePort" \\) -delete 2>/dev/null || true`,
        { stdio: 'ignore' }
      );
      execSync(`rm -f "${path.join(sessionDir, 'Default', 'LOCK')}" 2>/dev/null || true`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

if (require.main === module) {
  chromeCleanup();
  startOcrService();
  process.on('exit', () => { chromeCleanup(); stopOcrServiceSync(); });
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); stopOcrService().then(() => process.exit(0)); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); stopOcrService().then(() => process.exit(0)); });
  process.on('SIGHUP', () => { logger.info('[WhatsApp] SIGHUP — clean exit'); stopOcrService().then(() => process.exit(0)); });
  process.on('SIGQUIT', () => { logger.info('[WhatsApp] SIGQUIT — clean exit'); stopOcrService().then(() => process.exit(0)); });
}

// ── Session lock ────────────────────────────────────────────────
// Two whatsapp-web.js clients on one LocalAuth session is not a benign local
// race — it has caused a real WhatsApp-side forced LOGOUT on a previous
// project. This bot previously had no lock at all: "PM2 is the only launcher"
// was the entire safety story, so one manual `node src/whatsapp/bot.js` while
// PM2 had it running was enough to put the client's number at risk.
const LOCK_PATH = path.join(SESSION_DIR, '.bot.lock');
const BACKOFF_STATE_FILE = path.join(SESSION_DIR, '.reconnect-backoff.json');
const SESSION_PROFILE_DIR = path.resolve(SESSION_DIR, 'session');

// Renders the pairing QR for the dashboard panel, so staff can re-link the
// phone themselves instead of someone reading a terminal over remote desktop.
// Loaded lazily so a missing optional dependency degrades to "no QR in the
// dashboard" rather than preventing the bot from starting at all.
async function qrToDataUrl(qr) {
  const qrcode = require('qrcode');
  return qrcode.toDataURL(qr, { margin: 1, width: 320 });
}

// Removes stored credentials so the next start issues a fresh QR. The scripted
// equivalent of the manual "rename the session dir and restart" recovery that
// previously required a remote-desktop session.
function purgeSession(profileDir) {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

// ── Bot State ──────────────────────────────────────────────────
const pendingConfirmations = new Map();
const clearPending = (waNumber) => pendingConfirmations.delete(waNumber);
const setPending = (waNumber, type, data) => {
  pendingConfirmations.set(waNumber, { type, data, expiry: Date.now() + 10 * 60 * 1000 });
};

// Never assume a system-installed Chrome exists at some hardcoded path —
// confirmed live on the Aaral office PC that a fresh Windows box has no
// such thing, only whatever Chrome `npm install` itself downloaded via the
// top-level puppeteer dependency. Deliberately NOT using
// require('puppeteer').executablePath() here — confirmed live that pulling
// in puppeteer's full CLI (which requires yargs) crashes on this Node
// version with "require is not defined in ES module scope", an ESM/CJS
// interop bug in yargs unrelated to anything we actually need. Scanning
// Puppeteer's own cache directory directly gets the same real, guaranteed-
// present browser path without that dependency. CHROME_PATH stays
// available as an emergency override either way.
function findPuppeteerCachedChrome() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
  const chromeDir = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeDir)) return null;

  const builds = fs.readdirSync(chromeDir)
    .filter((name) => fs.statSync(path.join(chromeDir, name)).isDirectory())
    // Prefer the newest downloaded build (dir names end in a version number,
    // e.g. "win64-146.0.7680.31") — a machine can accumulate several across
    // different npm installs over time.
    .sort((a, b) => {
      const va = a.match(/[\d.]+$/)?.[0] || '0';
      const vb = b.match(/[\d.]+$/)?.[0] || '0';
      return vb.localeCompare(va, undefined, { numeric: true });
    });

  const relativeExecutables = [
    'chrome-win64/chrome.exe',
    'chrome-linux64/chrome',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ];
  for (const build of builds) {
    for (const rel of relativeExecutables) {
      const candidate = path.join(chromeDir, build, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const CHROME_EXECUTABLE = process.env.CHROME_PATH || findPuppeteerCachedChrome() || (
  process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
);

// Detect the real installed Chrome version so the spoofed user-agent below
// never goes silently stale. A hardcoded version number (e.g. Chrome/124)
// drifts further behind with every Chrome auto-update; a UA claiming a
// browser that old can cause WhatsApp Web to serve an incompatible internal
// bundle even though the real engine is far newer — confirmed as the cause
// of a "connects fine but window.Store never gets injected, no messages
// ever received" failure where the real Chrome was 149 but the UA claimed
// 124. Falls back to a hardcoded recent version if detection fails.
//
// Runs synchronously at module load, before the startup watchdog is armed
// or client.initialize() is even called — confirmed live (Aaral office PC,
// 05-Aug) that this was the actual cause of several 10+ minute total
// process freezes with zero log output and no self-recovery: the old
// implementation always shelled out to `chrome.exe --version`, and
// execSync has no default timeout. On a machine where real Chrome launches
// are already intermittently slow/hung (see the GPU/sandbox warnings
// throughout this file's logs), that one unbounded subprocess call could
// block Node's entire single thread indefinitely — before the 3-minute
// startup watchdog even exists, so nothing could ever time it out.
// Fixed two ways: (1) prefer parsing the version straight out of the
// cached build's own folder name (e.g. ".../chrome/win64-146.0.7680.31/...")
// — exact, instant, and spawns no subprocess at all, so it cannot hang;
// (2) if that's not available (e.g. CHROME_PATH points at a system install
// outside the version-numbered cache layout), fall back to the same
// execSync detection but with an explicit timeout so a hung launch fails
// fast into the existing fallback-UA path instead of freezing forever.
function detectChromeVersion() {
  const pathMatch = CHROME_EXECUTABLE.match(/-(\d+\.\d+\.\d+\.\d+)[\\/]/);
  if (pathMatch) return pathMatch[1];
  try {
    const output = execSync(`"${CHROME_EXECUTABLE}" --version`, { timeout: 10000 }).toString();
    const match = output.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    return match ? match[0] : '124.0.0.0';
  } catch (e) {
    logger.warn('[WhatsApp] Could not detect Chrome version, using fallback UA version', { error: e.message });
    return '124.0.0.0';
  }
}
const CHROME_VERSION = detectChromeVersion();

// The live client, replaced wholesale on every repair. It is a `let` (was a
// module-level `const`) because recovering from a dead Puppeteer frame means
// building a brand-new Client — the old one cannot be revived. Every consumer
// below reads this variable at call time, so they all follow the swap.
let client = null;
let connection = null;
let healthMonitor = null;

function makeClient() {
  client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  // false, not true: whatsapp-web.js's own in-process restart-on-auth-fail
  // reuses the existing Puppeteer page without fully tearing it down, which
  // throws "Failed to add page binding ... already exists" on reinit and
  // crashes anyway. connection.js rebuilds the whole Client instead, which is
  // the same idea done properly — a genuinely fresh browser and page, without
  // taking the whole process down to get one.
  restartOnAuthFail: false,
  puppeteer: {
    executablePath: CHROME_EXECUTABLE,
    // 'new', not true: recent Chrome builds dropped the old headless mode
    // entirely, so the legacy boolean silently does nothing and Chrome
    // launches a normal visible window instead — confirmed live on the
    // Aaral office PC (a real Chrome window kept popping up even though
    // this was already set to `true`). 'new' is the explicit, still-
    // supported way to request headless across current Chrome/Puppeteer
    // versions.
    headless: 'new',
    timeout: 60000,
    // Puppeteer installs its own SIGINT/SIGTERM/SIGHUP handlers by default
    // that call process.exit() directly and synchronously — confirmed live
    // that this races ahead of (and preempts) our own SIGINT/SIGTERM
    // handlers' async OCR-worker shutdown below, aborting the SIGKILL
    // escalation before it can fire and leaving the OCR child orphaned.
    // Disabling Puppeteer's handlers here means our own handlers are the
    // only thing driving process exit.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      `--user-agent=Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`,
    ],
  },
  webVersionCache: { type: 'local', strict: false },
  });
  attachBotHandlers(client);
  return client;
}

// ── Resolve real phone number from an incoming message ─────────
async function resolveWaNumber(msg) {
  try {
    const contact = await msg.getContact();
    if (contact) {
      if (contact.id && contact.id.server === 'c.us') {
        return contact.id.user;
      }
      const num = String(contact.number || '').replace(/\D/g, '');
      if (num.length >= 10 && num.length <= 15) return num;
    }
  } catch (e) {
    logger.warn('[WhatsApp] getContact failed: ' + e.message);
  }
  if (msg.from.includes('@lid')) {
    return msg.from.replace('@lid', '').replace(/\D/g, '');
  }
  return msg.from.replace('@c.us', '').replace(/\D/g, '');
}

// ── Safe send: sendMessage (not reply) avoids LID-address hangs ────
// Previously a 60s timeout here called process.exit(1) — killing the whole
// bot, the notify server, the admin alert channel and the daily digest,
// because one customer reply was slow. Now a stalled send is classified: a
// dead-session error triggers a background browser rebuild (the connection
// repairs itself and the next message goes through), while anything else just
// fails this one send and is surfaced to the caller.
async function safeSend(msg, text) {
  try {
    return await withTimeout(client.sendMessage(msg.from, text), 60000, 'safeSend');
  } catch (first) {
    try {
      return await withTimeout(msg.reply(text), 60000, 'safeSend reply fallback');
    } catch (second) {
      if (connection) connection.noteSendFailure(second.message || first.message);
      logger.error('[WhatsApp] safeSend failed', { error: second.message, firstError: first.message });
      throw second;
    }
  }
}

async function isAdmin(waNumber) {
  const { rows } = await query(
    `SELECT 1 FROM admins
     WHERE active = true
       AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [waNumber]
  );
  return rows.length > 0;
}

async function notifyAdmins(text, mediaPath) {
  const { rows } = await query('SELECT phone_number FROM admins WHERE active = true');
  let media = null;
  if (mediaPath) {
    try {
      media = MessageMedia.fromFilePath(mediaPath);
    } catch (e) {
      logger.error('[WhatsApp] Failed to load media for admin notification, falling back to text-only', { mediaPath, error: e.message });
    }
  }
  for (const { phone_number } of rows) {
    const chatId = flows.toWhatsAppChatId(phone_number);
    try {
      if (media) {
        await client.sendMessage(chatId, media, { caption: text });
      } else {
        await client.sendMessage(chatId, text);
      }
    } catch (e) {
      logger.error('[WhatsApp] Failed to notify admin', { admin: phone_number, error: e.message });
    }
  }
}

// Attaches this bot's *business* handlers to a freshly built client. The
// connection lifecycle handlers (qr / ready / disconnected / auth_failure)
// are attached separately by connection.js, which owns staying connected.
//
// These must be (re)attached on every rebuild — a repaired connection with no
// message handlers would look perfectly healthy while silently ignoring every
// customer, which is a worse failure than being visibly down.
function attachBotHandlers(c) {
  // Diagnostic only — these only fire if we got past the initial page load
  // and inject() succeeded, so seeing (or not seeing) them tells us whether
  // a hang is happening before or after that point.
  c.on('loading_screen', (percent, message) => {
    logger.info(`[WhatsApp] Loading screen: ${percent}% — ${message}`);
  });
  c.on('change_state', (state) => {
    logger.info(`[WhatsApp] State changed: ${state}`);
  });
  c.on('message', handleIncomingMessage);
  c.on('message_create', handleSelfSentMessage);
}

process.on('unhandledRejection', (reason) => {
  const message = reason?.message || String(reason);
  // A dead Puppeteer frame surfacing as an unhandled rejection used to take
  // the entire process down. Repair the connection in place instead — the
  // notify server, admin alerts and daily digest all stay up meanwhile.
  if (isFatalSessionError(message) && connection) {
    logger.error('[WhatsApp] Unhandled rejection looks like a dead session — repairing', { error: message });
    connection.noteSendFailure(message);
    return;
  }
  logger.error('[WhatsApp] Unhandled rejection — exiting for PM2 restart:', { error: message });
  stopOcrService().then(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('[WhatsApp] Uncaught exception — exiting for PM2 restart:', { error: err?.message || String(err) });
  stopOcrService().then(() => process.exit(1));
});

async function handleIncomingMessage(msg) {
  try {
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const waNumber = await resolveWaNumber(msg);
    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    const admin = await isAdmin(waNumber);

    if (TEST_MODE_ALLOWED_NUMBERS.length > 0 && !admin) {
      const last10 = waNumber.replace(/\D/g, '').slice(-10);
      if (!TEST_MODE_ALLOWED_NUMBERS.includes(last10)) {
        logger.info('[WhatsApp] Ignoring message — not on TEST_MODE_ALLOWED_NUMBERS allowlist', { waNumber });
        return;
      }
    }

    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, pending, text);
      return;
    }

    if (admin && !/^paid$/i.test(text)) {
      const parsed = flows.parseAdminCommand(text);
      if (parsed.command !== 'UNKNOWN') {
        await handleAdminCommand(msg, waNumber, parsed);
        return;
      }
    }

    const customer = await customers.findByPhone(waNumber);
    if (!customer) {
      setPending(waNumber, 'registration_name', {});
      await safeSend(msg, "👋 Welcome to *Aaral Marketing*! I don't have you registered yet — what's your name?");
      return;
    }

    if (/^paid$/i.test(text)) {
      setPending(waNumber, 'awaiting_amount', { customerId: customer.id });
      await safeSend(msg, 'Got it — how much did you pay?');
      return;
    }

    if (/^help$/i.test(text)) {
      await safeSend(msg, `Hi ${customer.name}!\n\n${flows.buildInstructionsMessage()}`);
      return;
    }

    await safeSend(msg, `Hi ${customer.name}! Reply *PAID* any time you make a payment to Aaral Marketing, or *HELP* for instructions.`);
  } catch (e) {
    logger.error('[WhatsApp] message handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}

// When the admin's WhatsApp account IS the bot's own linked number (the
// common case while developing/testing on a personal number), a command an
// admin sends to themselves is a "self-sent" message. whatsapp-web.js's
// 'message' event deliberately excludes self-sent messages (it only fires
// for messages from someone else) — a self-sent CONFIRM/REJECT would
// otherwise never reach the handler above at all, with no error, since the
// library drops it before 'message' ever fires. 'message_create' fires for
// every message including self-sent ones, so admin commands sent to
// yourself are handled here instead.
async function handleSelfSentMessage(msg) {
  try {
    if (!msg.fromMe) return; // messages from others are handled by 'message' above
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const text = (msg.body || '').trim();
    const parsed = flows.parseAdminCommand(text);
    if (parsed.command === 'UNKNOWN') return;

    const waNumber = client.info.wid.user;
    await handleAdminCommand(msg, waNumber, parsed);
  } catch (e) {
    logger.error('[WhatsApp] message_create handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}

async function handlePendingReply(msg, waNumber, pending, text) {
  if (pending.type === 'registration_name') {
    const result = flows.handleRegistrationName(text);
    if (!result.ok) { await safeSend(msg, result.error); return; }
    const customer = await customers.createCustomer({ name: result.name, phoneNumber: waNumber });
    clearPending(waNumber);
    await safeSend(
      msg,
      `Thanks, ${customer.name}! You're registered with *Aaral Marketing*.\n\n` +
      flows.buildInstructionsMessage()
    );
    return;
  }

  if (pending.type === 'awaiting_amount') {
    const result = flows.handleAmountReply(text);
    if (!result.ok) { await safeSend(msg, result.error); return; }
    setPending(waNumber, 'awaiting_proof', { customerId: pending.data.customerId, amount: result.amount });
    await safeSend(msg, 'Now send a screenshot of the payment, type the UPI reference/UTR number, or reply CASH if you paid cash.');
    return;
  }

  if (pending.type === 'awaiting_proof') {
    const result = flows.handleProofReply(text, msg.hasMedia);
    if (!result.ok) { await safeSend(msg, result.error); return; }

    let proofReference = result.proofReference;
    let screenshotPath = null;
    let ocrExtractedAmount = null;
    let ocrExtractedTxnId = null;
    let ocrExtractedDate = null;
    let ocrWarning = '';
    let ocrInfoLine = '';
    if (result.proofType === 'screenshot') {
      const media = await msg.downloadMedia();
      const mimeToExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = mimeToExt[media.mimetype] || 'jpg';
      const fileName = `${Date.now()}-${waNumber}.${ext}`;
      screenshotPath = path.join(PROOFS_DIR, fileName);
      fs.writeFileSync(screenshotPath, media.data, 'base64');
      proofReference = fileName;

      try {
        const ocrResponse = await fetch(`${OCR_SERVICE_URL}/ocr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imagePath: path.resolve(screenshotPath) }),
          signal: AbortSignal.timeout(10000),
        });
        if (!ocrResponse.ok) {
          const errorBody = await ocrResponse.json().catch(() => ({}));
          throw new Error(`OCR service returned ${ocrResponse.status}: ${errorBody.error || 'unknown error'}`);
        }
        const { text: ocrText } = await ocrResponse.json();
        const ocrResult = flows.extractAmountMatch(ocrText, pending.data.amount);
        ocrExtractedAmount = ocrResult.extractedAmount;
        if (ocrResult.matched === false) {
          ocrWarning += `\n⚠️ Typed ₹${pending.data.amount} but screenshot appears to show ₹${ocrResult.extractedAmount} — verify carefully.`;
        }

        ocrExtractedTxnId = flows.extractTxnId(ocrText);
        ocrExtractedDate = flows.extractPaymentDate(ocrText);

        const refParts = [];
        if (ocrExtractedTxnId) refParts.push(`UPI Ref: ${ocrExtractedTxnId}`);
        if (ocrExtractedDate) refParts.push(`Date: ${ocrExtractedDate}`);
        if (refParts.length > 0) {
          ocrInfoLine = `\n${refParts.join(', ')}`;
        }

        if (flows.isScreenshotDateStale(ocrExtractedDate, new Date().toISOString())) {
          const ageDays = Math.floor(flows.screenshotAgeDays(ocrExtractedDate, new Date().toISOString()));
          ocrWarning += `\n⚠️ Screenshot is ${ageDays} day${ageDays === 1 ? '' : 's'} old (${ocrExtractedDate}) — more than the 3-day freshness window, verify carefully.`;
        }
      } catch (e) {
        logger.warn('[WhatsApp] OCR failed, skipping OCR checks', { error: e.message });
      }
    }

    const { claim, duplicateOf, duplicateTxnIdOf } = await claims.createClaim({
      customerId: pending.data.customerId,
      amountClaimed: pending.data.amount,
      proofType: result.proofType,
      proofReference,
      ocrExtractedAmount,
      ocrExtractedTxnId,
      ocrExtractedDate,
    });
    clearPending(waNumber);

    const shortId = claim.id.slice(0, 8);
    await safeSend(msg, `Thanks! Your payment of ₹${pending.data.amount} has been recorded (claim #${shortId}) and is pending verification.`);

    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    const dupTxnNote = duplicateTxnIdOf ? `\n⚠️ Same UPI transaction ID already claimed on claim #${duplicateTxnIdOf.id.slice(0, 8)} (status: ${duplicateTxnIdOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}${dupTxnNote}${ocrInfoLine}${ocrWarning}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`,
      screenshotPath
    );
    return;
  }
}

async function handleAdminCommand(msg, waNumber, parsed) {
  if (parsed.command === 'CONFIRM' || parsed.command === 'REJECT') {
    const matches = await claims.findClaimByIdPrefix(parsed.claimId);
    if (matches.length === 0) { await safeSend(msg, `No claim found matching "${parsed.claimId}".`); return; }
    if (matches.length > 1) { await safeSend(msg, `Multiple claims match "${parsed.claimId}" — use more characters.`); return; }

    const fullId = matches[0].id;
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
        }
      } else {
        await safeSend(msg, `Claim #${parsed.claimId} was already reviewed.`);
      }
    } else {
      const updated = await claims.rejectClaim(fullId, waNumber, parsed.reason);
      if (updated) {
        await safeSend(msg, `Claim #${parsed.claimId} rejected.`);
        const customer = await customers.findById(updated.customer_id);
        if (customer) {
          const chatId = flows.toWhatsAppChatId(customer.phone_number);
          const reasonNote = updated.review_note ? ` Reason: ${updated.review_note}` : '';
          try {
            await client.sendMessage(chatId, `❌ Your payment claim (₹${updated.amount_claimed}) was rejected.${reasonNote}`);
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify customer of rejection', { customer: customer.phone_number, error: e.message });
          }
        }
      } else {
        await safeSend(msg, `Claim #${parsed.claimId} was already reviewed.`);
      }
    }
    return;
  }

  if (parsed.command === 'PENDING') {
    const rows = await claims.listPendingClaims();
    if (rows.length === 0) { await safeSend(msg, 'No pending claims.'); return; }
    const lines = rows.map((r) => `#${r.id.slice(0, 8)} ${r.name} (${r.phone_number}) ₹${r.amount_claimed} [${r.proof_type}]`);
    await safeSend(msg, `Pending claims:\n${lines.join('\n')}`);
    return;
  }

  if (parsed.command === 'PENDING_LINKS') {
    const rows = await balances.listUnlinkedCustomers();
    if (rows.length === 0) { await safeSend(msg, 'No unlinked customers.'); return; }
    const lines = rows.map((r) => `${r.name} (${r.phone_number})`);
    await safeSend(msg, `Unlinked customers:\n${lines.join('\n')}`);
    return;
  }

  if (parsed.command === 'BALANCE') {
    const results = await balances.searchBalances(parsed.query);
    if (results.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    const lines = results.map((r) => `${r.name}: due ₹${r.total_due}, confirmed ₹${r.total_confirmed}, balance ₹${r.balance}`);
    await safeSend(msg, lines.join('\n'));
    return;
  }

  if (parsed.command === 'IMPORT') {
    if (!msg.hasMedia) { await safeSend(msg, 'Send the CSV or Excel file as an attachment with caption IMPORT.'); return; }
    const media = await msg.downloadMedia();
    const buffer = Buffer.from(media.data, 'base64');
    const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      await safeSend(msg, `Import rejected: file is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, over the 5MB limit.`);
      return;
    }
    const mimeToExt = { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv' };
    const ext = mimeToExt[media.mimetype] || 'csv';
    const fileName = path.join(PROOFS_DIR, `import-${Date.now()}.${ext}`);
    fs.writeFileSync(fileName, buffer);
    try {
      const result = await duesImport.importDuesFromFile(fileName, waNumber, { force: parsed.force });
      if (result.alreadyImported) {
        await safeSend(msg, `This file was already imported on ${result.previousImport.imported_at} (${result.previousImport.row_count} rows). Reply IMPORT FORCE with the same attachment to import it again anyway.`);
        return;
      }
      await safeSend(msg, `Import complete: ${result.totalRows} rows, ${result.unmatchedCount} unmatched.`);
    } catch (e) {
      logger.error('[WhatsApp] Import failed', { error: e.message });
      await safeSend(msg, `Import failed: ${e.message}`);
    }
    return;
  }

  await safeSend(msg, 'Unknown command. Try PAID, PENDING, PENDING LINKS, BALANCE <name>, CONFIRM <id>, REJECT <id> <reason>, or IMPORT (with a CSV or Excel attachment).');
}

// Daily 9 AM IST digest of claims that have sat pending for 24h+
if (require.main === module) {
  cron.schedule('0 9 * * *', async () => {
    const stale = await claims.listStaleClaims(24);
    if (stale.length === 0) return;
    const lines = stale.map((r) => `#${r.id.slice(0, 8)} ${r.name} (${r.phone_number}) ₹${r.amount_claimed} — reported ${r.reported_at}`);
    await notifyAdmins(`⏰ ${stale.length} claim(s) pending review for 24h+:\n${lines.join('\n')}`);
  }, { timezone: 'Asia/Kolkata' });
}

function buildConnection() {
  return createConnection({
    buildClient: makeClient,
    sessionProfileDir: SESSION_PROFILE_DIR,
    lockPath: LOCK_PATH,
    backoffPath: BACKOFF_STATE_FILE,
    clearCache: clearSessionCache,
    purgeSession,
    log: (m) => logger.info(`[WhatsApp] ${m}`),
    onQr: async (qr) => {
      // Still printed to the log for whoever is on the machine, but the
      // dashboard's WhatsApp panel is now the primary way to scan it — that is
      // what lets staff re-pair without anyone remoting in.
      logger.info('[WhatsApp] Scan QR code to connect (also available in the dashboard):');
      qrcode.generate(qr, { small: true });
    },
    onReady: () => {
      if (healthMonitor) healthMonitor.start();
    },
  });
}

if (require.main === module) {
  connection = buildConnection();
  healthMonitor = createHealthMonitor({
    connection,
    log: (m) => logger.warn(`[WhatsApp] ${m}`),
  });

  // Order matters, and this is the single most important change in this file.
  //
  // startNotifyServer() used to be called from inside client.on('ready'), so
  // port 5002 only ever bound once WhatsApp was fully connected. That meant a
  // WhatsApp outage ALSO took down:
  //   - the dashboard's only channel for sending invoices/receipts,
  //   - the watchdog's health check for this app, and
  //   - /notify-admins, which is the very channel the watchdog uses to report
  //     that something is wrong.
  // The system could not report its own most common failure. Binding first,
  // unconditionally, is what makes the WhatsApp state observable at all.
  startNotifyServer();

  waitForOcrService()
    .catch((e) => logger.error('[OCR] Unexpected error waiting for OCR service', { error: e.message }))
    .then(() => connection.start())
    .then((result) => {
      if (!result.ok) {
        // Deliberately NOT process.exit(1). Everything above stays up, and
        // connection.start() has already scheduled its own retry on the
        // escalating backoff.
        logger.error('[WhatsApp] Initial connect failed — service stays up, retry scheduled', { error: result.error });
      }
    })
    .catch((e) => logger.error('[WhatsApp] Startup threw unexpectedly', { error: e.message }));
}

module.exports = {
  makeClient, safeSend, resolveWaNumber, isAdmin, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
  buildConnection, startNotifyServer, WA_CONTRACT,
  getConnection: () => connection,
};
