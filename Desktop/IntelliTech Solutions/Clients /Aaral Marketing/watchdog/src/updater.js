'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const LOCK_FILE = path.join(__dirname, '..', '.update-lock.json');

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, windowsHide: true, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

function gitAuthArgs() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error('GITHUB_PAT is not set');
  const header = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${header}`];
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}
function writeLock(data) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify(data, null, 2));
}
function clearLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

async function checkForUpdate({ repoRoot, run = runCommand }) {
  await run('git', [...gitAuthArgs(), 'fetch', 'origin', 'main'], repoRoot);
  const local = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  const remote = await run('git', ['rev-parse', 'origin/main'], repoRoot);
  if (local === remote) {
    return { updateAvailable: false, currentVersion: local.slice(0, 7) };
  }
  const commitCount = await run('git', ['rev-list', '--count', `${local}..${remote}`], repoRoot);
  return {
    updateAvailable: true,
    currentVersion: local.slice(0, 7),
    latestVersion: remote.slice(0, 7),
    commitsBehind: Number(commitCount),
  };
}

const DEFAULT_NPM_DIRS = ['dashboard', 'whatsapp-bot', 'payment-ledger-core'];
const DEFAULT_MIGRATE_DIRS = ['dashboard', 'whatsapp-bot'];
const DEFAULT_WATCHED_APPS = ['aaral-dashboard', 'aaral-bridge'];

async function waitForHealth(watchedApps, checkHealth, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(watchedApps.map(checkHealth));
    if (results.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function rollbackTo(commit, { repoRoot, run, npmDirs, migrateDirs, restartApps, checkHealth, watchedApps, healthTimeoutMs, healthPollMs }) {
  try {
    await run('git', ['reset', '--hard', commit], repoRoot);
    for (const dir of npmDirs) {
      await run('npm', ['install', '--omit=dev'], path.join(repoRoot, dir));
    }
    for (const dir of migrateDirs) {
      await run('npm', ['run', 'migrate'], path.join(repoRoot, dir));
    }
    await restartApps(watchedApps);
    const healthy = await waitForHealth(watchedApps, checkHealth, healthTimeoutMs, healthPollMs);
    if (!healthy) return { ok: false, reason: 'apps unhealthy after rollback' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function applyUpdate({
  repoRoot,
  run = runCommand,
  restartApps,
  checkHealth,
  npmDirs = DEFAULT_NPM_DIRS,
  migrateDirs = DEFAULT_MIGRATE_DIRS,
  watchedApps = DEFAULT_WATCHED_APPS,
  healthTimeoutMs = 60000,
  healthPollMs = 3000,
}) {
  if (readLock()) {
    return { ok: false, reason: 'update-already-in-progress' };
  }

  const previousCommit = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  writeLock({ previousCommit, step: 'starting', startedAt: new Date().toISOString() });

  try {
    writeLock({ previousCommit, step: 'pulling', startedAt: new Date().toISOString() });
    await run('git', [...gitAuthArgs(), 'pull', 'origin', 'main'], repoRoot);

    writeLock({ previousCommit, step: 'installing', startedAt: new Date().toISOString() });
    for (const dir of npmDirs) {
      await run('npm', ['install', '--omit=dev'], path.join(repoRoot, dir));
    }

    writeLock({ previousCommit, step: 'migrating', startedAt: new Date().toISOString() });
    for (const dir of migrateDirs) {
      await run('npm', ['run', 'migrate'], path.join(repoRoot, dir));
    }

    writeLock({ previousCommit, step: 'restarting', startedAt: new Date().toISOString() });
    await restartApps(watchedApps);

    const healthy = await waitForHealth(watchedApps, checkHealth, healthTimeoutMs, healthPollMs);
    if (!healthy) throw new Error('apps did not report healthy in time');

    const newCommit = await run('git', ['rev-parse', 'HEAD'], repoRoot);
    clearLock();
    return { ok: true, previousCommit, newCommit };
  } catch (err) {
    const rollback = await rollbackTo(previousCommit, {
      repoRoot, run, npmDirs, migrateDirs, restartApps, checkHealth, watchedApps, healthTimeoutMs, healthPollMs,
    });
    clearLock();
    return { ok: false, reason: err.message, rolledBack: rollback.ok, rollbackError: rollback.ok ? null : rollback.reason };
  }
}

module.exports = {
  LOCK_FILE, runCommand, gitAuthArgs, readLock, writeLock, clearLock, checkForUpdate,
  applyUpdate, waitForHealth, DEFAULT_NPM_DIRS, DEFAULT_MIGRATE_DIRS, DEFAULT_WATCHED_APPS,
};
