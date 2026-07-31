const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const customers = require('payment-ledger-core/ledger/customers');
const { query } = require('payment-ledger-core/db');
const { requirePin } = require('../adminAuth');

const router = express.Router();

router.get('/customers', async (req, res) => {
  const term = req.query.q;
  if (term) {
    const results = await balances.searchBalances(term);
    return res.json(results);
  }
  const { rows } = await query('SELECT * FROM customer_balances ORDER BY name ASC');
  res.json(rows);
});

router.post('/customers', requirePin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const phoneNumber = (req.body.phoneNumber || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });
    if (!phoneNumber) return res.status(400).json({ ok: false, error: 'Phone number is required' });

    const existing = await customers.findByPhone(phoneNumber);
    if (existing) return res.status(400).json({ ok: false, error: `A customer with this phone number already exists: ${existing.name}` });

    const customer = await customers.createCustomer({ name, phoneNumber });
    res.json({ ok: true, customerId: customer.id });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/customers/:id/opening-balance', requirePin, async (req, res) => {
  try {
    const customer = await customers.findById(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found' });

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ ok: false, error: 'Amount must be a non-zero number' });
    }
    const description = (req.body.description || '').trim() || 'Opening Balance';
    const effectiveDate = req.body.date ? new Date(`${req.body.date}T${new Date().toTimeString().split(' ')[0]}`) : null;

    await query(
      `INSERT INTO dues (customer_id, description, amount_due, created_at)
       VALUES ($1, $2, $3, COALESCE($4, now()))`,
      [customer.id, description, amount, effectiveDate]
    );

    const balance = await balances.getBalanceByCustomerId(customer.id);
    res.json({ ok: true, balance: balance ? balance.balance : null });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/customers/:id/ledger', async (req, res) => {
  const balance = await balances.getBalanceByCustomerId(req.params.id);
  if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

  const { rows } = await query(
    `SELECT 'invoice' AS type, d.id, d.description AS label, d.amount_due AS amount, d.created_at AS occurred_at,
            d.invoice_id, d.voided
     FROM dues d
     WHERE d.customer_id = $1
     UNION ALL
     SELECT 'payment' AS type, id, proof_type AS label, amount_claimed AS amount, reported_at AS occurred_at,
            invoice_id, (status = 'voided') AS voided
     FROM payment_claims WHERE customer_id = $1 AND status IN ('confirmed', 'voided')
     ORDER BY occurred_at ASC`,
    [req.params.id]
  );

  let running = 0;
  const entries = rows.map((row) => {
    if (!row.voided) running += row.type === 'invoice' ? Number(row.amount) : -Number(row.amount);
    return { ...row, runningBalance: running };
  });

  res.json({ customer: { name: balance.name, phone_number: balance.phone_number, balance: balance.balance }, entries });
});

module.exports = router;
