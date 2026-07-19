ALTER TABLE payment_claims DROP CONSTRAINT payment_claims_proof_type_check;
ALTER TABLE payment_claims ADD CONSTRAINT payment_claims_proof_type_check
  CHECK (proof_type IN ('screenshot', 'utr_text', 'cash', 'gpay', 'bank_transfer'));
