require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cron = require('node-cron');
const { logger } = require('../utils/logger');
const { query } = require('../db/db');
const customers = require('../ledger/customers');
const claims = require('../ledger/claims');
const balances = require('../ledger/balances');
const duesImport = require('../imports/duesImport');
const flows = require('./flows');

const SESSION_DIR = process.env.WA_SESSION_PATH || './wa-sessions';
const PROOFS_DIR = process.env.PROOFS_PATH || './proofs';
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

// Guard against whatsapp-web.js replaying old chat history as 'message' events
// on (re)connect — without this, linking a session with pre-existing chats
// fires the handler for real messages that predate the bot entirely, causing
// it to "welcome" people who never messaged it. msg.timestamp is Unix seconds.
const BOT_START_TIME = Math.floor(Date.now() / 1000);

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
  process.on('exit', chromeCleanup);
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
}

const startupWatchdog = setTimeout(() => {
  logger.error('[WhatsApp] Startup watchdog: not ready after 3 min — exiting for PM2 restart');
  process.exit(1);
}, 3 * 60 * 1000);

// ── Bot State ──────────────────────────────────────────────────
const pendingConfirmations = new Map();
const clearPending = (waNumber) => pendingConfirmations.delete(waNumber);
const setPending = (waNumber, type, data) => {
  pendingConfirmations.set(waNumber, { type, data, expiry: Date.now() + 10 * 60 * 1000 });
};

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  restartOnAuthFail: true,
  puppeteer: {
    executablePath: process.env.CHROME_PATH || (
      process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ),
    headless: true,
    timeout: 60000,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      `--user-agent=Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
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
      process.exit(1);
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
  logger.warn(`[WhatsApp] Disconnected: ${reason} — will auto-reconnect via restartOnAuthFail`);
});

client.on('auth_failure', (msg) => {
  logger.error('[WhatsApp] Auth failure:', msg);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[WhatsApp] Unhandled rejection — exiting for PM2 restart:', { error: reason?.message || String(reason) });
  process.exit(1);
});

client.on('message', async (msg) => {
  try {
    if (msg.from.includes('@g.us') || msg.isStatus) return;
    if (msg.timestamp && msg.timestamp < BOT_START_TIME) return;

    const waNumber = await resolveWaNumber(msg);
    const text = (msg.body || '').trim();
    const pending = pendingConfirmations.get(waNumber);
    const admin = await isAdmin(waNumber);

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
    if (result.proofType === 'screenshot') {
      const media = await msg.downloadMedia();
      const mimeToExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = mimeToExt[media.mimetype] || 'jpg';
      const fileName = `${Date.now()}-${waNumber}.${ext}`;
      screenshotPath = path.join(PROOFS_DIR, fileName);
      fs.writeFileSync(screenshotPath, media.data, 'base64');
      proofReference = fileName;
    }

    const { claim, duplicateOf } = await claims.createClaim({
      customerId: pending.data.customerId,
      amountClaimed: pending.data.amount,
      proofType: result.proofType,
      proofReference,
    });
    clearPending(waNumber);

    const shortId = claim.id.slice(0, 8);
    await safeSend(msg, `Thanks! Your payment of ₹${pending.data.amount} has been recorded (claim #${shortId}) and is pending verification.`);

    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`,
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
      await safeSend(msg, updated ? `Claim #${parsed.claimId} confirmed.` : `Claim #${parsed.claimId} was already reviewed.`);
    } else {
      const updated = await claims.rejectClaim(fullId, waNumber, parsed.reason);
      await safeSend(msg, updated ? `Claim #${parsed.claimId} rejected.` : `Claim #${parsed.claimId} was already reviewed.`);
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
    if (!msg.hasMedia) { await safeSend(msg, 'Send the CSV file as an attachment with caption IMPORT.'); return; }
    const media = await msg.downloadMedia();
    const fileName = path.join(PROOFS_DIR, `import-${Date.now()}.csv`);
    fs.writeFileSync(fileName, Buffer.from(media.data, 'base64'));
    const result = await duesImport.importDuesFromFile(fileName, waNumber);
    await safeSend(msg, `Import complete: ${result.totalRows} rows, ${result.unmatchedCount} unmatched.`);
    return;
  }

  await safeSend(msg, 'Unknown command. Try PAID, PENDING, PENDING LINKS, BALANCE <name>, CONFIRM <id>, REJECT <id> <reason>, or IMPORT (with a CSV attachment).');
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
  client.initialize();
}

module.exports = {
  client, safeSend, resolveWaNumber, isAdmin, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
};
