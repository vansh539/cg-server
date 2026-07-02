require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logger } = require('../utils/logger');
const { query } = require('../db/db');

const SESSION_DIR = process.env.WA_SESSION_PATH || './wa-sessions';
const PROOFS_DIR = process.env.PROOFS_PATH || './proofs';
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

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

async function notifyAdmins(text) {
  const { rows } = await query('SELECT phone_number FROM admins WHERE active = true');
  for (const { phone_number } of rows) {
    const chatId = phone_number.replace(/\D/g, '') + '@c.us';
    try {
      await client.sendMessage(chatId, text);
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

if (require.main === module) {
  client.initialize();
}

module.exports = {
  client, safeSend, resolveWaNumber, isAdmin, notifyAdmins,
  pendingConfirmations, setPending, clearPending, PROOFS_DIR,
};
