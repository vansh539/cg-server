const fs = require('fs');
const path = require('path');

// ── Reconnect backoff state ─────────────────────────────────────
// Extracted verbatim (semantics unchanged) from bot.js so the connection
// lifecycle can be unit-tested without loading the whole bot, which pulls in
// Postgres and the OCR sidecar.
//
// WhatsApp Web silently soft-throttles reconnects attempted too close together:
// client.initialize() just never resolves or rejects (confirmed live — no
// 'ready', 'disconnected', 'auth_failure', or unhandled rejection ever fires,
// only the startup watchdog after 3 min). PM2's own restart delay can't back
// this off, because each failed attempt runs the full 3 minutes — well past
// min_uptime — so PM2 sees a "stable" run, not a crash loop.
//
// Base is 10 min, not something small like 15s: live testing on 2026-07-11
// showed every reconnect attempted within a ~15 min gap of a prior one failed
// (3/3), while gaps of 20+ min succeeded every time observed.
const BACKOFF_BASE_MS = 10 * 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;

function readBackoffState(statePath, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(statePath, 'utf8'));
    if (typeof parsed.failCount !== 'number') return { failCount: 0, lastAttemptAt: 0 };
    return parsed;
  } catch (e) {
    return { failCount: 0, lastAttemptAt: 0 };
  }
}

function writeBackoffState(statePath, state, fsImpl = fs, log = () => {}) {
  try {
    fsImpl.mkdirSync(path.dirname(statePath), { recursive: true });
    fsImpl.writeFileSync(statePath, JSON.stringify(state));
  } catch (e) {
    log('Failed to persist reconnect backoff state: ' + e.message);
  }
}

function recordConnectFailure(statePath, fsImpl = fs, now = Date.now()) {
  const state = readBackoffState(statePath, fsImpl);
  const next = { failCount: state.failCount + 1, lastAttemptAt: now };
  writeBackoffState(statePath, next, fsImpl);
  return next;
}

function recordConnectSuccess(statePath, fsImpl = fs, now = Date.now()) {
  const reset = { failCount: 0, lastAttemptAt: now };
  writeBackoffState(statePath, reset, fsImpl);
  return reset;
}

// How long to wait before the *next* attempt, given how many have failed.
function nextDelayMs(failCount) {
  if (failCount <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failCount - 1), BACKOFF_MAX_MS);
}

// Remaining cooldown right now, accounting for time already elapsed since the
// last attempt — so a process that was restarted mid-cooldown resumes the
// cooldown rather than restarting it.
function remainingCooldownMs(statePath, fsImpl = fs, now = Date.now()) {
  const state = readBackoffState(statePath, fsImpl);
  if (state.failCount === 0) return 0;
  const remaining = nextDelayMs(state.failCount) - (now - state.lastAttemptAt);
  return remaining > 0 ? remaining : 0;
}

module.exports = {
  readBackoffState,
  writeBackoffState,
  recordConnectFailure,
  recordConnectSuccess,
  nextDelayMs,
  remainingCooldownMs,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
};
