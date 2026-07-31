const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { createInvoice, voidInvoice, updateInvoice } = require('../src/invoices');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('voidInvoice on a paid invoice zeroes its balance contribution and voids the linked claim', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '12', qty: 100, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });

  await voidInvoice(result.invoice.id, 'tester');

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0, 'balance stays net-zero after voiding both sides');

  const { rows: dueRows } = await pool.query('SELECT voided FROM dues WHERE id = $1', [result.dueId]);
  assert.equal(dueRows[0].voided, true);
  const { rows: claimRows } = await pool.query('SELECT status FROM payment_claims WHERE id = $1', [result.claimId]);
  assert.equal(claimRows[0].status, 'voided');

  const { rows: invoiceRows } = await pool.query('SELECT voided_at, voided_by FROM invoices WHERE id = $1', [result.invoice.id]);
  assert.ok(invoiceRows[0].voided_at);
  assert.equal(invoiceRows[0].voided_by, 'tester');
});

test('voidInvoice on an on-account invoice removes the due from the balance', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'PPC Cement', grade: '53', vch: '7', qty: 50, rate: 360 }],
    unloadingCharge: null, paidNow: false, createdBy: '9999900000',
  });

  let balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 18000);

  await voidInvoice(result.invoice.id, 'tester');

  balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0);
});

test('voidInvoice refuses to void an already-voided invoice', async () => {
  const customer = await customers.createCustomer({ name: 'Ganesh Cements', phoneNumber: '9812345672' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: false, createdBy: '9999900000',
  });
  await voidInvoice(result.invoice.id, 'tester');
  await assert.rejects(() => voidInvoice(result.invoice.id, 'tester'), /already voided/);
});

test('voidInvoice refuses a paid invoice whose claim has no invoice_id link (pre-migration data)', async () => {
  const customer = await customers.createCustomer({ name: 'Legacy Traders', phoneNumber: '9812345673' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });
  // Simulate a pre-migration row: strip the invoice_id link the claim would
  // never have had before invoice_id existed.
  await pool.query('UPDATE payment_claims SET invoice_id = NULL WHERE id = $1', [result.claimId]);

  await assert.rejects(() => voidInvoice(result.invoice.id, 'tester'), /can't be reliably located/);

  // Nothing should have been mutated by the failed attempt.
  const { rows: invoiceRows } = await pool.query('SELECT voided_at FROM invoices WHERE id = $1', [result.invoice.id]);
  assert.equal(invoiceRows[0].voided_at, null);
});

test('updateInvoice recomputes total and keeps the linked due/claim in sync', async () => {
  const customer = await customers.createCustomer({ name: 'Kumar Builders', phoneNumber: '9812345674' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: true, createdBy: '9999900000',
  });
  assert.equal(Number(result.invoice.total), 3500);

  const updated = await updateInvoice(
    result.invoice.id,
    { items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 20, rate: 350 }], unloadingCharge: null, destination: null, invoiceDate: null },
    'tester'
  );
  assert.equal(Number(updated.invoice.total), 7000);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0, 'due and claim both moved to the new total, balance still net-zero');

  const { rows: dueRows } = await pool.query('SELECT amount_due FROM dues WHERE id = $1', [result.dueId]);
  assert.equal(Number(dueRows[0].amount_due), 7000);
  const { rows: claimRows } = await pool.query('SELECT amount_claimed FROM payment_claims WHERE id = $1', [result.claimId]);
  assert.equal(Number(claimRows[0].amount_claimed), 7000);
});

test('updateInvoice refuses to edit a voided invoice', async () => {
  const customer = await customers.createCustomer({ name: 'Voided Co', phoneNumber: '9812345675' });
  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '1', qty: 10, rate: 350 }],
    unloadingCharge: null, paidNow: false, createdBy: '9999900000',
  });
  await voidInvoice(result.invoice.id, 'tester');

  await assert.rejects(
    () => updateInvoice(result.invoice.id, { items: [{ particulars: 'x', qty: 1, rate: 1 }], unloadingCharge: null, destination: null, invoiceDate: null }, 'tester'),
    /Cannot edit a voided invoice/
  );
});
