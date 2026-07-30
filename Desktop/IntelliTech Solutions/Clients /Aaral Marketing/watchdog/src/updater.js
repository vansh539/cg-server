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

module.exports = { LOCK_FILE, runCommand, gitAuthArgs, readLock, writeLock, clearLock, checkForUpdate };
