const { query } = require('../db/db');
const { findByPhone, findByNameOrPhone } = require('./customers');

async function getBalanceByCustomerId(customerId) {
  const { rows } = await query('SELECT * FROM customer_balances WHERE customer_id = $1', [customerId]);
  return rows[0] || null;
}

async function getBalanceByPhone(phone) {
  const customer = await findByPhone(phone);
  if (!customer) return null;
  return getBalanceByCustomerId(customer.id);
}

async function searchBalances(term) {
  const matches = await findByNameOrPhone(term);
  const results = [];
  for (const customer of matches) {
    results.push(await getBalanceByCustomerId(customer.id));
  }
  return results;
}

async function listUnlinkedCustomers() {
  const { rows } = await query(
    `SELECT id, name, phone_number FROM customers WHERE cokarma_membership_id IS NULL ORDER BY created_at ASC`
  );
  return rows;
}

module.exports = { getBalanceByCustomerId, getBalanceByPhone, searchBalances, listUnlinkedCustomers };
