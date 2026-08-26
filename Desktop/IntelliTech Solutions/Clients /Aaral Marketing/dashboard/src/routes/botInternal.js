// Routes reachable only by the WhatsApp bot process on this same machine
// (or another process holding BOT_INTERNAL_SECRET), never by a dashboard
// session. Mounted in server.js BEFORE requireSession, alongside auth.js.
//
// Dashboard binds 0.0.0.0 for the office LAN, so a route here is reachable
// by anything on that WiFi -- the secret header is the actual gate, not the
// network binding.
const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const { fetchLedgerEntries } = require('../ledgerEntries');
const { renderLedgerPdf } = require('../ledgerPdf');
const { sanitize } = require('../invoiceFilename');
const { formatIndian, formatDate } = require('../chittiTemplate');

const router = express.Router();

function requireBotSecret(req, res, next) {
  const provided = req.get('X-Bot-Internal-Secret');
  if (!process.env.BOT_INTERNAL_SECRET || provided !== process.env.BOT_INTERNAL_SECRET) {
    return res.status(401).json({ ok: false, error: 'Not authorized' });
  }
  next();
}

router.post('/internal/bot/ledger-pdf', requireBotSecret, async (req, res) => {
  try {
    const { customerId } = req.body;
    const balance = await balances.getBalanceByCustomerId(customerId);
    if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

    const entries = await fetchLedgerEntries(customerId);
    const customer = { name: balance.name, phone_number: balance.phone_number, balance: balance.balance };
    const pdfBuffer = await renderLedgerPdf({ customer, entries });
    const filename = `Ledger-${sanitize(customer.name) || 'Customer'}.pdf`;
    const balanceLine = `${customer.name} — balance as of ${formatDate()}: ₹${formatIndian(customer.balance)}`;

    res.json({ ok: true, pdfBase64: pdfBuffer.toString('base64'), filename, balanceLine });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
