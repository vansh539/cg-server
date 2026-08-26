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

async function createInvoice({ customerId, items, unloadingCharge, freightCharge, note, paidNow, createdBy, invoiceDate, destination }) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const freight = freightCharge ? Number(freightCharge) : null;
  const total = subtotal + (unloading || 0) + (freight || 0);
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
      `INSERT INTO invoices (customer_id, paid_now, unloading_charge, freight_charge, note, subtotal, total, created_by, created_at, destination)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10) RETURNING *`,
      [customerId, !!paidNow, unloading, freight, note || null, subtotal, total, createdBy, effectiveDate, destination || null]
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

// A payment_claims row written before the invoice_id column existed on that
// table has no FK back to its invoice -- but createInvoice() always writes
// the due and the (if paidNow) claim in the same transaction from the same
// effectiveDate value, so for every real pre-migration invoice the confirmed
// claim's reported_at is byte-identical to the invoice's created_at. When
// exactly one unlinked confirmed claim matches customer_id + amount +
// that exact timestamp, it's unambiguously the right one. Anything less
// certain (zero or multiple candidates) still refuses -- guessing wrong
// would corrupt the customer's balance.
async function findOrphanedClaim(client, invoice) {
  if (!invoice.customer_id) return null;
  // Compares reported_at against invoices.created_at entirely in SQL via the
  // join, rather than passing invoice.created_at back as a query parameter
  // -- that value would have already been downcast to a JS Date (millisecond
  // precision) on its way out of Postgres, silently losing the microsecond
  // precision timestamptz actually stores and breaking the exact match.
  const { rows } = await client.query(
    `SELECT pc.id FROM payment_claims pc
     JOIN invoices i ON i.id = $1
     WHERE pc.invoice_id IS NULL AND pc.status = 'confirmed'
       AND pc.customer_id = i.customer_id AND pc.amount_claimed = i.total AND pc.reported_at = i.created_at`,
    [invoice.id]
  );
  return rows.length === 1 ? rows[0].id : null;
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
    claimId = claimRows.length ? claimRows[0].id : await findOrphanedClaim(client, invoice);
    if (!claimId) {
      throw new Error(
        'This invoice was marked paid before invoice linking existed, so its payment record ' +
        'can\'t be reliably located. Editing/voiding it isn\'t supported to avoid corrupting the balance.'
      );
    }
  }
  return { dueId: dueRows[0].id, claimId };
}

// Delete's lookup deliberately does NOT filter on voided/confirmed status
// (unlike findLinkedRowsOrThrow above) -- deleting must work on an
// already-voided invoice too, to let staff fully clean up a mistaken entry
// rather than leave an inert voided row behind forever. Same pre-migration
// refusal still applies when the orphaned-claim heuristic can't uniquely
// resolve a paid invoice's claim either, for the same balance-corruption
// reason. A null customer_id (pre-walk-in-policy legacy rows) has no
// customer balance to corrupt at all, so it skips the claim check entirely.
async function findLinkedRowsForDelete(client, invoice) {
  const { rows: dueRows } = await client.query('SELECT id FROM dues WHERE invoice_id = $1', [invoice.id]);
  let claimId = null;
  if (invoice.paid_now && invoice.customer_id) {
    const { rows: claimRows } = await client.query('SELECT id FROM payment_claims WHERE invoice_id = $1', [invoice.id]);
    claimId = claimRows.length ? claimRows[0].id : await findOrphanedClaim(client, invoice);
    if (!claimId) {
      throw new Error(
        'This invoice was marked paid before invoice linking existed, so its payment record ' +
        'can\'t be reliably located. Deleting it isn\'t supported to avoid corrupting the balance.'
      );
    }
  }
  return { dueId: dueRows.length ? dueRows[0].id : null, claimId };
}

async function deleteInvoice(invoiceId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invoiceRows } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (invoiceRows.length === 0) throw new Error('Invoice not found');
    const invoice = invoiceRows[0];

    const { dueId, claimId } = await findLinkedRowsForDelete(client, invoice);

    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    if (dueId) await client.query('DELETE FROM dues WHERE id = $1', [dueId]);
    if (claimId) await client.query('DELETE FROM payment_claims WHERE id = $1', [claimId]);
    await client.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

async function updateInvoice(invoiceId, { items, unloadingCharge, freightCharge, note, destination, invoiceDate }, updatedBy) {
  const normalizedItems = normalizeItems(items);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const unloading = unloadingCharge ? Number(unloadingCharge) : null;
  const freight = freightCharge ? Number(freightCharge) : null;
  const total = subtotal + (unloading || 0) + (freight || 0);
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
      `UPDATE invoices SET unloading_charge = $1, freight_charge = $2, note = $3, subtotal = $4, total = $5, destination = $6,
         created_at = COALESCE($7, created_at), updated_at = now(), updated_by = $8
       WHERE id = $9 RETURNING *`,
      [unloading, freight, note || null, subtotal, total, destination || null, effectiveDate, updatedBy, invoiceId]
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

module.exports = { createInvoice, normalizeItems, voidInvoice, updateInvoice, deleteInvoice };
