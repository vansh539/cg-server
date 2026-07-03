const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../src/ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('createCustomer then findByPhone finds it regardless of formatting', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '919848358160' });
  const found = await customers.findByPhone('+91 98483 58160');
  assert.ok(found);
  assert.equal(found.name, 'Asha Rao');
});

test('findByPhone returns null for an unregistered number', async () => {
  const found = await customers.findByPhone('9999999999');
  assert.equal(found, null);
});

test('findByNameOrPhone matches by partial name, case-insensitive', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const results = await customers.findByNameOrPhone('asha');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Asha Rao');
});

test('linkMembershipId sets cokarma_membership_id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const updated = await customers.linkMembershipId(created.id, 'CK-1001');
  assert.equal(updated.cokarma_membership_id, 'CK-1001');
});

test('findById returns the customer by id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const found = await customers.findById(created.id);
  assert.equal(found.name, 'Asha Rao');
});

test('findById returns null for an unknown id', async () => {
  const found = await customers.findById('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});
