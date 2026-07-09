const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');

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

router.get('/customers/:id/ledger', async (req, res) => {
  const balance = await balances.getBalanceByCustomerId(req.params.id);
  if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

  const { rows } = await query(
    `SELECT 'invoice' AS type, id, description AS label, amount_due AS amount, created_at AS occurred_at
     FROM dues WHERE customer_id = $1
     UNION ALL
     SELECT 'payment' AS type, id, proof_type AS label, amount_claimed AS amount, reported_at AS occurred_at
     FROM payment_claims WHERE customer_id = $1 AND status = 'confirmed'
     ORDER BY occurred_at ASC`,
    [req.params.id]
  );

  let running = 0;
  const entries = rows.map((row) => {
    running += row.type === 'invoice' ? Number(row.amount) : -Number(row.amount);
    return { ...row, runningBalance: running };
  });

  res.json({ customer: { name: balance.name, phone_number: balance.phone_number, balance: balance.balance }, entries });
});

module.exports = router;
