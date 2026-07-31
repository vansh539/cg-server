const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { createInvoice, deleteInvoice, voidInvoice } = require('../src/invoices');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('deleteInvoice on a paid invoice removes invoice, items, due, and claim entirely', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '12', qty: 100, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });

  await deleteInvoice(result.invoice.id);

  const { rows: invoiceRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [result.invoice.id]);
  assert.equal(invoiceRows.length, 0);
  const { rows: itemRows } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [result.invoice.id]);
  assert.equal(itemRows.length, 0);
  const { rows: dueRows } = await pool.query('SELECT * FROM dues WHERE id = $1', [result.dueId]);
  assert.equal(dueRows.length, 0);
  const { rows: claimRows } = await pool.query('SELECT * FROM payment_claims WHERE id = $1', [result.claimId]);
  assert.equal(claimRows.length, 0);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0, 'deleting a net-zero paid invoice leaves balance untouched');
});

test('deleteInvoice on an on-account invoice removes the due and restores balance to zero', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'PPC Cement', grade: '53', vch: '7', qty: 50, rate: 360 }],
    unloadingCharge: null, paidNow: false, createdBy: '9999900000',
  });

  let balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 18000);

  await deleteInvoice(result.invoice.id);

  balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0);
});

test('deleteInvoice works on an already-voided invoice (full cleanup)', async () => {
  const customer = await customers.createCustomer({ name: 'Ganesh Cements', phoneNumber: '9812345672' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });
  await voidInvoice(result.invoice.id, 'tester');

  await deleteInvoice(result.invoice.id);

  const { rows: invoiceRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [result.invoice.id]);
  assert.equal(invoiceRows.length, 0);
  const { rows: dueRows } = await pool.query('SELECT * FROM dues WHERE id = $1', [result.dueId]);
  assert.equal(dueRows.length, 0);
  const { rows: claimRows } = await pool.query('SELECT * FROM payment_claims WHERE id = $1', [result.claimId]);
  assert.equal(claimRows.length, 0);
});

test('deleteInvoice refuses a paid invoice whose claim has no invoice_id link (pre-migration data)', async () => {
  const customer = await customers.createCustomer({ name: 'Legacy Traders', phoneNumber: '9812345673' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });
  await pool.query('UPDATE payment_claims SET invoice_id = NULL WHERE id = $1', [result.claimId]);

  await assert.rejects(() => deleteInvoice(result.invoice.id), /can't be reliably located/);

  const { rows: invoiceRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [result.invoice.id]);
  assert.equal(invoiceRows.length, 1, 'nothing should have been deleted by the failed attempt');
});

test('deleting a customer cascades to all their invoices, items, dues, and payments', async () => {
  const customer = await customers.createCustomer({ name: 'Delete Me Traders', phoneNumber: '9812345680' });
  const other = await customers.createCustomer({ name: 'Keep Me Traders', phoneNumber: '9812345681' });

  await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });
  await createInvoice({
    customerId: other.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });

  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(
    'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id = $1)', [customer.id]
  );
  await client.query('DELETE FROM dues WHERE customer_id = $1', [customer.id]);
  await client.query('DELETE FROM payment_claims WHERE customer_id = $1', [customer.id]);
  await client.query('DELETE FROM invoices WHERE customer_id = $1', [customer.id]);
  await client.query('DELETE FROM customers WHERE id = $1', [customer.id]);
  await client.query('COMMIT');
  client.release();

  const { rows: custRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [customer.id]);
  assert.equal(custRows.length, 0);
  const { rows: invRows } = await pool.query('SELECT * FROM invoices WHERE customer_id = $1', [customer.id]);
  assert.equal(invRows.length, 0);

  // the other customer's data must survive untouched
  const { rows: otherRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [other.id]);
  assert.equal(otherRows.length, 1);
  const otherBalance = await balances.getBalanceByCustomerId(other.id);
  assert.equal(Number(otherBalance.balance), 0);
});
