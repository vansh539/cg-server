'use strict';
const express = require('express');
const { requirePin } = require('../adminAuth');

const router = express.Router();
const WATCHDOG_URL = process.env.WATCHDOG_URL || 'http://127.0.0.1:5003';

router.get('/updates/check', async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/check`, { signal: AbortSignal.timeout(15000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

router.get('/updates/status', async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/status`, { signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

router.post('/updates/apply', requirePin, async (_req, res) => {
  try {
    const r = await fetch(`${WATCHDOG_URL}/update/apply`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: `Could not reach the update service: ${err.message}` });
  }
});

module.exports = router;
