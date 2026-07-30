'use strict';
const http = require('http');
const path = require('path');
const updater = require('./updater');

const UPDATE_SERVICE_PORT = process.env.UPDATE_SERVICE_PORT || 5003;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let currentStatus = { state: 'idle' };

function startUpdateServer({ restartApps, checkHealth, notifyAdmins }) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/update/check') {
      updater.checkForUpdate({ repoRoot: REPO_ROOT })
        .then((result) => { res.writeHead(200); res.end(JSON.stringify(result)); })
        .catch((err) => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
      return;
    }

    if (req.method === 'GET' && req.url === '/update/status') {
      res.writeHead(200);
      res.end(JSON.stringify(currentStatus));
      return;
    }

    if (req.method === 'POST' && req.url === '/update/apply') {
      if (currentStatus.state === 'running') {
        res.writeHead(409);
        res.end(JSON.stringify({ ok: false, reason: 'update-already-in-progress' }));
        return;
      }
      currentStatus = { state: 'running', startedAt: new Date().toISOString() };
      res.writeHead(202);
      res.end(JSON.stringify({ ok: true, started: true }));

      updater.applyUpdate({ repoRoot: REPO_ROOT, restartApps, checkHealth })
        .then((result) => {
          currentStatus = { state: result.ok ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), result };
          if (result.ok) {
            notifyAdmins(`✅ *Aaral updated* to commit ${result.newCommit.slice(0, 7)}.`);
          } else if (result.rolledBack) {
            notifyAdmins(`⚠️ *Aaral update failed* (${result.reason}) — rolled back to the previous version successfully.`);
          } else {
            notifyAdmins(`🚨 *Aaral update failed AND rollback failed* — needs manual attention on the office PC. Reason: ${result.rollbackError}`);
          }
        })
        .catch((err) => {
          currentStatus = { state: 'failed', finishedAt: new Date().toISOString(), result: { ok: false, reason: err.message } };
        });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (err) => {
    console.error('[UpdateServer] Failed to start:', err.message);
  });
  server.listen(UPDATE_SERVICE_PORT, '127.0.0.1', () => {
    console.log(`[UpdateServer] Listening on 127.0.0.1:${UPDATE_SERVICE_PORT}`);
  });
  return server;
}

module.exports = { startUpdateServer };
