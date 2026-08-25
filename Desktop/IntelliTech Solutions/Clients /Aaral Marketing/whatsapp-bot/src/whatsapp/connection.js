const defaultLock = require('./lock');
const defaultBackoff = require('./backoff');
const { clearSessionCache: defaultClearCache } = require('./sessionCacheClean');
const { isFatalSessionError } = require('./sessionErrors');

// ── WhatsApp connection lifecycle ───────────────────────────────
//
// Everything about *staying* connected lives here; bot.js keeps everything
// about what to do with messages. Split this way because the lifecycle is the
// part that has repeatedly failed in the field, and it could not be tested at
// all while it was tangled up with Postgres and the OCR sidecar inside bot.js.
//
// The behaviour this replaces: bot.js's only recovery mechanism was
// process.exit(1) and letting PM2 relaunch. That is a sledgehammer — it throws
// away a perfectly good WhatsApp pairing, relaunches Chrome from cold, and
// (because the exit records a backoff failure) can put the bot to sleep for
// 10-30 minutes over what is often a dead Puppeteer frame that a browser
// rebuild fixes in seconds. Worse, some failure modes never triggered an exit
// at all: a detached frame left the bot reporting "connected" forever while
// every send failed identically.
//
// Two distinct repairs, deliberately not the same thing:
//   recover() — rebuild the browser on the EXISTING pairing. No QR, no phone,
//               nobody notices. This is what a detached frame deserves.
//   reset()   — purge stored credentials, forcing a fresh QR scan. Last resort,
//               because it needs a human with the client's phone.
function createConnection(opts) {
  const {
    buildClient,
    sessionProfileDir,
    lockPath,
    backoffPath,
    readyTimeoutMs = 3 * 60 * 1000,
    onReady = () => {},
    onQr = () => {},
    onStateChange = () => {},
    clearCache = defaultClearCache,
    purgeSession = null,
    lock = defaultLock,
    backoff = defaultBackoff,
    log = () => {},
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    heartbeatIntervalMs = 20000,
  } = opts;

  let state = 'starting';
  let number = null;
  let lastQr = null;
  let client = null;
  // Surfaced through getStatus() so the dashboard can tell staff *why* WhatsApp
  // is not working. Previously the only available answer was silence.
  let lastError = null;
  let recovering = false;
  let retryTimer = null;
  let heartbeatTimer = null;

  function setState(next) {
    if (state === next) return;
    state = next;
    try { onStateChange(next); } catch (e) { /* observer must never break us */ }
  }

  // Diagnostic-only. whatsapp-web.js calls page.goto(url, { timeout: 0 })
  // internally, so a stalled load produces zero library-level signal — no
  // error, no event, nothing. Polling the Puppeteer page directly is what
  // distinguishes "navigation never started" from "page loaded 100% then hung
  // on ready", which is the difference between a network problem and a
  // corrupted Service Worker cache.
  function startConnectHeartbeat() {
    const startedAt = Date.now();
    stopConnectHeartbeat();
    heartbeatTimer = setInterval(async () => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      try {
        const page = client && client.pupPage;
        if (!page) { log(`Still connecting (${elapsed}s) — no page yet`); return; }
        const url = await page.url();
        const readyState = await page.evaluate(() => document.readyState).catch(() => 'eval-failed');
        log(`Still connecting (${elapsed}s) url=${url} readyState=${readyState}`);
      } catch (e) {
        log(`Still connecting (${elapsed}s) — page not queryable: ${e.message}`);
      }
    }, heartbeatIntervalMs);
    if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }

  function stopConnectHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // `markSettled` is threaded through the lifecycle handlers so the promise
  // gating attemptStart()'s race resolves only AFTER the handler has finished
  // its state work — never before. Resolving from a separately-registered
  // listener would let the gate win the race before the state-setting handler's
  // own async work (e.g. rendering the QR to a data URL) had actually run.
  function attachLifecycle(c, markSettled) {
    c.on('qr', async (qr) => {
      lastQr = qr;
      setState('qr');
      // Reaching a QR is a successful outcome, not a fault — leaving a stale
      // reason attached would make the dashboard report an error alongside a
      // perfectly good pairing code.
      lastError = null;
      try { await onQr(qr); } catch (e) { log('onQr handler threw: ' + e.message); }
      markSettled();
    });

    c.on('ready', () => {
      setState('connected');
      lastQr = null;
      lastError = null;
      try { number = c.info && c.info.wid ? c.info.wid.user : null; } catch (e) { number = null; }
      backoff.recordConnectSuccess(backoffPath);
      stopConnectHeartbeat();
      log('Bot connected and ready' + (number ? ` as ${number}` : ''));
      try { onReady(c); } catch (e) { log('onReady handler threw: ' + e.message); }
      markSettled();
    });

    c.on('disconnected', (reason) => {
      log(`Disconnected: ${reason}`);
      setState('disconnected');
      number = null;
      lastError = `disconnected: ${reason}`;
      markSettled();
      // A dropped session used to exit the process and hand the problem to PM2.
      // Rebuilding in place keeps the notify server, the admin alert channel and
      // the daily digest alive throughout, and usually reconnects with no QR.
      Promise.resolve().then(() => api.recover(`disconnected: ${reason}`)).catch(() => {});
    });

    c.on('auth_failure', (msg) => {
      lastError = `auth failure: ${msg}`;
      log(`Auth failure: ${msg}`);
    });

    return c;
  }

  async function attemptStart() {
    const lockResult = lock.acquireLock(lockPath);
    if (!lockResult.ok) {
      throw new Error(`cannot start: ${lockResult.reason}`);
    }

    let settled = false;
    let resolveSettled;
    const settledPromise = new Promise((resolve) => { resolveSettled = resolve; });
    function markSettled() {
      if (settled) return;
      settled = true;
      resolveSettled();
    }
    // Silences the timeout leg WITHOUT resolving the race. Needed for the
    // initialize()-rejected path: resolving the gate there would win the race
    // as a *success* (the resolve is queued before the rethrow), so a Chrome
    // that failed to launch at all would be reported as a healthy start with
    // the state stuck on 'starting'. Caught by a unit test; worth knowing that
    // the SMSA service this was ported from still has that bug.
    function silenceTimeout() { settled = true; }

    client = attachLifecycle(buildClient(), markSettled);
    startConnectHeartbeat();

    // If initialize() itself rejects (Puppeteer failed to launch Chrome at all),
    // surface that immediately rather than waiting out the full stall timeout.
    // If it RESOLVES, that alone does not mean "ready" — the library's
    // initialize() timing relative to the qr/ready events is not a contract we
    // rely on — so a successful resolution becomes a promise that never
    // settles, leaving qr/ready/disconnected as the only things that can win.
    const initErrorPromise = client.initialize().then(
      () => new Promise(() => {}),
      (err) => { silenceTimeout(); throw err; }
    );
    const timeoutPromise = sleep(readyTimeoutMs).then(() => {
      if (!settled) throw new Error('stalled: no qr/ready/disconnected within timeout');
    });

    try {
      await Promise.race([settledPromise, timeoutPromise, initErrorPromise]);
    } catch (err) {
      stopConnectHeartbeat();
      // Tear the browser down before giving up. Without this, the Chrome this
      // attempt spawned outlives the failure and keeps holding the session
      // profile, so each retry stalls harder than the last — observed in the
      // field as 10+ orphaned chrome.exe from a single crash-restart loop.
      try {
        if (client) await client.destroy();
      } catch (destroyErr) {
        // destroy() on a half-initialized client can itself throw; the original
        // startup error is the one worth surfacing.
      }
      client = null;
      lock.releaseLock(lockPath);
      // The confirmed fix for the silent-hang failure mode (see
      // sessionCacheClean.js) — cheap, and never requires a re-pair.
      try { clearCache(sessionProfileDir); } catch (e) { /* best effort */ }
      backoff.recordConnectFailure(backoffPath);
      setState('disconnected');
      lastError = err.message;
      throw err;
    }
    stopConnectHeartbeat();
  }

  // Single teardown path shared by stop/reset/recover. Each of these previously
  // tore down differently (or not at all), which is how the orphaned-Chrome and
  // locked-profile failures kept reappearing in new forms.
  async function teardown({ logout = false } = {}) {
    stopConnectHeartbeat();
    if (client) {
      if (logout) {
        try {
          await client.logout();
        } catch (e) {
          // logout() throws whenever the client never reached 'ready' — i.e.
          // precisely when someone reaches for the re-pair button. Always
          // best-effort; the credential purge below is what actually matters.
        }
      }
      // logout() leaves Puppeteer's browser running. Without destroy() the old
      // Chrome keeps the LocalAuth profile locked, the rebuilt client can never
      // initialize, and orphaned chrome.exe accumulate.
      try {
        await client.destroy();
      } catch (e) {
        // destroy() on a half-initialized client can itself throw.
      }
    }
    client = null;
    lastQr = null;
    number = null;
    lock.releaseLock(lockPath);
  }

  // One retry mechanism for every way the connection can be lost — first start,
  // dropped session, failed repair. Previously only the very first start had a
  // retry, so every later failure was terminal until a human intervened.
  function scheduleRetry() {
    if (retryTimer) return;
    const { failCount } = backoff.readBackoffState(backoffPath);
    const delay = backoff.nextDelayMs(failCount) || backoff.BACKOFF_BASE_MS;
    log(`WhatsApp unavailable (${lastError}); retrying in ${Math.round(delay / 60000)} min`);
    retryTimer = setTimeoutImpl(() => {
      retryTimer = null;
      api.recover('scheduled retry').catch(() => {});
    }, delay);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  const api = {
    async start() {
      // Resume any cooldown still owed from a previous process's failures.
      const wait = backoff.remainingCooldownMs(backoffPath);
      if (wait > 0) {
        log(`Backing off ${Math.round(wait / 1000)}s before connecting`);
        await sleep(wait);
      }
      try {
        await attemptStart();
      } catch (err) {
        lastError = err.message;
        // Critically: do NOT exit the process. The notify server, the admin
        // alert channel and the daily digest must survive WhatsApp being down —
        // when startNotifyServer() only ran on 'ready', a WhatsApp outage also
        // silenced the very channel the watchdog uses to report it.
        scheduleRetry();
        return { ok: false, error: err.message };
      }
      return { ok: true, state };
    },

    async stop() {
      api.cancelRetry();
      await teardown();
      setState('disconnected');
    },

    // Rebuild a dead browser WITHOUT touching stored credentials. Usually
    // reconnects silently with no QR and no human at all — the whole point:
    // a detached frame should cost the shop nothing.
    async recover(reason) {
      if (recovering) return { ok: false, error: 'already recovering' };
      recovering = true;
      api.cancelRetry();
      lastError = reason || 'connection lost';
      setState('starting');
      log(`Repairing WhatsApp connection: ${lastError}`);
      try {
        await teardown();
        await attemptStart();
        return { ok: true, state };
      } catch (err) {
        lastError = err.message;
        setState('disconnected');
        // Without this the service gives up permanently after a single failed
        // repair — a thirty-second blip during recovery would leave WhatsApp
        // dead until a human noticed. Keep trying on the escalating backoff.
        scheduleRetry();
        return { ok: false, error: err.message };
      } finally {
        recovering = false;
      }
    },

    // Purge credentials and force a fresh QR. Only for when the pairing itself
    // is bad — recover() handles everything else without involving a phone.
    async reset() {
      api.cancelRetry();
      await teardown({ logout: true });
      setState('starting');
      lastError = null;
      // A logout() that threw leaves stored credentials in place, so the rebuilt
      // client silently resumes the same broken session instead of issuing a
      // fresh QR. Purging is what makes this equivalent to the manual "rename
      // the session dir and restart" recovery, with nobody remoting in.
      if (purgeSession) {
        try { purgeSession(sessionProfileDir); } catch (e) { log('purge failed: ' + e.message); }
      }
      try {
        await attemptStart();
        return { ok: true, state };
      } catch (err) {
        lastError = err.message;
        setState('disconnected');
        scheduleRetry();
        return { ok: false, error: err.message };
      }
    },

    cancelRetry() {
      if (retryTimer) clearTimeoutImpl(retryTimer);
      retryTimer = null;
    },

    // Called by the send path when a message fails. A dead-session error flips
    // the bot out of its lying "connected" state and kicks off a background
    // rebuild, so the next send works instead of failing identically forever.
    noteSendFailure(message) {
      if (!isFatalSessionError(message)) return false;
      if (recovering) return true;
      setState('disconnected');
      lastError = message;
      log(`Fatal session error on send — self-healing: ${message}`);
      // Deliberately not awaited: the caller is an HTTP request that should
      // return its error to the dashboard immediately, not block for a restart.
      Promise.resolve().then(() => api.recover(message)).catch(() => {});
      return true;
    },

    getStatus() {
      return { state, number, lastError, recovering };
    },
    getQr() { return lastQr; },
    getClient() { return client; },
    getBrowser() { return client ? client.pupBrowser : null; },
  };

  return api;
}

module.exports = { createConnection };
