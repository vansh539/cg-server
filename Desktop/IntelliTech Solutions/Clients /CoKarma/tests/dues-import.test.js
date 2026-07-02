const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resetDb, pool } = require('./helpers/db');
const duesImport = require('../src/imports/duesImport');
const customers = require('../src/ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('parseDuesCsv reads rows into a normalized shape', () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const rows = duesImport.parseDuesCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].membershipId, 'CK-1001');
  assert.equal(rows[0].amountDue, 5000);
});

test('importDuesFromFile creates new customers, links membership ids, and flags unmatched rows', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 1);

  const asha = await customers.findByPhone('9848358160');
  assert.ok(asha);
  assert.equal(asha.cokarma_membership_id, 'CK-1001');

  const ravi = await customers.findByPhone('+91 91111 11111');
  assert.ok(ravi);
  assert.equal(ravi.cokarma_membership_id, 'CK-1002');
});

test('importDuesFromFile does not overwrite an existing membership id', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const existing = await customers.findByPhone('9848358160');
  await customers.linkMembershipId(existing.id, 'ALREADY-SET');

  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');

  const after = await customers.findByPhone('9848358160');
  assert.equal(after.cokarma_membership_id, 'ALREADY-SET');
});
