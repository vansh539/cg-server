'use strict';

const express = require('express');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const PORT = process.env.WHATSAPP_BOT_PORT || 5010;
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// Startup-timestamp guard: this bot only ever sends messages via the
// /send-invoice endpoint below — it never reads or reacts to incoming
// messages/chats at all, which sidesteps the historical-replay-on-reconnect
// class of bug entirely (real incident on another client's bot: a chat-bot
// without this guard auto-replied to months of old messages on first
// connect). Documented here rather than enforced in code because there is
// no incoming-message code path to guard in the first place.
const STARTED_AT = Date.now();

// Uses the system's installed Chrome rather than puppeteer's bundled
// Chromium download — avoids a second ~200MB browser download (and a flaky
// one at that; a stale puppeteer cache from another project's whatsapp-web.js
// setup broke the bundled download here) and matches this project's existing
// pattern of driving the already-installed Chrome for headless rendering.
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: { headless: true, executablePath: CHROME_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

let ready = false;

client.on('qr', (qr) => {
  console.log('[WhatsApp] Scan this QR code with the dedicated business number:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  ready = true;
  console.log(`[WhatsApp] Client ready. Bot started at ${new Date(STARTED_AT).toISOString()}.`);
});

client.on('disconnected', (reason) => {
  ready = false;
  console.error(`[WhatsApp] Disconnected: ${reason}`);
});

client.initialize();

const app = express();
app.use(express.json({ limit: '20mb' })); // invoice PDFs are small but base64 inflates size ~33%

app.post('/send-invoice', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'WhatsApp client is not ready yet' });
  const { phone, pdfBase64, filename, message } = req.body || {};
  if (!phone || !/^\d+$/.test(phone)) return res.status(400).json({ error: 'A digits-only phone number is required' });
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' });
  try {
    // Resolving via getNumberId() rather than hand-building `${phone}@c.us`
    // — sending straight to a guessed @c.us id throws "No LID for user"
    // against WhatsApp's current multi-device/LID identity system unless
    // the client has already resolved that contact through a real lookup.
    const numberId = await client.getNumberId(phone.replace(/^0+/, ''));
    if (!numberId) return res.status(400).json({ error: `${phone} is not a registered WhatsApp number` });
    const media = new MessageMedia('application/pdf', pdfBase64, filename || 'invoice.pdf');
    await client.sendMessage(numberId._serialized, media, { caption: message || '' });
    res.json({ sent: true });
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[WhatsApp] Bridge listening on http://127.0.0.1:${PORT}`);
});
