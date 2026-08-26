const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');
const balances = require('../ledger/balances');
const { recordPayment } = require('../ledger/payments');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('recordPayment inserts an immediately-confirmed claim and updates the balance', async () => {
  const customer = await customers.createCustomer({ name: 'Ramesh Traders', phoneNumber: '9812345670' });

  const payment = await recordPayment({
    customerId: customer.id, amount: 5000, method: 'gpay', date: '2026-07-19', createdBy: 'dashboard',
  });

  assert.equal(payment.status, 'confirmed');
  assert.equal(payment.proof_type, 'gpay');
  assert.equal(Number(payment.amount_claimed), 5000);

  const balance = await balances.getBalanceByCustomerId(customer.id);
  assert.equal(Number(balance.balance), -5000);
});

test('recordPayment accepts cash and bank_transfer methods', async () => {
  const customer = await customers.createCustomer({ name: 'Suresh Stores', phoneNumber: '9812345671' });

  const cash = await recordPayment({ customerId: customer.id, amount: 100, method: 'cash', date: null, createdBy: 'dashboard' });
  const bank = await recordPayment({ customerId: customer.id, amount: 200, method: 'bank_transfer', date: null, createdBy: 'dashboard' });

  assert.equal(cash.proof_type, 'cash');
  assert.equal(bank.proof_type, 'bank_transfer');
});

test('recordPayment rejects an unknown method', async () => {
  const customer = await customers.createCustomer({ name: 'Anil Hardware', phoneNumber: '9812345672' });
  await assert.rejects(
    () => recordPayment({ customerId: customer.id, amount: 100, method: 'cheque', date: null, createdBy: 'dashboard' }),
    /method must be one of/
  );
});

test('recordPayment rejects a non-positive amount', async () => {
  const customer = await customers.createCustomer({ name: 'Deepak Cement', phoneNumber: '9812345673' });
  await assert.rejects(
    () => recordPayment({ customerId: customer.id, amount: 0, method: 'cash', date: null, createdBy: 'dashboard' }),
    /positive number/
  );
});

test('recordPayment requires a customerId', async () => {
  await assert.rejects(
    () => recordPayment({ customerId: null, amount: 100, method: 'cash', date: null, createdBy: 'dashboard' }),
    /customerId is required/
  );
});

test('recordPayment defaults createdBy to "system" when omitted', async () => {
  const customer = await customers.createCustomer({ name: 'Test Co', phoneNumber: '9812345699' });
  const payment = await recordPayment({ customerId: customer.id, amount: 100, method: 'cash', date: null });
  assert.equal(payment.reviewed_by, 'system');
});
