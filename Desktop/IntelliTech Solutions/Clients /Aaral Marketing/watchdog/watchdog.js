/**
 * Aaral office-server watchdog. Runs as its own PM2 app alongside
 * aaral-bridge/aaral-dashboard on the same machine. Two independent layers:
 *
 * 1. Heartbeat — pushes a check-in to the Jalan Group backend every few
 *    minutes. If this whole box loses power/network, the beats stop and
 *    heartbeatMonitor.js (on the Jalan Group side, a different physical
 *    machine) alerts the owner over WhatsApp. This process can't alert
 *    anyone itself during a real outage — that's the point of the
 *    external check.
 * 2. Crash-loop alert — listens to the local PM2 bus for aaral-bridge/
 *    aaral-dashboard restarting repeatedly in a short window (both apps
 *    are configured with effectively unlimited restarts, so they never
 *    reach PM2's own "errored" state — this is what actually catches a
 *    real crash-loop while the box itself is still up). Alerts via the
 *    bot's local /notify-admins endpoint, no customer-facing number
 *    involved.
 */
require('dotenv').config();
const pm2 = require('pm2');
const path = require('path');
const { startUpdateServer } = require('./src/updateServer');
const { recoverInterruptedUpdate } = require('./src/updater');

const REPO_ROOT = path.resolve(__dirname, '..');
const HEALTH_URLS = {
  'aaral-dashboard': process.env.DASHBOARD_HEALTH_URL || 'http://127.0.0.1:3400/health',
  'aaral-bridge': process.env.BRIDGE_HEALTH_URL || 'http://127.0.0.1:5002/health',
};

function restartApps(names) {
  return Promise.all(names.map((name) => new Promise((resolve, reject) => {
    pm2.restart(name, (err) => (err ? reject(err) : resolve()));
  })));
}

