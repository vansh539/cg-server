const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resetDb, pool } = require('./helpers/db');
const duesImport = require('../imports/duesImport');
const customers = require('../ledger/customers');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('parseDuesCsv reads rows into a normalized shape', () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const rows = duesImport.parseDuesCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].externalRefId, 'CK-1001');
  assert.equal(rows[0].amountDue, 5000);
});

test('importDuesFromFile creates new customers, links external ref ids, and flags unmatched rows', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 1);

  const asha = await customers.findByPhone('9848358160');
  assert.ok(asha);
  assert.equal(asha.external_ref_id, 'CK-1001');

  const ravi = await customers.findByPhone('+91 91111 11111');
  assert.ok(ravi);
  assert.equal(ravi.external_ref_id, 'CK-1002');
});

test('importDuesFromFile does not overwrite an existing external ref id', async () => {
  await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const existing = await customers.findByPhone('9848358160');
  await customers.linkExternalRefId(existing.id, 'ALREADY-SET');

  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');

  const after = await customers.findByPhone('9848358160');
  assert.equal(after.external_ref_id, 'ALREADY-SET');
});

test('importDuesFromFile treats a missing description as unmatched, with no default substituted', async () => {
  const fs = require('node:fs');
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,,5000,2026-07-05\n';
  const tmpPath = path.join(__dirname, 'fixtures', 'tmp-no-description.csv');
  fs.writeFileSync(tmpPath, csv);

  const result = await duesImport.importDuesFromFile(tmpPath, '9999900000');
  fs.unlinkSync(tmpPath);

  assert.equal(result.totalRows, 1);
  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.unmatched[0].description, '');

  const asha = await customers.findByPhone('9848358160');
  assert.equal(asha, null);
});
