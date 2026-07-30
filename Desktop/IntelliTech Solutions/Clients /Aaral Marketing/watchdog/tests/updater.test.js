const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdate } = require('../src/updater');

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
