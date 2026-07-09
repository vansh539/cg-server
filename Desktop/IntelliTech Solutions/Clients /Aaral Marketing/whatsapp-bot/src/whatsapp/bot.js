require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const cron = require('node-cron');
const { logger } = require('../utils/logger');
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
    try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore', shell: true }); } catch (_) {}
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

const startupWatchdog = setTimeout(() => {
  logger.error('[WhatsApp] Startup watchdog: not ready after 3 min — exiting for PM2 restart');
  stopOcrService().then(() => process.exit(1));
}, 3 * 60 * 1000);

// ── Bot State ──────────────────────────────────────────────────
const pendingConfirmations = new Map();
const clearPending = (waNumber) => pendingConfirmations.delete(waNumber);
const setPending = (waNumber, type, data) => {
  pendingConfirmations.set(waNumber, { type, data, expiry: Date.now() + 10 * 60 * 1000 });
};

const CHROME_EXECUTABLE = process.env.CHROME_PATH || (
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
function detectChromeVersion() {
  try {
    const output = execSync(`"${CHROME_EXECUTABLE}" --version`).toString();
    const match = output.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    return match ? match[0] : '124.0.0.0';
  } catch (e) {
    logger.warn('[WhatsApp] Could not detect Chrome version, using fallback UA version', { error: e.message });
    return '124.0.0.0';
  }
}
const CHROME_VERSION = detectChromeVersion();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  // false, not true: whatsapp-web.js's own in-process restart-on-auth-fail
  // reuses the existing Puppeteer page without fully tearing it down, which
  // throws "Failed to add page binding ... already exists" on reinit and
  // crashes anyway. We exit cleanly on disconnect instead (see
  // client.on('disconnected', ...) below) and let an external supervisor
  // (PM2, or a manual restart) launch a fresh browser — same philosophy as
  // the unhandledRejection handler further down.
  restartOnAuthFail: false,
  puppeteer: {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
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
async function safeSend(msg, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.error('[WhatsApp] safeSend timeout — exiting for PM2 restart');
      stopOcrService().then(() => process.exit(1));
    }, 60000);
    client.sendMessage(msg.from, text)
      .then((r) => { clearTimeout(timer); resolve(r); })
      .catch(() => {
        msg.reply(text)
          .then((r) => { clearTimeout(timer); resolve(r); })
          .catch((e) => { clearTimeout(timer); reject(e); });
      });
  });
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

client.on('qr', (qr) => {
  logger.info('[WhatsApp] Scan QR code to connect:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  clearTimeout(startupWatchdog);
  logger.info('[WhatsApp] Bot connected and ready!');
  setInterval(async () => {
    try { await client.getState(); } catch (_) {}
  }, 15000);
});

client.on('disconnected', (reason) => {
  logger.warn(`[WhatsApp] Disconnected: ${reason} — exiting for a clean restart with a fresh browser`);
  stopOcrService().then(() => process.exit(1));
});

client.on('auth_failure', (msg) => {
  logger.error('[WhatsApp] Auth failure:', msg);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[WhatsApp] Unhandled rejection — exiting for PM2 restart:', { error: reason?.message || String(reason) });
  stopOcrService().then(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('[WhatsApp] Uncaught exception — exiting for PM2 restart:', { error: err?.message || String(err) });
  stopOcrService().then(() => process.exit(1));
});

client.on('message', async (msg) => {
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
      await safeSend(msg, "Welcome! I don't have you registered yet. What's your name?");
      return;
    }

    if (/^paid$/i.test(text)) {
      setPending(waNumber, 'awaiting_amount', { customerId: customer.id });
      await safeSend(msg, 'Got it — how much did you pay?');
      return;
    }

    await safeSend(msg, `Hi ${customer.name}! Reply *PAID* any time you make a payment to CoKarma.`);
  } catch (e) {
    logger.error('[WhatsApp] message handler error', { error: e.message });
  }
});

// When the admin's WhatsApp account IS the bot's own linked number (the
// common case while developing/testing on a personal number), a command an
// admin sends to themselves is a "self-sent" message. whatsapp-web.js's
// 'message' event deliberately excludes self-sent messages (it only fires
// for messages from someone else) — a self-sent CONFIRM/REJECT would
// otherwise never reach the handler above at all, with no error, since the
// library drops it before 'message' ever fires. 'message_create' fires for
// every message including self-sent ones, so admin commands sent to
// yourself are handled here instead.
client.on('message_create', async (msg) => {
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
  }
});

async function handlePendingReply(msg, waNumber, pending, text) {
  if (pending.type === 'registration_name') {
    const result = flows.handleRegistrationName(text);
    if (!result.ok) { await safeSend(msg, result.error); return; }
    const customer = await customers.createCustomer({ name: result.name, phoneNumber: waNumber });
    clearPending(waNumber);
    await safeSend(msg, `Thanks, ${customer.name}! You're registered. Reply *PAID* any time you make a payment to CoKarma.`);
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

if (require.main === module) {
  waitForOcrService()
    .catch((e) => logger.error('[OCR] Unexpected error waiting for OCR service', { error: e.message }))
    .then(() => client.initialize());
}

module.exports = {
  client, safeSend, resolveWaNumber, isAdmin, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
};
