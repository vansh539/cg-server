const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { createConnection } = require('../src/whatsapp/connection');
const { createHealthMonitor } = require('../src/whatsapp/healthMonitor');
const { isFatalSessionError, withTimeout } = require('../src/whatsapp/sessionErrors');
const lockModule = require('../src/whatsapp/lock');
const backoffModule = require('../src/whatsapp/backoff');

// ── Fakes ───────────────────────────────────────────────────────
// A stand-in for whatsapp-web.js's Client. `behaviour` decides which lifecycle
// event (if any) fires after initialize(), which is how each failure mode in
// the field gets reproduced deterministically.
function makeFakeClient(behaviour = 'ready', opts = {}) {
  const handlers = {};
  const calls = { initialize: 0, destroy: 0, logout: 0 };
  const client = {
    calls,
    info: { wid: { user: '919999999999' } },
    pupBrowser: {},
    pupPage: null,
    on(event, fn) { handlers[event] = fn; return client; },
    emit(event, ...args) { return handlers[event] ? handlers[event](...args) : undefined; },
    async initialize() {
      calls.initialize += 1;
      if (behaviour === 'init-throws') throw new Error(opts.error || 'Failed to launch the browser process');
      // Fire on a later turn so the race in attemptStart() is genuinely a race.
      if (behaviour === 'ready') setImmediate(() => client.emit('ready'));
      if (behaviour === 'qr') setImmediate(() => client.emit('qr', 'FAKE-QR-STRING'));
      // 'stall' deliberately fires nothing at all.
    },
    async destroy() {
      calls.destroy += 1;
      if (opts.destroyThrows) throw new Error('destroy exploded');
    },
    async logout() {
      calls.logout += 1;
      if (opts.logoutThrows) throw new Error('Cannot logout: not connected');
    },
  };
  return client;
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aaral-${label}-`));
}

// Builds a connection with everything slow or global stubbed out.
function makeHarness(overrides = {}) {
  const dir = tmpDir('conn');
  const logs = [];
  const clients = [];
  const behaviours = overrides.behaviours || ['ready'];
  let buildCount = 0;

  const connection = createConnection({
    buildClient: () => {
      const behaviour = behaviours[Math.min(buildCount, behaviours.length - 1)];
      buildCount += 1;
      const c = makeFakeClient(behaviour, overrides.clientOpts || {});
      clients.push(c);
      return c;
    },
    sessionProfileDir: path.join(dir, 'session'),
    lockPath: path.join(dir, '.bot.lock'),
    backoffPath: path.join(dir, '.backoff.json'),
    readyTimeoutMs: 50,
    clearCache: () => [],
    purgeSession: overrides.purgeSession || (() => {}),
    log: (m) => logs.push(m),
    // Never actually wait: the timeout leg of the race resolves immediately,
    // and scheduled retries are captured rather than fired.
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 60))),
    setTimeoutImpl: (fn, ms) => { logs.push(`scheduled retry in ${ms}ms`); return { unref() {} }; },
    clearTimeoutImpl: () => {},
    heartbeatIntervalMs: 1e9,
    ...overrides.connectionOpts,
  });

  return { connection, logs, clients, dir, buildCount: () => buildCount };
}

// ── sessionErrors ───────────────────────────────────────────────
test('isFatalSessionError catches the real 19-Aug field error verbatim', () => {
  assert.equal(isFatalSessionError("Attempted to use detached Frame 'abc123'."), true);
});

test('isFatalSessionError catches the other dead-browser signatures', () => {
  for (const m of [
    'Protocol error (Runtime.callFunctionOn): Session closed.',
    'Target closed',
    'Execution context was destroyed, most likely because of a navigation.',
    'Browser has disconnected',
  ]) {
    assert.equal(isFatalSessionError(m), true, `should be fatal: ${m}`);
  }
});

test('isFatalSessionError does NOT fire on ordinary send failures', () => {
  // Misclassifying these would rebuild the browser over a bad phone number,
  // which is a self-inflicted outage.
  for (const m of [
    'number is not on WhatsApp',
    'phone and message are required',
    'ECONNREFUSED',
    '',
    null,
  ]) {
    assert.equal(isFatalSessionError(m), false, `should NOT be fatal: ${m}`);
  }
});

test('withTimeout rejects a promise that never settles', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20, 'WhatsApp send'),
    /WhatsApp send timed out after 0s/
  );
});

test('withTimeout passes a value through untouched when it resolves in time', async () => {
  assert.equal(await withTimeout(Promise.resolve('sent'), 1000, 'send'), 'sent');
});

// ── lock ────────────────────────────────────────────────────────
test('acquireLock refuses a second live instance', () => {
  const dir = tmpDir('lock');
  const lockPath = path.join(dir, '.bot.lock');
  assert.equal(lockModule.acquireLock(lockPath, process.pid).ok, true);
  const second = lockModule.acquireLock(lockPath, process.pid + 100000);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already running/);
});

test('acquireLock takes over a lock whose owner has died', () => {
  const dir = tmpDir('lock');
  const lockPath = path.join(dir, '.bot.lock');
  fs.mkdirSync(dir, { recursive: true });
  // PID 1 exists; use an implausible one that is definitely not running.
  fs.writeFileSync(lockPath, '999999');
  assert.equal(lockModule.acquireLock(lockPath, process.pid).ok, true);
});

test('releaseLock will NOT delete a lock held by another live process', () => {
  // This is the regression that matters most: teardown() runs before every
  // reconnect, so an unconditional release would let a second instance clear
  // the incumbent's lock and join the same session — which has caused a real
  // WhatsApp account logout on a previous project.
  const dir = tmpDir('lock');
  const lockPath = path.join(dir, '.bot.lock');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid));
  const otherPid = process.pid + 100000;
  assert.equal(lockModule.releaseLock(lockPath, otherPid), false);
  assert.equal(fs.existsSync(lockPath), true, 'lock must survive');
});

test('releaseLock clears a lock this process owns', () => {
  const dir = tmpDir('lock');
  const lockPath = path.join(dir, '.bot.lock');
  lockModule.acquireLock(lockPath, process.pid);
  assert.equal(lockModule.releaseLock(lockPath, process.pid), true);
  assert.equal(fs.existsSync(lockPath), false);
});

// ── backoff ─────────────────────────────────────────────────────
test('backoff escalates 10 → 20 → 30 min and caps there', () => {
  assert.equal(backoffModule.nextDelayMs(1), 10 * 60 * 1000);
  assert.equal(backoffModule.nextDelayMs(2), 20 * 60 * 1000);
  assert.equal(backoffModule.nextDelayMs(3), 30 * 60 * 1000);
  assert.equal(backoffModule.nextDelayMs(9), 30 * 60 * 1000);
  assert.equal(backoffModule.nextDelayMs(0), 0);
});

test('a successful connect clears the accumulated backoff', () => {
  const p = path.join(tmpDir('backoff'), 's.json');
  backoffModule.recordConnectFailure(p);
  backoffModule.recordConnectFailure(p);
  assert.equal(backoffModule.readBackoffState(p).failCount, 2);
  backoffModule.recordConnectSuccess(p);
  assert.equal(backoffModule.readBackoffState(p).failCount, 0);
  assert.equal(backoffModule.remainingCooldownMs(p), 0);
});

test('cooldown accounts for time already elapsed, so a restart resumes it', () => {
  const p = path.join(tmpDir('backoff'), 's.json');
  backoffModule.recordConnectFailure(p, fs, Date.now() - 9 * 60 * 1000);
  const remaining = backoffModule.remainingCooldownMs(p);
  // ~1 minute left of the 10-minute base delay, not a fresh 10 minutes.
  assert.ok(remaining > 0 && remaining <= 61 * 1000, `expected ~1min, got ${remaining}ms`);
});

// ── connection lifecycle ────────────────────────────────────────
test('a successful start reports connected and records the number', async () => {
  const h = makeHarness();
  const result = await h.connection.start();
  assert.equal(result.ok, true);
  const status = h.connection.getStatus();
  assert.equal(status.state, 'connected');
  assert.equal(status.number, '919999999999');
  assert.equal(status.lastError, null);
});

test('a stalled connect destroys the browser instead of orphaning Chrome', async () => {
  // Field symptom this prevents: 10+ zombie chrome.exe from a single
  // crash-restart loop, each holding the session profile so the next attempt
  // stalls harder than the last.
  const h = makeHarness({ behaviours: ['stall'] });
  const result = await h.connection.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /stalled/);
  assert.equal(h.clients[0].calls.destroy, 1, 'must destroy the stalled client');
});

test('a failed start does NOT throw and DOES schedule a retry', async () => {
  // The service must stay up so the notify server, admin alerts and daily
  // digest survive a WhatsApp outage.
  const h = makeHarness({ behaviours: ['stall'] });
  const result = await h.connection.start();
  assert.equal(result.ok, false);
  assert.ok(h.logs.some((l) => l.startsWith('scheduled retry')), 'a retry must be scheduled');
});

test('the session lock is released after a failed start so the retry can run', async () => {
  const h = makeHarness({ behaviours: ['stall'] });
  await h.connection.start();
  assert.equal(fs.existsSync(path.join(h.dir, '.bot.lock')), false);
});

test('a fatal send error flips state off connected and rebuilds the client', async () => {
  const h = makeHarness({ behaviours: ['ready', 'ready'] });
  await h.connection.start();
  assert.equal(h.connection.getStatus().state, 'connected');

  const handled = h.connection.noteSendFailure("Attempted to use detached Frame 'x'");
  assert.equal(handled, true, 'must recognise the error as fatal');

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(h.buildCount(), 2, 'a second client must have been built');
  assert.equal(h.clients[0].calls.destroy, 1, 'the dead client must be destroyed');
  assert.equal(h.connection.getStatus().state, 'connected', 'must be healthy again');
});

test('an ordinary send error is ignored — no needless browser rebuild', async () => {
  const h = makeHarness();
  await h.connection.start();
  const handled = h.connection.noteSendFailure('number is not on WhatsApp');
  assert.equal(handled, false);
  assert.equal(h.connection.getStatus().state, 'connected');
  assert.equal(h.buildCount(), 1, 'must NOT rebuild');
});

test('recover() keeps the pairing — it never purges credentials', async () => {
  let purged = 0;
  const h = makeHarness({ behaviours: ['ready', 'ready'], purgeSession: () => { purged += 1; } });
  await h.connection.start();
  const result = await h.connection.recover('test');
  assert.equal(result.ok, true);
  assert.equal(purged, 0, 'recover must not purge — that would force a needless QR scan');
});

test('reset() purges credentials and survives a logout() that throws', async () => {
  // logout() throws whenever the client never reached ready — i.e. exactly
  // when someone reaches for the re-pair button. On SMSA that throw aborted
  // the whole function, so no QR could ever appear.
  let purged = 0;
  const h = makeHarness({
    behaviours: ['ready', 'qr'],
    clientOpts: { logoutThrows: true },
    purgeSession: () => { purged += 1; },
  });
  await h.connection.start();
  const result = await h.connection.reset();
  assert.equal(purged, 1, 'reset must purge credentials even when logout throws');
  assert.equal(result.ok, true);
  assert.equal(h.connection.getStatus().state, 'qr');
  assert.equal(h.connection.getQr(), 'FAKE-QR-STRING');
});

test('a failed repair schedules another attempt rather than giving up', async () => {
  const h = makeHarness({ behaviours: ['ready', 'stall'] });
  await h.connection.start();
  h.logs.length = 0;
  const result = await h.connection.recover('test');
  assert.equal(result.ok, false);
  assert.ok(h.logs.some((l) => l.startsWith('scheduled retry')), 'must keep retrying');
});

test('concurrent repairs collapse into one', async () => {
  const h = makeHarness({ behaviours: ['ready', 'ready'] });
  await h.connection.start();
  const [a, b] = await Promise.all([h.connection.recover('a'), h.connection.recover('b')]);
  const rejected = [a, b].filter((r) => r.error === 'already recovering');
  assert.equal(rejected.length, 1, 'exactly one repair should be turned away');
});

test('initialize() rejecting surfaces immediately, without waiting out the timeout', async () => {
  const h = makeHarness({ behaviours: ['init-throws'], clientOpts: { error: 'Failed to launch the browser process' } });
  const result = await h.connection.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /Failed to launch the browser process/);
});

// ── health monitor ──────────────────────────────────────────────
test('health monitor catches a connection that only claims to be connected', async () => {
  // The exact field failure: status says connected, the page underneath is
  // dead, and every send fails identically until someone restarts it by hand.
  const noted = [];
  const monitor = createHealthMonitor({
    connection: {
      getStatus: () => ({ state: 'connected', recovering: false }),
      getClient: () => ({ getState: async () => { throw new Error('Session closed.'); } }),
      noteSendFailure: (m) => { noted.push(m); return true; },
    },
    timeoutMs: 50,
  });
  const result = await monitor.check();
  assert.equal(result.healthy, false);
  assert.equal(noted.length, 1);
  assert.match(noted[0], /Session closed/);
});

test('health monitor treats a non-CONNECTED WhatsApp state as unhealthy', async () => {
  const noted = [];
  const monitor = createHealthMonitor({
    connection: {
      getStatus: () => ({ state: 'connected', recovering: false }),
      getClient: () => ({ getState: async () => 'UNPAIRED' }),
      noteSendFailure: (m) => { noted.push(m); return true; },
    },
  });
  const result = await monitor.check();
  assert.equal(result.healthy, false);
  assert.match(noted[0], /UNPAIRED/);
});

test('health monitor stays quiet when the session is genuinely healthy', async () => {
  const noted = [];
  const monitor = createHealthMonitor({
    connection: {
      getStatus: () => ({ state: 'connected', recovering: false }),
      getClient: () => ({ getState: async () => 'CONNECTED' }),
      noteSendFailure: (m) => { noted.push(m); return true; },
    },
  });
  assert.equal((await monitor.check()).healthy, true);
  assert.equal(noted.length, 0);
});

test('health monitor does not pile on while a repair is already running', async () => {
  const noted = [];
  const monitor = createHealthMonitor({
    connection: {
      getStatus: () => ({ state: 'connected', recovering: true }),
      getClient: () => { throw new Error('should not be consulted'); },
      noteSendFailure: (m) => { noted.push(m); return true; },
    },
  });
  assert.equal((await monitor.check()).checked, false);
  assert.equal(noted.length, 0);
});

test('health monitor detects the client object vanishing under a connected state', async () => {
  const noted = [];
  const monitor = createHealthMonitor({
    connection: {
      getStatus: () => ({ state: 'connected', recovering: false }),
      getClient: () => null,
      noteSendFailure: (m) => { noted.push(m); return true; },
    },
  });
  assert.equal((await monitor.check()).healthy, false);
  assert.match(noted[0], /client object is gone/);
});
