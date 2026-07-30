const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { checkForUpdate, applyUpdate, LOCK_FILE, writeLock } = require('../src/updater');

test.afterEach(() => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });

test('checkForUpdate reports up to date when local HEAD matches origin/main', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'abc1234567';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'abc1234567';
    return '';
  };
  const result = await checkForUpdate({ repoRoot: '/fake/repo', run });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.currentVersion, 'abc1234');
  assert.ok(calls.some((c) => c.includes('fetch origin main')));
});

test('checkForUpdate reports commits behind when origin/main is ahead', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const run = async (cmd, args) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return 'aaa1111111';
    if (args.includes('rev-parse') && args.includes('origin/main')) return 'bbb2222222';
    if (args.includes('rev-list')) return '3';
    return '';
  };
  const result = await checkForUpdate({ repoRoot: '/fake/repo', run });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.currentVersion, 'aaa1111');
  assert.equal(result.latestVersion, 'bbb2222');
  assert.equal(result.commitsBehind, 3);
});

test('applyUpdate pulls, installs, migrates, restarts, verifies health, and clears the lock on success', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const commands = [];
  const run = async (cmd, args) => {
    commands.push([cmd, ...args].join(' '));
    if (args.includes('rev-parse')) return 'abc1234567';
    return '';
  };
  const restarted = [];
  const restartApps = async (names) => { restarted.push(...names); };
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, true);
  assert.deepEqual(restarted, ['aaral-dashboard', 'aaral-bridge']);
  assert.ok(commands.some((c) => c.includes('pull origin main')));
  assert.ok(commands.some((c) => c.includes('npm run migrate')));
  assert.equal(fs.existsSync(LOCK_FILE), false);
});

test('applyUpdate rolls back to the previous commit when migration fails', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  // migrateDirs has 2 entries (dashboard, whatsapp-bot), so the forward
  // attempt's very first migrate call (dashboard) is call #1 — make only
  // that one fail, so rollback's own migrate calls (#2, #3) succeed.
  let migrateCallCount = 0;
  const run = async (cmd, args) => {
    if (args[0] === 'rev-parse') return 'aaa1111111';
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'migrate') {
      migrateCallCount += 1;
      if (migrateCallCount === 1) throw new Error('migration failed: syntax error');
      return '';
    }
    return '';
  };
  const restarted = [];
  const restartApps = async (names) => { restarted.push(names); };
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  // The forward attempt fails on its first migrate call, before it ever
  // reaches the restart step — so restartApps is called exactly once,
  // from inside rollback, not twice.
  assert.equal(restarted.length, 1);
  assert.equal(fs.existsSync(LOCK_FILE), false);
});

test('applyUpdate reports rollbackError when rollback itself fails', async () => {
  process.env.GITHUB_PAT = 'fake-token';
  const run = async (cmd, args) => {
    if (args[0] === 'rev-parse') return 'aaa1111111';
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'migrate') throw new Error('migration failed');
    if (args[0] === 'reset') throw new Error('git reset failed: dirty working tree');
    return '';
  };
  const restartApps = async () => {};
  const checkHealth = async () => true;

  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps, checkHealth, healthTimeoutMs: 200, healthPollMs: 10 });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.match(result.rollbackError, /git reset failed/);
});

test('applyUpdate rejects a second call while one is already in progress', async () => {
  writeLock({ previousCommit: 'zzz', step: 'pulling', startedAt: new Date().toISOString() });
  const run = async () => '';
  const result = await applyUpdate({ repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true });
  assert.deepEqual(result, { ok: false, reason: 'update-already-in-progress' });
});

const { recoverInterruptedUpdate } = require('../src/updater');

test('recoverInterruptedUpdate does nothing when there is no lock file', async () => {
  const notified = [];
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run: async () => '', restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.equal(notified.length, 0);
});

test('recoverInterruptedUpdate rolls back and alerts when a stale lock is found', async () => {
  writeLock({ previousCommit: 'aaa1111111', step: 'installing', startedAt: new Date().toISOString() });
  const notified = [];
  const run = async () => '';
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.equal(fs.existsSync(LOCK_FILE), false);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /interrupted/i);
  assert.match(notified[0], /auto-recovered/i);
});

test('recoverInterruptedUpdate sends an urgent alert when rollback itself fails', async () => {
  writeLock({ previousCommit: 'aaa1111111', step: 'installing', startedAt: new Date().toISOString() });
  const notified = [];
  const run = async (cmd, args) => { if (args[0] === 'reset') throw new Error('disk full'); return ''; };
  await recoverInterruptedUpdate({
    repoRoot: '/fake/repo', run, restartApps: async () => {}, checkHealth: async () => true,
    notifyAdmins: async (msg) => notified.push(msg),
  });
  assert.match(notified[0], /recovery FAILED/i);
  assert.match(notified[0], /disk full/);
});
