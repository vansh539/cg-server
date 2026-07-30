const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { checkForUpdate, applyUpdate, LOCK_FILE } = require('../src/updater');

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
