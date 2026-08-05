const express = require('express');
const { recordPayment, VALID_METHODS } = require('../payments');
const { renderPaymentSlipPdf } = require('../paymentSlipPdf');
const { notify, notifyWithPdf } = require('../notify');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');

const router = express.Router();

router.post('/payments', async (req, res) => {
  try {
    const {
      customerId, newCustomerName, newCustomerPhone,
      amount, method, date, sendWhatsapp, paperWidthMm, paperHeightMm,
    } = req.body;

    let customer;
    if (customerId) {
      customer = await customers.findById(customerId);
      if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found' });
    } else if (newCustomerName && newCustomerPhone) {
      customer = await customers.createCustomer({ name: newCustomerName, phoneNumber: newCustomerPhone });
    } else {
      return res.status(400).json({ ok: false, error: 'customerId or newCustomerName+newCustomerPhone is required' });
    }

    const payment = await recordPayment({
      customerId: customer.id, amount, method, date, createdBy: req.session.user.username,
    });

    const balance = await balances.getBalanceByCustomerId(customer.id);
    const balanceAfter = balance ? balance.balance : null;

    if (sendWhatsapp) {
      const message = `Payment of ₹${payment.amount_claimed} received, thank you!${balanceAfter !== null ? ` Balance: ₹${balanceAfter}` : ''}`;
      renderPaymentSlipPdf({ payment, customerName: customer.name, balanceAfter, paperWidthMm, paperHeightMm })
        .then((pdfBuffer) => notifyWithPdf(
          customer.phone_number, message, pdfBuffer, `Payment-${payment.id.slice(0, 8)}.pdf`
        ))
        .catch((err) => console.error('[Payments] Failed to generate/send payment slip PDF:', err.message));
    }

    const { rows: admins } = await query('SELECT phone_number FROM admins WHERE active = true');
    const adminMsg = `Payment of ₹${payment.amount_claimed} recorded for ${customer.name} (${method}).${balanceAfter !== null ? ` Balance: ₹${balanceAfter}` : ''}`;
    for (const admin of admins) notify(admin.phone_number, adminMsg);

    res.json({ ok: true, paymentId: payment.id, customerId: customer.id });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/payments/methods', (_req, res) => {
  res.json({ methods: VALID_METHODS });
});

router.get('/payments/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT pc.*, c.name AS customer_name, c.phone_number AS customer_phone
     FROM payment_claims pc JOIN customers c ON c.id = pc.customer_id
     WHERE pc.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Payment not found' });
  const payment = rows[0];
  const balance = await balances.getBalanceByCustomerId(payment.customer_id);
  res.json({ payment, balance: balance ? balance.balance : null });
});

// Only for standalone manual payments -- one linked to an invoice (via
// invoice_id, set when paidNow is checked at invoice creation) must be
// voided by voiding the invoice itself, so the invoice's paid_now flag and
// its claim never fall out of sync with each other.
router.post('/payments/:id/void', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM payment_claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Payment not found' });
    const payment = rows[0];
    if (payment.invoice_id) {
      return res.status(400).json({ ok: false, error: 'This payment is linked to an invoice — void the invoice instead.' });
    }
    if (payment.status !== 'confirmed') {
      return res.status(400).json({ ok: false, error: `Payment is already ${payment.status}, not confirmed.` });
    }
    await query(`UPDATE payment_claims SET status = 'voided' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Same invoice_id restriction as void above -- a payment tied to an invoice
// must be removed by deleting the invoice, so paid_now/claim never drift
// apart. Permanent, no undo.
router.delete('/payments/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT invoice_id FROM payment_claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Payment not found' });
    if (rows[0].invoice_id) {
      return res.status(400).json({ ok: false, error: 'This payment is linked to an invoice — delete the invoice instead.' });
    }
    await query('DELETE FROM payment_claims WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
