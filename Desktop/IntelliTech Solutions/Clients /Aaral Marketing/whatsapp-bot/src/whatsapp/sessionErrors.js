// Errors that mean the underlying Puppeteer page/browser is gone, so the
// whatsapp-web.js client object is permanently dead even though it never fired
// 'disconnected' and our own status still cheerfully reports "connected".
//
// This is the exact failure that cost a full day on the SMSA deployment
// (19-Aug-2026): the status said connected, every single send returned
// "Attempted to use detached Frame", and nothing in the service ever noticed or
// recovered — it took an on-site session with an elevated taskkill to clear.
// Aaral's bot has the same shape of bug today: the /notify handler catches the
// error, returns { sent: false }, and nothing acts on it, so every subsequent
// dashboard send fails identically until someone restarts the process by hand.
// Detecting these strings is what turns that incident into an automatic
// self-heal that the shop never sees.
const FATAL_SESSION_ERRORS = [
  'detached frame',
  'session closed',
  'target closed',
  'protocol error',
  'execution context was destroyed',
  'most likely the page has been closed',
  'browser has disconnected',
  'connection closed',
  // Seen on this client's box specifically, where Chrome launches are already
  // intermittently flaky (GPU exit_code=34 / sandbox access-denied chatter).
  'navigation failed because browser has disconnected',
  'page has been closed',
];

function isFatalSessionError(message) {
  const m = String(message || '').toLowerCase();
  return FATAL_SESSION_ERRORS.some((f) => m.includes(f));
}

// Every await that talks to Chrome may be talking to a Chrome that is already
// half-dead. Without a deadline a stalled page never rejects, the HTTP request
// never responds, and the dashboard sees a Send button spinning forever with no
// error and nothing in the log — indistinguishable from "the service is down".
// Fail loudly instead, and let the caller classify the failure.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { FATAL_SESSION_ERRORS, isFatalSessionError, withTimeout };
