const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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

test('parseDuesXlsx reads itemized multi-row-per-customer rows into the same normalized shape as CSV', async () => {
  const fs = require('node:fs');
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'dues-sample.xlsx'));
  const rows = await duesImport.parseDuesXlsx(buffer);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Asha Rao');
  assert.equal(rows[0].phoneNumber, '9848358160');
  assert.equal(rows[0].externalRefId, 'CK-1001');
  assert.equal(rows[0].description, 'Opening balance - Invoice 1');
  assert.equal(rows[0].amountDue, 3000);
  assert.equal(rows[1].description, 'Opening balance - Invoice 2');
  assert.equal(rows[1].amountDue, 1500);
});

test('importDuesFromFile accepts an .xlsx file and creates one dues row per line item', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.xlsx');
  const result = await duesImport.importDuesFromFile(filePath, '9999900000');

  assert.equal(result.totalRows, 3);
  assert.equal(result.unmatchedCount, 0);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 4500);
});

test('sanitizeFormulaValue neutralizes a leading =, +, -, or @', () => {
  assert.equal(duesImport.sanitizeFormulaValue('=cmd|calc'), "'=cmd|calc");
  assert.equal(duesImport.sanitizeFormulaValue('+1+1'), "'+1+1");
  assert.equal(duesImport.sanitizeFormulaValue('-1-1'), "'-1-1");
  assert.equal(duesImport.sanitizeFormulaValue('@SUM(1,1)'), "'@SUM(1,1)");
  assert.equal(duesImport.sanitizeFormulaValue('Asha Rao'), 'Asha Rao');
});

test('importDuesFromFile sanitizes a formula-injection attempt in the name field', async () => {
  const csv = 'name,phone_number,membership_id,description,amount_due,due_date\n"=HYPERLINK(""http://evil"")",9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const tmpPath = path.join(__dirname, 'fixtures', 'tmp-injection.csv');
  fs.writeFileSync(tmpPath, csv);
  await duesImport.importDuesFromFile(tmpPath, '9999900000');
  fs.unlinkSync(tmpPath);

  const customer = await customers.findByPhone('9848358160');
  assert.equal(customer.name.startsWith("'="), true);
});

test('importDuesFromFile rejects a file over the row cap', async () => {
  const header = 'name,phone_number,membership_id,description,amount_due,due_date\n';
  const row = 'Test User,9848358160,CK-1,dues,100,2026-07-05\n';
  const csv = header + row.repeat(10001);
  const tmpPath = path.join(__dirname, 'fixtures', 'tmp-toolarge.csv');
  fs.writeFileSync(tmpPath, csv);

  await assert.rejects(
    () => duesImport.importDuesFromFile(tmpPath, '9999900000'),
    /Import rejected: 10001 rows exceeds the 10000-row cap/
  );
  fs.unlinkSync(tmpPath);
});

test('importDuesFromFile flags a repeat import of unchanged file content instead of re-importing', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  const first = await duesImport.importDuesFromFile(filePath, '9999900000');
  assert.equal(first.alreadyImported, undefined);

  const second = await duesImport.importDuesFromFile(filePath, '9999900000');
  assert.equal(second.alreadyImported, true);
  assert.equal(second.previousImport.row_count, first.totalRows);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 5000); // not double-counted to 10000
});

test('importDuesFromFile with force:true re-imports unchanged content anyway', async () => {
  const filePath = path.join(__dirname, 'fixtures', 'dues-sample.csv');
  await duesImport.importDuesFromFile(filePath, '9999900000');
  const forced = await duesImport.importDuesFromFile(filePath, '9999900000', { force: true });
  assert.equal(forced.alreadyImported, undefined);

  const asha = await customers.findByPhone('9848358160');
  const balance = await require('../ledger/balances').getBalanceByCustomerId(asha.id);
  assert.equal(Number(balance.total_due), 10000); // now double-counted intentionally
});

test('importDuesFromFile does not flag a different file as a repeat', async () => {
  const csvA = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,July dues,5000,2026-07-05\n';
  const csvB = 'name,phone_number,membership_id,description,amount_due,due_date\nAsha Rao,9848358160,CK-1001,August dues,5000,2026-08-05\n';
  const pathA = path.join(__dirname, 'fixtures', 'tmp-a.csv');
  const pathB = path.join(__dirname, 'fixtures', 'tmp-b.csv');
  fs.writeFileSync(pathA, csvA);
  fs.writeFileSync(pathB, csvB);

  const first = await duesImport.importDuesFromFile(pathA, '9999900000');
  const second = await duesImport.importDuesFromFile(pathB, '9999900000');
  assert.equal(first.alreadyImported, undefined);
  assert.equal(second.alreadyImported, undefined);

  fs.unlinkSync(pathA);
  fs.unlinkSync(pathB);
});
