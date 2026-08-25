const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');
const { exportAllData, listBackupTables, EXCLUDED_TABLES } = require('../src/backupExport');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('session and migration bookkeeping tables are never included', async () => {
  const names = await listBackupTables();
  for (const excluded of EXCLUDED_TABLES) {
    assert.ok(!names.includes(excluded), `${excluded} must not be in a backup`);
  }
  assert.ok(names.includes('customers'));
  assert.ok(names.includes('steel_items'));
});

test('a derived view (customer_balances) is not exported as if it were a table', async () => {
  const names = await listBackupTables();
  assert.ok(!names.includes('customer_balances'), 'a VIEW should never appear -- only BASE TABLEs');
});

test('real rows show up in the export under their own table name', async () => {
  await customers.createCustomer({ name: 'Backup Test Co', phoneNumber: '9812340099' });
  const data = await exportAllData();
  assert.equal(data.tables.customers.length, 1);
  assert.equal(data.tables.customers[0].name, 'Backup Test Co');
});

test('an empty table still appears as an empty array, not missing entirely', async () => {
  const data = await exportAllData();
  assert.ok(Array.isArray(data.tables.invoices));
  assert.equal(data.tables.invoices.length, 0);
});

test('exportedAt is a real, current ISO timestamp', async () => {
  const before = Date.now();
  const data = await exportAllData();
  const after = Date.now();
  const exportedMs = new Date(data.exportedAt).getTime();
  assert.ok(exportedMs >= before && exportedMs <= after);
});
