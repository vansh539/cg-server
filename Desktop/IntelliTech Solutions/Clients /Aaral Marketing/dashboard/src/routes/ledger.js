const express = require('express');
const balances = require('payment-ledger-core/ledger/balances');
const customers = require('payment-ledger-core/ledger/customers');
const { query, pool } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');
const { notifyWithPdf, humanReason } = require('../notify');
const { renderLedgerPdf } = require('../ledgerPdf');
const { sanitize } = require('../invoiceFilename');
const { formatIndian, formatDate } = require('../chittiTemplate');
const { logActivity } = require('../activityLog');
const { fetchLedgerEntries } = require('../ledgerEntries');

const router = express.Router();

router.get('/dashboard/summary', async (req, res) => {
  const { rows: balRows } = await query('SELECT balance FROM customer_balances');
  let outstanding = 0;
  let credit = 0;
  balRows.forEach((r) => {
    const b = Number(r.balance);
    if (b > 0) outstanding += b;
    else credit += -b;
  });
  const { rows: monthRows } = await query(
    `SELECT COALESCE(SUM(amount_due), 0) AS total, COUNT(*)::int AS count
     FROM dues
     WHERE invoice_id IS NOT NULL AND created_at >= date_trunc('month', now())`
  );
  res.json({
    outstanding,
    credit,
    customerCount: balRows.length,
    monthSales: Number(monthRows[0].total),
    monthSlipCount: monthRows[0].count,
  });
});

router.get('/dashboard/activity', async (req, res) => {
  const { rows } = await query(
    `SELECT 'invoice' AS type, c.name AS customer_name, d.amount_due AS amount, d.created_at AS occurred_at
     FROM dues d
     JOIN customers c ON c.id = d.customer_id
     WHERE d.invoice_id IS NOT NULL
     UNION ALL
     SELECT 'payment' AS type, c.name AS customer_name, p.amount_claimed AS amount, p.reported_at AS occurred_at
     FROM payment_claims p
     JOIN customers c ON c.id = p.customer_id
     WHERE p.status = 'confirmed'
     ORDER BY occurred_at DESC
     LIMIT 8`
  );
  res.json(rows);
});

// Powers the customers page's "Recent activity" feed -- a system-wide view
// across every customer, not one account's ledger.
router.get('/activity', async (_req, res) => {
  const { rows: activity } = await query(
    `SELECT 'invoice' AS type, d.description AS label, d.amount_due AS amount, d.created_at AS occurred_at,
            d.invoice_id, c.name AS customer_name, c.id AS customer_id
     FROM dues d JOIN customers c ON c.id = d.customer_id
     WHERE NOT d.voided
     UNION ALL
     SELECT 'payment' AS type, pc.proof_type AS label, pc.amount_claimed AS amount, pc.reported_at AS occurred_at,
            pc.invoice_id, c.name AS customer_name, c.id AS customer_id
     FROM payment_claims pc JOIN customers c ON c.id = pc.customer_id
     WHERE pc.status = 'confirmed'
     ORDER BY occurred_at DESC
     LIMIT 15`
  );
  res.json({ activity });
});

router.get('/customers', async (req, res) => {
  const term = req.query.q;
  if (term) {
    const results = await balances.searchBalances(term);
    return res.json(results);
  }
  const { rows } = await query('SELECT * FROM customer_balances ORDER BY name ASC');
  res.json(rows);
});

router.post('/customers', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const phoneNumber = (req.body.phoneNumber || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });

    if (phoneNumber) {
      const existing = await customers.findByPhone(phoneNumber);
      if (existing) return res.status(400).json({ ok: false, error: `A customer with this phone number already exists: ${existing.name}` });
    }

    const customer = await customers.createCustomer({ name, phoneNumber });
    await logActivity(req, 'added customer', name);
    res.json({ ok: true, customerId: customer.id });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/customers/:id/opening-balance', async (req, res) => {
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
    await logActivity(req, 'added opening balance', `₹${amount} for ${customer.name}`);
    res.json({ ok: true, balance: balance ? balance.balance : null });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/customers/:id/ledger', async (req, res) => {
  const balance = await balances.getBalanceByCustomerId(req.params.id);
  if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });

  const entries = await fetchLedgerEntries(req.params.id);

  res.json({ customer: { name: balance.name, phone_number: balance.phone_number, balance: balance.balance }, entries });
});

// Sends the customer their full transaction history (every invoice and
// payment, with running balance) as a PDF over WhatsApp -- the third option
// alongside "Add Opening Balance" and "Delete Customer" on the ledger page.
router.post('/customers/:id/send-ledger-whatsapp', async (req, res) => {
  try {
    const balance = await balances.getBalanceByCustomerId(req.params.id);
    if (!balance) return res.status(404).json({ ok: false, error: 'Customer not found' });
    if (!balance.phone_number) {
      return res.status(400).json({ ok: false, error: 'This customer has no phone number on file.' });
    }

    const entries = await fetchLedgerEntries(req.params.id);
    const customer = { name: balance.name, phone_number: balance.phone_number, balance: balance.balance };
    const { paperWidthMm, paperHeightMm } = req.body;

    const pdfBuffer = await renderLedgerPdf({ customer, entries, paperWidthMm, paperHeightMm });
    // Same sanitiser the slip filenames use. A trade name like "M/s Sharma
    // Traders" was previously pasted in raw, and that slash makes a filename
    // Windows will not accept.
    const filename = `Ledger-${sanitize(customer.name) || 'Customer'}.pdf`;
    const message = `Here's your account statement as of ${formatDate()}, ${customer.name}. Current balance: ₹${formatIndian(customer.balance)}.`;
    const result = await notifyWithPdf(customer.phone_number, message, pdfBuffer, filename);
    if (!result.sent) {
      return res.status(502).json({ ok: false, error: humanReason(result), recovering: result.recovering === true });
    }

    await logActivity(req, 'sent ledger on WhatsApp', `to ${customer.name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Only for standalone dues (Opening Balance entries, invoice_id IS NULL) --
// one linked to an invoice must be deleted by deleting the invoice itself,
// same reasoning as payments.js's void/delete restriction.
router.delete('/dues/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT invoice_id FROM dues WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Entry not found' });
    if (rows[0].invoice_id) {
      return res.status(400).json({ ok: false, error: 'This entry is linked to an invoice — delete the invoice instead.' });
    }
    await query('DELETE FROM dues WHERE id = $1', [req.params.id]);
    await logActivity(req, 'deleted ledger entry', `due id ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Permanent, cascading, no undo -- deliberately chosen over archive/deactivate
// (see the discussion this was built from). Deletes every invoice, invoice
// item, due, and payment_claim this customer ever had, then the customer
// itself.
router.delete('/customers/:id', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, name FROM customers WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Customer not found' });
    }
    // dues/payment_claims reference invoices via invoice_id, so both must go
    // before invoices itself, or the FK constraint blocks the delete.
    await client.query(
      'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id = $1)',
      [req.params.id]
    );
    await client.query('DELETE FROM dues WHERE customer_id = $1', [req.params.id]);
    await client.query('DELETE FROM payment_claims WHERE customer_id = $1', [req.params.id]);
    await client.query('DELETE FROM invoices WHERE customer_id = $1', [req.params.id]);
    await client.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    await logActivity(req, 'deleted customer', rows[0].name);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
