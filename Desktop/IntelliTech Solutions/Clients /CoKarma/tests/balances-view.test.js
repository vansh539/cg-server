const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const { query } = require('../src/db/db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

test('customer_balances does not fan out when a customer has multiple dues and multiple confirmed claims', async () => {
  const { rows: [customer] } = await query(
    `INSERT INTO customers (name, phone_number) VALUES ('Test Customer', '9999900001') RETURNING id`
  );

  await query(`INSERT INTO dues (customer_id, description, amount_due) VALUES ($1, 'Due A', 1000), ($1, 'Due B', 500)`, [customer.id]);

  await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status)
     VALUES ($1, 600, 'utr_text', 'confirmed'), ($1, 400, 'utr_text', 'confirmed'), ($1, 200, 'utr_text', 'pending')`,
    [customer.id]
  );

  const { rows: [balance] } = await query('SELECT * FROM customer_balances WHERE customer_id = $1', [customer.id]);

  assert.equal(Number(balance.total_due), 1500);
  assert.equal(Number(balance.total_confirmed), 1000);
  assert.equal(Number(balance.balance), 500);
});
