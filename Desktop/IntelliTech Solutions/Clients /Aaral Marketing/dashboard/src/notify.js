const NOTIFY_URL = process.env.NOTIFY_SERVICE_URL || 'http://127.0.0.1:5002';

// Keep in step with WA_CONTRACT in whatsapp-bot/src/whatsapp/bot.js. A mismatch
// means one of the two apps was updated and the other was not — a half-finished
// deploy that would otherwise present as a baffling runtime bug.
const WA_CONTRACT = 1;

// Turns Puppeteer/whatsapp-web.js internals into something the office staff can
// actually read out over the phone. Previously every failure — a dead browser,
// an unregistered number, the bot being down — collapsed into the same generic
// "did not confirm delivery", which is why diagnosing the equivalent failure on
// another client's machine needed DevTools open on the shop PC.
function humanReason({ reason, recovering, transport }) {
  if (transport === 'unreachable') {
    return 'The WhatsApp service is not running on this PC. It usually restarts by itself within a minute — try again shortly.';
  }
  if (recovering) {
    return 'WhatsApp lost its connection and is reconnecting automatically. Try again in about a minute — no action needed.';
  }
  const r = String(reason || '').toLowerCase();
  if (r.includes('not on whatsapp') || r.includes('number is not')) {
    return 'That mobile number is not registered on WhatsApp. Check the number on the customer record.';
  }
  if (r.includes('timed out')) {
    return 'WhatsApp did not respond in time. The message may not have been sent — check the chat before resending.';
  }
  if (r.includes('phone and message are required')) {
    return 'This customer has no mobile number saved. Add one on their record first.';
  }
  return `WhatsApp could not send this: ${reason || 'unknown error'}`;
}

async function post(path, body, timeoutMs) {
  // Customers can now be created without a phone number. Every WhatsApp-send
  // call site in this app goes through notify()/notifyWithPdf() below, so
  // short-circuiting here (before ever reaching the bot process) is the one
  // place that makes phoneless customers silently skipped everywhere at
  // once, rather than needing a guard at each of the half-dozen call sites.
  // Same reason/shape the bot's own /notify endpoint already returns for a
  // missing phone, so humanReason() and every existing caller's handling of
  // that reason string keep working unchanged.
  if (path === '/notify' && !body.phone) {
    return { sent: false, reason: 'phone and message are required', recovering: false };
  }
  try {
    const res = await fetch(`${NOTIFY_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    return {
      sent: data.sent === true,
      reason: data.reason || null,
      recovering: data.recovering === true,
    };
  } catch (err) {
    // Distinguish "the bot said no" from "the bot never answered" — they need
    // completely different responses from whoever is standing at the counter.
    console.error('[Notify] Could not reach the WhatsApp service:', err.message);
    return { sent: false, reason: err.message, recovering: false, transport: 'unreachable' };
  }
}

async function notify(phone, message) {
  return post('/notify', { phone, message }, 5000);
}

async function notifyWithPdf(phone, message, pdfBuffer, filename) {
  return post('/notify', { phone, message, pdfBase64: pdfBuffer.toString('base64'), filename }, 30000);
}

// Read-only view of the WhatsApp connection, for the dashboard's status panel.
async function waStatus() {
  try {
    const res = await fetch(`${NOTIFY_URL}/wa/status`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return {
      ...data,
      reachable: true,
      contractMismatch: data.contract !== undefined && data.contract !== WA_CONTRACT,
    };
  } catch (err) {
    return { reachable: false, state: 'unreachable', reason: err.message };
  }
}

async function waQr() {
  try {
    const res = await fetch(`${NOTIFY_URL}/wa/qr`, { signal: AbortSignal.timeout(5000) });
    return await res.json();
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// Repair keeps the existing pairing (no phone needed); re-pair purges the
// credentials and requires someone to scan a QR with the client's phone.
async function waRepair({ repair = true } = {}) {
  try {
    const res = await fetch(`${NOTIFY_URL}${repair ? '/wa/recover' : '/wa/reset'}`, {
      method: 'POST',
      // A cold Chrome launch on this machine has been observed taking minutes.
      signal: AbortSignal.timeout(240000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { notify, notifyWithPdf, humanReason, waStatus, waQr, waRepair, WA_CONTRACT };