async function checkHealth(appName) {
  try {
    const res = await fetch(HEALTH_URLS[appName], { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

const HEARTBEAT_URL = process.env.HEARTBEAT_URL || 'https://api.vanshiron.com/heartbeat/aaral';
const HEARTBEAT_INTERVAL_MIN = parseInt(process.env.HEARTBEAT_INTERVAL_MIN || '5', 10);
const NOTIFY_ADMINS_URL = process.env.NOTIFY_ADMINS_URL || 'http://127.0.0.1:5002/notify-admins';
const WATCHED_APPS = (process.env.WATCHED_APPS || 'aaral-bridge,aaral-dashboard').split(',');
const RESTART_WINDOW_MIN = parseInt(process.env.RESTART_WINDOW_MIN || '10', 10);
const RESTART_LOOP_THRESHOLD = parseInt(process.env.RESTART_LOOP_THRESHOLD || '3', 10);
const REALERT_MINUTES = parseInt(process.env.REALERT_MINUTES || '30', 10);
const QUIET_MINUTES_FOR_RECOVERY = parseInt(process.env.QUIET_MINUTES_FOR_RECOVERY || '10', 10);

// Per-app in-memory tracking — this process itself is PM2-managed with the
// same "restart forever" policy, so a restart of the watchdog just means a
// short gap in tracking, not a stuck alert state.
const restartLog = {}; // appName -> array of Date.now() timestamps
const alertState = {}; // appName -> { alerted: bool, lastAlertedAt: number }

async function notifyAdmins(message) {
  try {
    await fetch(NOTIFY_ADMINS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  } catch (err) {
    console.error('[Watchdog] Failed to reach local notify-admins endpoint:', err.message);
  }
}

// The bridge's /health now reports the real WhatsApp state (it used to report
// nothing, because the whole HTTP server only bound once WhatsApp had already
// connected — so a WhatsApp outage made the service look completely dead and
// silenced the very channel used to report it).
async function readWaState() {
  try {
    const res = await fetch(HEALTH_URLS['aaral-bridge'], { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    return body && body.wa ? body.wa : null;
  } catch (_) {
    return null;
  }
}

async function sendHeartbeat() {
  try {
    // Riding the WhatsApp state along on the heartbeat gives an OUT-OF-BAND
    // signal. Alerting about a dead WhatsApp over WhatsApp is circular; the
    // heartbeat lands on a different machine entirely, so this is the one
    // channel that still works when WhatsApp here is the thing that is broken.
    const wa = await readWaState();
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostname: require('os').hostname(),
        uptimeSec: Math.floor(process.uptime()),
        whatsapp: wa ? { state: wa.state, recovering: wa.recovering, lastError: wa.lastError } : { state: 'unknown' },
      }),
    });
  } catch (err) {
    // Expected during a real network/power outage — heartbeatMonitor.js on
    // the receiving end is exactly what catches this, nothing to alert on
    // locally since we may not have connectivity to alert with anyway.
    console.error('[Watchdog] Heartbeat send failed:', err.message);
  }
}

function checkRestartLoops() {
  const now = Date.now();
  for (const app of WATCHED_APPS) {
    const timestamps = (restartLog[app] || []).filter(t => now - t < RESTART_WINDOW_MIN * 60 * 1000);
    restartLog[app] = timestamps;
    const state = alertState[app] || { alerted: false, lastAlertedAt: 0 };

    if (timestamps.length >= RESTART_LOOP_THRESHOLD) {
      const minutesSinceAlert = (now - state.lastAlertedAt) / 60000;
      if (!state.alerted || minutesSinceAlert >= REALERT_MINUTES) {
        notifyAdmins(
          `⚠️ *${app} is crash-looping*\n\nRestarted ${timestamps.length} times in the last ${RESTART_WINDOW_MIN} minutes. May need attention on the office PC.`
        );
        alertState[app] = { alerted: true, lastAlertedAt: now };
      }
    } else if (state.alerted && timestamps.length === 0) {
      // No restarts logged for a full window — but only declare recovery
      // after an additional quiet period, so we don't flip-flop right at
      // the edge of the tracking window.
      const lastRestart = state.lastRestartAt || 0;
      if (now - lastRestart > QUIET_MINUTES_FOR_RECOVERY * 60 * 1000) {
        notifyAdmins(`✅ *${app} has stabilized* — no restarts in the last ${QUIET_MINUTES_FOR_RECOVERY} minutes.`);
        alertState[app] = { alerted: false, lastAlertedAt: 0 };
      }
    }
  }
}

pm2.connect(err => {
  if (err) {
    console.error('[Watchdog] Could not connect to local PM2 daemon:', err.message);
    process.exit(1);
  }

  pm2.launchBus((err, bus) => {
    if (err) {
      console.error('[Watchdog] Could not attach to PM2 bus:', err.message);
      return;
    }
    bus.on('process:event', packet => {
      if (packet.event !== 'restart') return;
      const name = packet.process?.name;
      if (!WATCHED_APPS.includes(name)) return;
      restartLog[name] = restartLog[name] || [];
      restartLog[name].push(Date.now());
      if (!alertState[name]) alertState[name] = { alerted: false, lastAlertedAt: 0 };
      alertState[name].lastRestartAt = Date.now();
    });
    console.log('[Watchdog] Attached to PM2 bus, watching:', WATCHED_APPS.join(', '));
  });

  recoverInterruptedUpdate({ repoRoot: REPO_ROOT, restartApps, checkHealth, notifyAdmins })
    .then(() => {
      startUpdateServer({ restartApps, checkHealth, notifyAdmins });
    })
    .catch((recoveryErr) => {
      console.error('[Watchdog] Interrupted-update recovery threw unexpectedly:', recoveryErr.message);
      startUpdateServer({ restartApps, checkHealth, notifyAdmins });
    });
});

setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MIN * 60 * 1000);
setInterval(checkRestartLoops, 60 * 1000);
sendHeartbeat();

console.log(`[Watchdog] Heartbeat → ${HEARTBEAT_URL} every ${HEARTBEAT_INTERVAL_MIN}min`);
console.log(`[Watchdog] Crash-loop alert threshold: ${RESTART_LOOP_THRESHOLD} restarts / ${RESTART_WINDOW_MIN}min`);
