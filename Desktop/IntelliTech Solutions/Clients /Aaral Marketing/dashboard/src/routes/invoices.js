const express = require('express');
const { createInvoice } = require('../invoices');
const { notify } = require('../notify');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');

const router = express.Router();

router.post('/invoices', async (req, res) => {
  try {
    const { customerId, items, unloadingCharge, paidNow, createdBy } = req.body;
    const result = await createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy });

    if (customerId) {
      const customer = await customers.findById(customerId);
      const balance = await balances.getBalanceByCustomerId(customerId);
      const balanceLine = balance ? `Balance: ₹${balance.balance}` : '';

      const customerMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received, thank you! ${balanceLine}`
        : `New invoice #${result.invoice.invoice_number} for ₹${result.invoice.total}. ${balanceLine}`;
      const adminMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received from ${customer.name}. ${balanceLine}`
        : `Invoice #${result.invoice.invoice_number} (₹${result.invoice.total}) issued to ${customer.name}. ${balanceLine}`;

      notify(customer.phone_number, customerMsg);
      const { rows: admins } = await query('SELECT phone_number FROM admins WHERE active = true');
      for (const admin of admins) notify(admin.phone_number, adminMsg);
    }

    res.json({
      ok: true,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoice_number,
      total: result.invoice.total,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  const { rows: invoiceRows } = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
  const { rows: itemRows } = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
    [req.params.id]
  );
  res.json({ invoice: invoiceRows[0], items: itemRows });
});

module.exports = router;
