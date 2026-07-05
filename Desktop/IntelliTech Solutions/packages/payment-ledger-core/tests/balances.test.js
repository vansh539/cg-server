const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../ledger/customers');
const balances = require('../ledger/balances');
const { query } = require('../db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('getBalanceByPhone returns computed balance for a registered customer', async () => {
  const customer = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  await query(`INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, 'July dues', 2000)`, [customer.id]);

  const balance = await balances.getBalanceByPhone('9848358160');
  assert.equal(Number(balance.total_due), 2000);
  assert.equal(Number(balance.total_confirmed), 0);
  assert.equal(Number(balance.balance), 2000);
});

test('getBalanceByPhone returns null for an unregistered number', async () => {
  const balance = await balances.getBalanceByPhone('9999999999');
  assert.equal(balance, null);
});

test('listUnlinkedCustomers only returns customers with no external ref id', async () => {
  const linked = await customers.createCustomer({ name: 'Linked', phoneNumber: '9111111111' });
  await customers.linkExternalRefId(linked.id, 'CK-1');
  await customers.createCustomer({ name: 'Unlinked', phoneNumber: '9222222222' });

  const unlinked = await balances.listUnlinkedCustomers();
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].name, 'Unlinked');
});
