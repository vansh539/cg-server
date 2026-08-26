require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { logger } = require('../utils/logger');
const { createConnection } = require('./connection');
const { createHealthMonitor } = require('./healthMonitor');
const { isFatalSessionError, withTimeout } = require('./sessionErrors');
const { clearSessionCache } = require('./sessionCacheClean');
const { query } = require('payment-ledger-core/db');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const duesImport = require('payment-ledger-core/imports/duesImport');
const { recordPayment } = require('payment-ledger-core/ledger/payments');
const flows = require('./flows');
const paymentIntent = require('./paymentIntent');

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

// Where to reach the dashboard's internal-only bot routes (ledger PDF
// rendering lives there, since Puppeteer/chittiStyles are dashboard-only).
const DASHBOARD_INTERNAL_URL = process.env.DASHBOARD_INTERNAL_URL || 'http://127.0.0.1:3400';

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
    // to reach bot" and degrade gracefully.
    logger.error('[Notify] Server failed to start', { error: err.message, port: NOTIFY_SERVICE_PORT });
  });
  server.listen(NOTIFY_SERVICE_PORT, '127.0.0.1', () => {
    logger.info(`[Notify] Listening on 127.0.0.1:${NOTIFY_SERVICE_PORT} (contract ${WA_CONTRACT})`);
  });
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
  process.on('exit', () => { chromeCleanup(); });
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
  process.on('SIGHUP', () => { logger.info('[WhatsApp] SIGHUP — clean exit'); process.exit(0); });
  process.on('SIGQUIT', () => { logger.info('[WhatsApp] SIGQUIT — clean exit'); process.exit(0); });
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
    // that call process.exit() directly and synchronously, which would race
    // ahead of (and preempt) our own signal handlers above. Disabling
    // Puppeteer's handlers here means our own handlers are the only thing
    // driving process exit.
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
// bot and the notify/admin-alert channels because one reply was slow. Now a
// stalled send is classified: a
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

