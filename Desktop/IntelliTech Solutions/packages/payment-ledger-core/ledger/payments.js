const { pool } = require('../db');

const VALID_METHODS = ['cash', 'gpay', 'bank_transfer'];

function resolveEffectiveDate(dateStr) {
  if (!dateStr) return null;
  const timeOfDay = new Date().toTimeString().split(' ')[0];
  return new Date(`${dateStr}T${timeOfDay}`);
}

async function recordPayment({ customerId, amount, method, date, createdBy }) {
  const amountNum = Number(amount);
  if (!customerId) throw new Error('customerId is required');
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('amount must be a positive number');
  if (!VALID_METHODS.includes(method)) throw new Error(`method must be one of: ${VALID_METHODS.join(', ')}`);

  const effectiveDate = resolveEffectiveDate(date);

  const { rows } = await pool.query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, status, reviewed_by, reviewed_at, reported_at)
     VALUES ($1, $2, $3, 'confirmed', $4, COALESCE($5, now()), COALESCE($5, now())) RETURNING *`,
    [customerId, amountNum, method, createdBy || 'system', effectiveDate]
  );

  return rows[0];
}

module.exports = { recordPayment, resolveEffectiveDate, VALID_METHODS };
