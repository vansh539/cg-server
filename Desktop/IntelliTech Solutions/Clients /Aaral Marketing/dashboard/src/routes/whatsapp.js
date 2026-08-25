const express = require('express');
const { waStatus, waQr, waRepair } = require('../notify');
const { requireAdmin } = require('../sessionAuth');
const { logActivity } = require('../activityLog');

const router = express.Router();

// Read-only — any logged-in staff member can see whether WhatsApp is working.
// Knowing *before* you promise a customer their invoice is the whole point.
router.get('/whatsapp/status', async (req, res) => {
  res.json(await waStatus());
});

router.get('/whatsapp/qr', async (req, res) => {
  res.json(await waQr());
});

// Repair keeps the existing pairing and needs no phone — safe enough for any
// staff member, and it is what fixes the overwhelmingly common case.
router.post('/whatsapp/repair', async (req, res) => {
  const result = await waRepair({ repair: true });
  await logActivity(req, 'repaired WhatsApp connection', result.ok ? 'succeeded' : `failed: ${result.error || 'unknown'}`);
  res.json(result);
});

// Re-pair PURGES the stored credentials and forces a fresh QR scan. Admin-only
// and deliberately separate: reaching for this when a plain repair would have
// done costs a trip to wherever the client's phone is.
router.post('/whatsapp/repair-full', requireAdmin, async (req, res) => {
  const result = await waRepair({ repair: false });
  await logActivity(req, 're-paired WhatsApp (fresh QR)', result.ok ? 'succeeded' : `failed: ${result.error || 'unknown'}`);
  res.json(result);
});

module.exports = router;
