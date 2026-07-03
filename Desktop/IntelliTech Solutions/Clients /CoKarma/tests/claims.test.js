const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const customers = require('../src/ledger/customers');
const claims = require('../src/ledger/claims');
const { query } = require('../src/db/db');

test.beforeEach(resetDb);
test.after(async () => { await pool.end(); });

async function makeCustomer(phone = '9848358160') {
  return customers.createCustomer({ name: 'Asha Rao', phoneNumber: phone });
}

test('createClaim inserts a pending claim with no duplicate', async () => {
  const customer = await makeCustomer();
  const { claim, duplicateOf } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345',
  });
  assert.equal(claim.status, 'pending');
  assert.equal(Number(claim.amount_claimed), 1500);
  assert.equal(duplicateOf, null);
});

test('createClaim flags a duplicate UTR against an existing claim', async () => {
  const customer = await makeCustomer();
  await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });

  const other = await makeCustomer('9111111111');
  const { duplicateOf } = await claims.createClaim({ customerId: other.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });

  assert.ok(duplicateOf);
  assert.equal(duplicateOf.proof_reference, 'UTR12345');
});

test('createClaim does not flag a duplicate against a rejected prior claim with the same UTR', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });
  await claims.rejectClaim(claim.id, '9999900000', 'wrong amount');

  const { duplicateOf } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'utr_text', proofReference: 'UTR12345' });

  assert.equal(duplicateOf, null);
});

test('confirmClaim moves a pending claim to confirmed and records the reviewer', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const updated = await claims.confirmClaim(claim.id, '9999900000');
  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.reviewed_by, '9999900000');
});

test('confirmClaim returns null when the claim is already reviewed', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });
  await claims.confirmClaim(claim.id, '9999900000');

  const secondAttempt = await claims.confirmClaim(claim.id, '9999900000');
  assert.equal(secondAttempt, null);
});

test('rejectClaim moves a pending claim to rejected with a note', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const updated = await claims.rejectClaim(claim.id, '9999900000', 'amount mismatch');
  assert.equal(updated.status, 'rejected');
  assert.equal(updated.review_note, 'amount mismatch');
});

test('findClaimByIdPrefix matches on the leading characters of the uuid', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 1500, proofType: 'cash', proofReference: null });

  const matches = await claims.findClaimByIdPrefix(claim.id.slice(0, 8));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, claim.id);
});

test('listPendingClaims only returns pending claims, oldest first', async () => {
  const customer = await makeCustomer();
  const first = await claims.createClaim({ customerId: customer.id, amountClaimed: 100, proofType: 'cash', proofReference: null });
  const second = await claims.createClaim({ customerId: customer.id, amountClaimed: 200, proofType: 'cash', proofReference: null });
  await claims.confirmClaim(second.claim.id, '9999900000');
  await query(`UPDATE payment_claims SET reported_at = now() - interval '5 minutes' WHERE id = $1`, [first.claim.id]);
  await query(`UPDATE payment_claims SET reported_at = now() - interval '5 minutes' WHERE id = $1`, [second.claim.id]);

  const pending = await claims.listPendingClaims();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, first.claim.id);
  assert.equal(pending[0].name, 'Asha Rao');
});

test('listStaleClaims only returns pending claims older than the given hours', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 100, proofType: 'cash', proofReference: null });
  await query(`UPDATE payment_claims SET reported_at = now() - interval '2 days' WHERE id = $1`, [claim.id]);

  const stale = await claims.listStaleClaims(24);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, claim.id);

  const notStale = await claims.listStaleClaims(72);
  assert.equal(notStale.length, 0);
});

test('createClaim stores ocrExtractedAmount when provided', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 5000, proofType: 'screenshot', proofReference: 'shot.jpg', ocrExtractedAmount: 4000,
  });
  assert.equal(Number(claim.ocr_extracted_amount), 4000);
});

test('createClaim leaves ocr_extracted_amount null when omitted', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 5000, proofType: 'cash', proofReference: null });
  assert.equal(claim.ocr_extracted_amount, null);
});
