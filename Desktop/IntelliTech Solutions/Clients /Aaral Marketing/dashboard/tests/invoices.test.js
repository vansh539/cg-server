const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { createInvoice } = require('../src/invoices');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('createInvoice with a customer and paidNow posts a due and a confirmed claim, net-zero balance', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });

  const result = await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '12', qty: 100, rate: 350 }],
    unloadingCharge: 500,
    paidNow: true,
    createdBy: '9999900000',
  });

  assert.equal(Number(result.invoice.subtotal), 35000);
  assert.equal(Number(result.invoice.total), 35500);
  assert.ok(result.dueId);
  assert.ok(result.claimId);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 0);
});

test('createInvoice with a customer and on-account leaves the due open', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });

  await createInvoice({
    customerId: customer.id,
    items: [{ particulars: 'PPC Cement', grade: '53', vch: '7', qty: 50, rate: 360 }],
    unloadingCharge: null,
    paidNow: false,
    createdBy: '9999900000',
  });

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), 18000);
});

test('createInvoice with no customer (walk-in) is not persisted at all', async () => {
  const result = await createInvoice({
    customerId: null,
    items: [{ particulars: 'OPC Cement', grade: '43', vch: '3', qty: 10, rate: 350 }],
    unloadingCharge: null,
    paidNow: true,
    createdBy: '9999900000',
  });

  assert.equal(result.invoice, null);
  assert.equal(result.dueId, null);
  assert.equal(result.claimId, null);
  assert.equal(result.total, 3500);

  const { rows: dueRows } = await pool.query('SELECT count(*) FROM dues');
  assert.equal(dueRows[0].count, '0');
  const { rows: invoiceRows } = await pool.query('SELECT count(*) FROM invoices');
  assert.equal(invoiceRows[0].count, '0');
  const { rows: itemRows } = await pool.query('SELECT count(*) FROM invoice_items');
  assert.equal(itemRows[0].count, '0');
});

test('createInvoice rejects an item with non-positive qty', async () => {
  await assert.rejects(
    () => createInvoice({
      customerId: null,
      items: [{ particulars: 'OPC Cement', grade: '43', vch: '3', qty: 0, rate: 350 }],
      unloadingCharge: null,
      paidNow: true,
      createdBy: '9999900000',
    }),
    /Line 1/
  );
});

test('createInvoice rejects an empty items list', async () => {
  await assert.rejects(
    () => createInvoice({ customerId: null, items: [], unloadingCharge: null, paidNow: true, createdBy: '9999900000' }),
    /line item is required/
  );
});
