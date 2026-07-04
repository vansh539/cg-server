const { query } = require('../db/db');

async function findDuplicateUtr(proofReference) {
  if (!proofReference) return null;
  const { rows } = await query(
    `SELECT * FROM payment_claims WHERE proof_type = 'utr_text' AND proof_reference = $1 AND status != 'rejected'`,
    [proofReference]
  );
  return rows[0] || null;
}

async function findDuplicateTxnId(txnId) {
  if (!txnId) return null;
  const { rows } = await query(
    `SELECT * FROM payment_claims WHERE ocr_extracted_txn_id = $1 AND status != 'rejected'`,
    [txnId]
  );
  return rows[0] || null;
}

async function createClaim({ customerId, amountClaimed, proofType, proofReference, ocrExtractedAmount, ocrExtractedTxnId, ocrExtractedDate }) {
  const duplicate = proofType === 'utr_text' ? await findDuplicateUtr(proofReference) : null;
  const duplicateTxnId = ocrExtractedTxnId ? await findDuplicateTxnId(ocrExtractedTxnId) : null;

  const { rows } = await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, proof_reference, ocr_extracted_amount, ocr_extracted_txn_id, ocr_extracted_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [customerId, amountClaimed, proofType, proofReference || null, ocrExtractedAmount ?? null, ocrExtractedTxnId ?? null, ocrExtractedDate ?? null]
  );

  return { claim: rows[0], duplicateOf: duplicate, duplicateTxnIdOf: duplicateTxnId };
}

async function findClaimByIdPrefix(prefix) {
  const { rows } = await query(
    `SELECT id FROM payment_claims WHERE id::text LIKE $1 ORDER BY reported_at DESC LIMIT 5`,
    [`${prefix.toLowerCase()}%`]
  );
  return rows;
}

async function confirmClaim(claimId, adminPhone) {
  const { rows } = await query(
    `UPDATE payment_claims
     SET status = 'confirmed', reviewed_by = $2, reviewed_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [claimId, adminPhone]
  );
  return rows[0] || null;
}

async function rejectClaim(claimId, adminPhone, reason) {
  const { rows } = await query(
    `UPDATE payment_claims
     SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [claimId, adminPhone, reason || null]
  );
  return rows[0] || null;
}

async function listPendingClaims() {
  const { rows } = await query(
    `SELECT pc.*, c.name, c.phone_number
     FROM payment_claims pc
     JOIN customers c ON c.id = pc.customer_id
     WHERE pc.status = 'pending' AND pc.reported_at < now() - interval '2 minutes'
     ORDER BY pc.reported_at ASC`
  );
  return rows;
}

async function listStaleClaims(hours) {
  const { rows } = await query(
    `SELECT pc.*, c.name, c.phone_number
     FROM payment_claims pc
     JOIN customers c ON c.id = pc.customer_id
     WHERE pc.status = 'pending' AND pc.reported_at < now() - ($1 || ' hours')::interval
     ORDER BY pc.reported_at ASC`,
    [hours]
  );
  return rows;
}

module.exports = {
  createClaim, findDuplicateUtr, findDuplicateTxnId, findClaimByIdPrefix,
  confirmClaim, rejectClaim, listPendingClaims, listStaleClaims,
};
