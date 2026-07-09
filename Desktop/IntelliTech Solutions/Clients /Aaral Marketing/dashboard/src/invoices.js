const { pool } = require('payment-ledger-core/db');

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one line item is required');
  }
  return items.map((item, i) => {
    const qty = Number(item.qty);
    const rate = Number(item.rate);
    if (!item.particulars || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Line ${i + 1}: particulars, qty, and rate are required and must be positive`);
    }
    return {
      sNo: i + 1,
      particulars: item.particulars,
      grade: item.grade || null,
      vch: item.vch || null,
      qty,
      rate,
      amount: Math.round(qty * rate * 100) / 100,
    };
  });
}

async function createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy }) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const total = subtotal + (unloading || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: invoiceRows } = await client.query(
      `INSERT INTO invoices (customer_id, paid_now, unloading_charge, subtotal, total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId || null, !!paidNow, unloading, subtotal, total, createdBy]
    );
    const invoice = invoiceRows[0];

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, s_no, particulars, grade, vch, qty, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, item.sNo, item.particulars, item.grade, item.vch, item.qty, item.rate, item.amount]
      );
    }

    let dueId = null;
    let claimId = null;
    if (customerId) {
      const { rows: dueRows } = await client.query(
        `INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, $2, $3) RETURNING id`,
        [customerId, `Invoice #${invoice.invoice_number}`, total]
      );
      dueId = dueRows[0].id;

      if (paidNow) {
        const { rows: claimRows } = await client.query(
          `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status, reviewed_by, reviewed_at)
           VALUES ($1, $2, 'cash', 'confirmed', $3, now()) RETURNING id`,
          [customerId, total, createdBy]
        );
        claimId = claimRows[0].id;
      }
    }

    await client.query('COMMIT');
    return { invoice, items: normalizedItems, dueId, claimId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createInvoice };