// Gates every bot command. Distinct from the `admins` table (which is a
// shared payment-ledger-core concept used for business-activity broadcasts,
// e.g. new-invoice/new-payment alerts, and stays untouched here) — this is
// the dashboard's own real staff identity, extended with a phone number.
async function resolveStaffUser(waNumber) {
  const { rows } = await query(
    `SELECT id, role, display_name FROM dashboard_users
     WHERE active = true
       AND phone_number IS NOT NULL
       AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [waNumber]
  );
  if (!rows.length) return null;
  return { id: rows[0].id, role: rows[0].role, displayName: rows[0].display_name };
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
  // notify server and admin alerts stay up meanwhile.
  if (isFatalSessionError(message) && connection) {
    logger.error('[WhatsApp] Unhandled rejection looks like a dead session — repairing', { error: message });
    connection.noteSendFailure(message);
    return;
  }
  logger.error('[WhatsApp] Unhandled rejection — exiting for PM2 restart:', { error: message });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('[WhatsApp] Uncaught exception — exiting for PM2 restart:', { error: err?.message || String(err) });
  process.exit(1);
});

async function handleIncomingMessage(msg) {
  try {
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const waNumber = await resolveWaNumber(msg);
    const staff = await resolveStaffUser(waNumber);
    if (!staff) return; // non-staff numbers are always silently ignored, no exceptions

    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, staff, pending, text);
      return;
    }

    const parsed = flows.parseAdminCommand(text);
    if (parsed.command !== 'UNKNOWN') {
      await handleStaffCommand(msg, waNumber, staff, parsed);
      return;
    }

    await handlePaymentReport(msg, waNumber, staff, text);
  } catch (e) {
    logger.error('[WhatsApp] message handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}

// When a staff member's WhatsApp account IS the bot's own linked number (the
// common case while developing/testing on a personal number), a command they
// send to themselves is a "self-sent" message. whatsapp-web.js's 'message'
// event deliberately excludes self-sent messages (it only fires for messages
// from someone else) — a self-sent command would otherwise never reach the
// handler above at all, with no error, since the library drops it before
// 'message' ever fires. 'message_create' fires for every message including
// self-sent ones, so staff commands sent to yourself are handled here instead.
async function handleSelfSentMessage(msg) {
  try {
    if (!msg.fromMe) return; // messages from others are handled by 'message' above
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (!msg.timestamp || msg.timestamp < BOT_START_TIME) return;

    const waNumber = client.info.wid.user;
    const staff = await resolveStaffUser(waNumber);
    if (!staff) return;

    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    if (pending && pending.expiry > Date.now()) {
      await handlePendingReply(msg, waNumber, staff, pending, text);
      return;
    }

    const parsed = flows.parseAdminCommand(text);
    if (parsed.command !== 'UNKNOWN') {
      await handleStaffCommand(msg, waNumber, staff, parsed);
      return;
    }

    await handlePaymentReport(msg, waNumber, staff, text);
  } catch (e) {
    logger.error('[WhatsApp] message_create handler error', { error: e.message });
    if (connection) connection.noteSendFailure(e.message);
  }
}

function buildConfirmSummary({ amount, date, method, customerName, balanceAfter }) {
  const methodLabel = { cash: 'Cash', gpay: 'GPay', bank_transfer: 'Bank Transfer' }[method];
  const balanceNote = balanceAfter !== null ? ` — balance will become ₹${balanceAfter}` : '';
  return `Record ₹${amount} from ${customerName}, dated ${date}, ${methodLabel}${balanceNote}. Reply YES to confirm, NO to cancel.`;
}

async function presentPaymentConfirm(msg, waNumber, draft) {
  const balance = await balances.getBalanceByCustomerId(draft.customerId).catch(() => null);
  const currentBalance = balance ? Number(balance.balance) : 0;
  const balanceAfter = balance ? currentBalance - Number(draft.amount) : null;
  setPending(waNumber, 'awaiting_payment_confirm', { ...draft, balanceAfter });
  await safeSend(msg, buildConfirmSummary({ ...draft, balanceAfter }));
}

// The only free-text surface in this bot -- everything else (BALANCE,
// LEDGER, IMPORT) is a structured command, deliberately, to keep parsing
// risk contained to the one place that actually needs it.
async function handlePaymentReport(msg, waNumber, staff, text) {
  const parsed = paymentIntent.parsePaymentMessage(text);

  if (parsed.amount === null) {
    await safeSend(msg, 'Unknown command. Try BALANCE <name>, LEDGER <name>, IMPORT, or report a payment like: received 5000 from Ramesh.');
    return;
  }

  const candidates = await paymentIntent.resolveCustomerFromText(parsed.candidatePhrases, customers.findByNameOrPhone);

  if (candidates.length === 0) {
    setPending(waNumber, 'awaiting_customer_clarification', {
      amount: parsed.amount, date: parsed.date, method: parsed.method, mode: 'ask_name',
    });
    await safeSend(msg, `I couldn't match a customer in that message. What's the exact registered name?`);
    return;
  }

  if (candidates.length > 1) {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.name}`);
    setPending(waNumber, 'awaiting_customer_clarification', {
      amount: parsed.amount, date: parsed.date, method: parsed.method, mode: 'pick',
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
    });
    await safeSend(msg, `Multiple customers match:\n${lines.join('\n')}\nReply with a number.`);
    return;
  }

  const draft = {
    amount: parsed.amount, date: parsed.date, method: parsed.method,
    customerId: candidates[0].id, customerName: candidates[0].name,
  };

  if (!draft.method) {
    setPending(waNumber, 'awaiting_payment_method', draft);
    await safeSend(msg, 'Cash, GPay, or Bank?');
    return;
  }

  await presentPaymentConfirm(msg, waNumber, draft);
}

