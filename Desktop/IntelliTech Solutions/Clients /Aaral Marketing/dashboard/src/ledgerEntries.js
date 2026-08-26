const { query } = require('payment-ledger-core/db');

// Invoice-type entries also carry `items` (particulars/qty/rate from
// invoice_items) so the statement can show what was actually bought, not
// just an "Invoice #N" line -- the customer's own copy has no other way to
// see that breakdown without asking the office to look up the invoice.
async function fetchLedgerEntries(customerId) {
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
    [customerId]
  );

  const invoiceIds = [...new Set(
    rows.filter((row) => row.type === 'invoice' && row.invoice_id).map((row) => row.invoice_id)
  )];
  let itemsByInvoice = {};
  if (invoiceIds.length) {
    const { rows: itemRows } = await query(
      `SELECT invoice_id, particulars, qty, rate FROM invoice_items
       WHERE invoice_id = ANY($1::uuid[]) ORDER BY s_no ASC`,
      [invoiceIds]
    );
    itemsByInvoice = itemRows.reduce((acc, item) => {
      (acc[item.invoice_id] = acc[item.invoice_id] || []).push(item);
      return acc;
    }, {});
  }

  let running = 0;
  return rows.map((row) => {
    if (!row.voided) running += row.type === 'invoice' ? Number(row.amount) : -Number(row.amount);
    const items = row.type === 'invoice' && row.invoice_id ? (itemsByInvoice[row.invoice_id] || []) : [];
    return { ...row, runningBalance: running, items };
  });
}

module.exports = { fetchLedgerEntries };
