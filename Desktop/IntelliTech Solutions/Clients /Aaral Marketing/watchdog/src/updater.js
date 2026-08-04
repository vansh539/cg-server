'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const LOCK_FILE = path.join(__dirname, '..', '.update-lock.json');

// A long-running Windows service (this watchdog runs as one, under SYSTEM)
// can end up with a stale/incomplete PATH regardless of what's actually
// registered machine-wide -- confirmed live: `npm` resolved fine for an
// interactive user but ENOENT'd here. Every Node install ships npm.cmd in
// the same directory as node.exe, so deriving it from process.execPath
// sidesteps PATH lookup for npm entirely, on any account, permanently.
// git isn't included here because it hasn't shown this failure mode.
const NPM_CMD = process.platform === 'win32'
  ? path.join(path.dirname(process.execPath), 'npm.cmd')
  : 'npm';

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    // shell:true is required on Windows to execFile a .cmd (npm.cmd) at all
    // -- Node hardened child_process against CVE-2024-27980 by refusing to
    // spawn .bat/.cmd files directly, even by absolute path, without it.
    // Safe here: every arg passed through this codebase is an internally
    // constructed literal (git subcommands, commit hashes, 'install'/
    // '--omit=dev'/'run'/'migrate'), never unsanitized external input.
    const opts = { cwd, windowsHide: true, timeout: 5 * 60 * 1000, shell: process.platform === 'win32' };
    execFile(cmd, args, opts, (err, stdout, stderr) => {
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
      await run(NPM_CMD, ['install', '--omit=dev'], path.join(repoRoot, dir));
    }
    for (const dir of migrateDirs) {
      await run(NPM_CMD, ['run', 'migrate'], path.join(repoRoot, dir));
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

  let previousCommit;
  try {
    previousCommit = await run('git', ['rev-parse', 'HEAD'], repoRoot);
    writeLock({ previousCommit, step: 'starting', startedAt: new Date().toISOString() });
  } catch (err) {
    // Nothing was touched yet, so there's nothing to roll back -- the site is unaffected.
    return { ok: false, reason: err.message, rolledBack: true, notStarted: true };
  }

  try {
    writeLock({ previousCommit, step: 'pulling', startedAt: new Date().toISOString() });
    await run('git', [...gitAuthArgs(), 'pull', 'origin', 'main'], repoRoot);

    writeLock({ previousCommit, step: 'installing', startedAt: new Date().toISOString() });
    for (const dir of npmDirs) {
      await run(NPM_CMD, ['install', '--omit=dev'], path.join(repoRoot, dir));
    }

    writeLock({ previousCommit, step: 'migrating', startedAt: new Date().toISOString() });
    for (const dir of migrateDirs) {
      await run(NPM_CMD, ['run', 'migrate'], path.join(repoRoot, dir));
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

async function recoverInterruptedUpdate({ repoRoot, run = runCommand, restartApps, checkHealth, notifyAdmins }) {
  const lock = readLock();
  if (!lock) return;

  const result = await rollbackTo(lock.previousCommit, {
    repoRoot, run,
    npmDirs: DEFAULT_NPM_DIRS, migrateDirs: DEFAULT_MIGRATE_DIRS, watchedApps: DEFAULT_WATCHED_APPS,
    restartApps, checkHealth, healthTimeoutMs: 60000, healthPollMs: 3000,
  });
  clearLock();

  if (result.ok) {
    await notifyAdmins(
      `⚠️ *Aaral update was interrupted* (likely a power loss) while updating past commit ${lock.previousCommit.slice(0, 7)}. Auto-recovered successfully.`
    );
  } else {
    await notifyAdmins(
      `🚨 *Aaral update recovery FAILED* after an interruption — needs manual attention on the office PC. Reason: ${result.reason}`
    );
  }
}

module.exports = {
  LOCK_FILE, runCommand, gitAuthArgs, readLock, writeLock, clearLock, checkForUpdate,
  applyUpdate, waitForHealth, DEFAULT_NPM_DIRS, DEFAULT_MIGRATE_DIRS, DEFAULT_WATCHED_APPS,
  recoverInterruptedUpdate,
};
