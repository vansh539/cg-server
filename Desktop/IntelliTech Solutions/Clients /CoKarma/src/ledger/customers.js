const { query } = require('../db/db');

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function findByPhone(phone) {
  const normalized = normalizePhone(phone);
  const { rows } = await query(
    `SELECT * FROM customers WHERE right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $1`,
    [normalized]
  );
  return rows[0] || null;
}

async function findById(customerId) {
  const { rows } = await query(`SELECT * FROM customers WHERE id = $1`, [customerId]);
  return rows[0] || null;
}

async function createCustomer({ name, phoneNumber }) {
  const { rows } = await query(
    `INSERT INTO customers (name, phone_number) VALUES ($1, $2) RETURNING *`,
    [name, phoneNumber]
  );
  return rows[0];
}

async function findByNameOrPhone(term) {
  const normalized = normalizePhone(term);
  const { rows } = await query(
    `SELECT * FROM customers
     WHERE LOWER(name) LIKE LOWER($1)
        OR right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $2
     LIMIT 5`,
    [`%${term}%`, normalized]
  );
  return rows;
}

async function linkMembershipId(customerId, membershipId) {
  const { rows } = await query(
    `UPDATE customers SET cokarma_membership_id = $2 WHERE id = $1 RETURNING *`,
    [customerId, membershipId]
  );
  return rows[0] || null;
}

module.exports = { normalizePhone, findByPhone, findById, createCustomer, findByNameOrPhone, linkMembershipId };
