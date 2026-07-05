require('dotenv').config({ path: '.env.test' });
const test = require('node:test');
const assert = require('node:assert/strict');
const { testConnection, pool } = require('../db');

test('testConnection connects to the test database', async () => {
  const ok = await testConnection();
  assert.equal(ok, true);
});

test.after(async () => {
  await pool.end();
});