async function handlePendingReply(msg, waNumber, staff, pending, text) {
  if (pending.type === 'awaiting_customer_clarification') {
    if (pending.data.mode === 'pick') {
      const index = parseInt(text, 10);
      const picked = Number.isInteger(index) ? pending.data.candidates[index - 1] : null;
      if (!picked) { await safeSend(msg, `Reply with a number from 1 to ${pending.data.candidates.length}.`); return; }
      const draft = { amount: pending.data.amount, date: pending.data.date, method: pending.data.method, customerId: picked.id, customerName: picked.name };
      clearPending(waNumber);
      if (!draft.method) { setPending(waNumber, 'awaiting_payment_method', draft); await safeSend(msg, 'Cash, GPay, or Bank?'); return; }
      await presentPaymentConfirm(msg, waNumber, draft);
      return;
    }

    // mode === 'ask_name'
    const matches = await customers.findByNameOrPhone(text.trim());
    if (matches.length !== 1) {
      await safeSend(msg, matches.length === 0
        ? `Still no match for "${text.trim()}". What's the exact registered name?`
        : `Multiple customers match "${text.trim()}" — try a more specific name.`);
      return;
    }
    const draft = { amount: pending.data.amount, date: pending.data.date, method: pending.data.method, customerId: matches[0].id, customerName: matches[0].name };
    clearPending(waNumber);
    if (!draft.method) { setPending(waNumber, 'awaiting_payment_method', draft); await safeSend(msg, 'Cash, GPay, or Bank?'); return; }
    await presentPaymentConfirm(msg, waNumber, draft);
    return;
  }

  if (pending.type === 'awaiting_payment_method') {
    const method = paymentIntent.extractMethod(text);
    if (!method) { await safeSend(msg, 'Please reply Cash, GPay, or Bank.'); return; }
    const draft = { ...pending.data, method };
    clearPending(waNumber);
    await presentPaymentConfirm(msg, waNumber, draft);
    return;
  }

  if (pending.type === 'awaiting_payment_confirm') {
    if (/^no$/i.test(text.trim())) {
      clearPending(waNumber);
      await safeSend(msg, 'Cancelled — nothing recorded.');
      return;
    }
    if (!/^yes$/i.test(text.trim())) {
      await safeSend(msg, 'Reply YES to confirm or NO to cancel.');
      return;
    }

    clearPending(waNumber);
    const { amount, date, method, customerId, customerName, balanceAfter } = pending.data;
    const payment = await recordPayment({ customerId, amount, method, date, createdBy: `whatsapp:${staff.displayName}` });
    await safeSend(msg, `Recorded ₹${payment.amount_claimed} from ${customerName}.`);

    try {
      const customer = await customers.findById(customerId);
      if (customer) {
        const balanceLine = balanceAfter !== null ? ` Balance: ₹${balanceAfter}` : '';
        await client.sendMessage(flows.toWhatsAppChatId(customer.phone_number), `Payment received: ₹${payment.amount_claimed} on ${date}.${balanceLine}`);
      }
    } catch (e) {
      logger.error('[WhatsApp] Failed to notify customer of recorded payment', { error: e.message });
    }
    return;
  }
}

async function sendLedgerPdf(msg, customer) {
  try {
    const res = await fetch(`${DASHBOARD_INTERNAL_URL}/internal/bot/ledger-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Internal-Secret': process.env.BOT_INTERNAL_SECRET || '' },
      body: JSON.stringify({ customerId: customer.id }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      await safeSend(msg, `Could not fetch the ledger: ${body.error || res.statusText}`);
      return;
    }
    const data = await res.json();
    const media = new MessageMedia('application/pdf', data.pdfBase64, data.filename);
    await client.sendMessage(msg.from, media, { caption: data.balanceLine });
  } catch (e) {
    logger.error('[WhatsApp] Failed to fetch/send ledger PDF', { error: e.message });
    await safeSend(msg, 'Could not reach the dashboard to fetch the ledger — try again shortly.');
  }
}

async function handleStaffCommand(msg, waNumber, staff, parsed) {
  if (parsed.command === 'BALANCE') {
    const results = await balances.searchBalances(parsed.query);
    if (results.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    const lines = results.map((r) => `${r.name}: due ₹${r.total_due}, confirmed ₹${r.total_confirmed}, balance ₹${r.balance}`);
    await safeSend(msg, lines.join('\n'));
    return;
  }

  if (parsed.command === 'LEDGER') {
    const matches = await customers.findByNameOrPhone(parsed.query);
    if (matches.length === 0) { await safeSend(msg, `No customer found matching "${parsed.query}".`); return; }
    if (matches.length > 1) {
      const lines = matches.map((c, i) => `${i + 1}. ${c.name}`);
      await safeSend(msg, `Multiple customers match "${parsed.query}":\n${lines.join('\n')}\nSend LEDGER with the exact name.`);
      return;
    }
    await sendLedgerPdf(msg, matches[0]);
    return;
  }

  if (parsed.command === 'IMPORT') {
    if (staff.role !== 'admin') { await safeSend(msg, 'Only an admin can run IMPORT.'); return; }
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

  await safeSend(msg, 'Unknown command. Try BALANCE <name>, LEDGER <name>, IMPORT, or report a payment like: received 5000 from Ramesh.');
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

  connection.start()
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
  makeClient, safeSend, resolveWaNumber, resolveStaffUser, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
  buildConnection, startNotifyServer, WA_CONTRACT,
  getConnection: () => connection,
};
