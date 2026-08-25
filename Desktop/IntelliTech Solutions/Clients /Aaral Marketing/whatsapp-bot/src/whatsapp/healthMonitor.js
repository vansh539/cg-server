// Periodically asks WhatsApp whether it is actually still there.
//
// bot.js already had a 15-second `setInterval(() => client.getState())` — but
// its catch block was `catch (_) {}`, so it swallowed every error it could
// possibly have detected. It was a keepalive wearing a health check's clothes:
// a session could be completely dead and that loop would notice nothing,
// forever. That is precisely how a bot spends a day reporting "connected"
// while every send fails.
//
// whatsapp-web.js does not reliably fire 'disconnected' when its underlying
// Puppeteer page dies, so polling is the only way to find out. getState()
// round-trips into the page, which means it fails the same way a real send
// would — that is what makes it a meaningful probe rather than a check of our
// own local variable.
const DEFAULT_INTERVAL_MS = 120000;
const DEFAULT_TIMEOUT_MS = 20000;

function createHealthMonitor(opts) {
  const {
    connection,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    log = () => {},
  } = opts;

  let timer = null;

  async function check() {
    const status = connection.getStatus();
    // Only a connection claiming to be connected can be lying. 'qr' /
    // 'starting' / 'disconnected' are already accurate and already have their
    // own recovery path.
    if (status.state !== 'connected' || status.recovering) return { checked: false };

    const client = connection.getClient();
    if (!client) {
      connection.noteSendFailure('session closed: client object is gone');
      log('health check: client object vanished while state said connected');
      return { checked: true, healthy: false };
    }

    let timeoutHandle;
    try {
      const state = await Promise.race([
        client.getState(),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('connection closed: health probe timed out')),
            timeoutMs
          );
        }),
      ]);

      if (state && state !== 'CONNECTED') {
        connection.noteSendFailure('session closed: WhatsApp reports ' + state);
        log('health check: WhatsApp reports ' + state + ' — repairing');
        return { checked: true, healthy: false, state };
      }
      return { checked: true, healthy: true, state };
    } catch (err) {
      connection.noteSendFailure(err.message);
      log('health check failed: ' + err.message + ' — repairing');
      return { checked: true, healthy: false, error: err.message };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setIntervalImpl(() => { check().catch(() => {}); }, intervalMs);
      // Never hold the process open just for a health check.
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearIntervalImpl(timer);
      timer = null;
    },
    check,
  };
}

module.exports = { createHealthMonitor, DEFAULT_INTERVAL_MS };
