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

function resolveEffectiveDate(invoiceDate) {
  if (!invoiceDate) return null;
  const timeOfDay = new Date().toTimeString().split(' ')[0];
  return new Date(`${invoiceDate}T${timeOfDay}`);
}

async function createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy, invoiceDate, destination }) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const total = subtotal + (unloading || 0);
  const effectiveDate = resolveEffectiveDate(invoiceDate);

  // Walk-in / cash sales (no customer, no ledger) are never persisted — only
  // customers with an active ledger get an invoices/invoice_items row.
  if (!customerId) {
    return { invoice: null, items: normalizedItems, dueId: null, claimId: null, subtotal, total };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: invoiceRows } = await client.query(
      `INSERT INTO invoices (customer_id, paid_now, unloading_charge, subtotal, total, created_by, created_at, destination)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8) RETURNING *`,
      [customerId, !!paidNow, unloading, subtotal, total, createdBy, effectiveDate, destination || null]
    );
    const invoice = invoiceRows[0];

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, s_no, particulars, grade, vch, qty, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, item.sNo, item.particulars, item.grade, item.vch, item.qty, item.rate, item.amount]
      );
    }

    const { rows: dueRows } = await client.query(
      `INSERT INTO dues (customer_id, description, amount_due, created_at, invoice_id)
       VALUES ($1, $2, $3, COALESCE($4, now()), $5) RETURNING id`,
      [customerId, `Invoice #${invoice.invoice_number}`, total, effectiveDate, invoice.id]
    );
    const dueId = dueRows[0].id;

    let claimId = null;
    if (paidNow) {
      const { rows: claimRows } = await client.query(
        `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status, reviewed_by, reviewed_at, reported_at, invoice_id)
         VALUES ($1, $2, 'cash', 'confirmed', $3, COALESCE($4, now()), COALESCE($4, now()), $5) RETURNING id`,
        [customerId, total, createdBy, effectiveDate, invoice.id]
      );
      claimId = claimRows[0].id;
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

// Both void and edit touch real money on a live ledger, so both look up the
// linked due/payment_claim by the real invoice_id FK (not the old regex/
// description match) and, for a paid invoice, refuse outright if the linked
// claim can't be found -- this only happens for invoices created before the
// invoice_id column existed, where there is nothing reliable to backfill
// from. Refusing beats guessing wrong on a customer's balance.
async function findLinkedRowsOrThrow(client, invoice) {
  const { rows: dueRows } = await client.query(
    'SELECT id FROM dues WHERE invoice_id = $1 AND NOT voided', [invoice.id]
  );
  if (dueRows.length === 0) {
    throw new Error('Could not find the ledger due linked to this invoice -- refusing to proceed.');
  }
  let claimId = null;
  if (invoice.paid_now) {
    const { rows: claimRows } = await client.query(
      `SELECT id FROM payment_claims WHERE invoice_id = $1 AND status = 'confirmed'`, [invoice.id]
    );
    if (claimRows.length === 0) {
      throw new Error(
        'This invoice was marked paid before invoice linking existed, so its payment record ' +
        'can\'t be reliably located. Editing/voiding it isn\'t supported to avoid corrupting the balance.'
      );
    }
    claimId = claimRows[0].id;
  }
  return { dueId: dueRows[0].id, claimId };
}

async function voidInvoice(invoiceId, voidedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invoiceRows } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (invoiceRows.length === 0) throw new Error('Invoice not found');
    const invoice = invoiceRows[0];
    if (invoice.voided_at) throw new Error('This invoice is already voided');

    const { dueId, claimId } = await findLinkedRowsOrThrow(client, invoice);

    await client.query(
      'UPDATE invoices SET voided_at = now(), voided_by = $1 WHERE id = $2', [voidedBy, invoiceId]
    );
    await client.query('UPDATE dues SET voided = true WHERE id = $1', [dueId]);
    if (claimId) {
      await client.query(`UPDATE payment_claims SET status = 'voided' WHERE id = $1`, [claimId]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateInvoice(invoiceId, { items, unloadingCharge, destination, invoiceDate }, updatedBy) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const total = subtotal + (unloading || 0);
  const effectiveDate = resolveEffectiveDate(invoiceDate);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invoiceRows } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (invoiceRows.length === 0) throw new Error('Invoice not found');
    const invoice = invoiceRows[0];
    if (invoice.voided_at) throw new Error('Cannot edit a voided invoice');

    const { dueId, claimId } = await findLinkedRowsOrThrow(client, invoice);

    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, s_no, particulars, grade, vch, qty, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoiceId, item.sNo, item.particulars, item.grade, item.vch, item.qty, item.rate, item.amount]
      );
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE invoices SET unloading_charge = $1, subtotal = $2, total = $3, destination = $4,
         created_at = COALESCE($5, created_at), updated_at = now(), updated_by = $6
       WHERE id = $7 RETURNING *`,
      [unloading, subtotal, total, destination || null, effectiveDate, updatedBy, invoiceId]
    );
    await client.query('UPDATE dues SET amount_due = $1 WHERE id = $2', [total, dueId]);
    if (claimId) {
      await client.query('UPDATE payment_claims SET amount_claimed = $1 WHERE id = $2', [total, claimId]);
    }

    await client.query('COMMIT');
    return { invoice: updatedRows[0], items: normalizedItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createInvoice, normalizeItems, voidInvoice, updateInvoice };
