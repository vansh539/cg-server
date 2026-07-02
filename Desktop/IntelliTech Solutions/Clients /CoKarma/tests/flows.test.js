const test = require('node:test');
const assert = require('node:assert/strict');
const flows = require('../src/whatsapp/flows');

test('handleRegistrationName rejects names under 2 characters', () => {
  assert.equal(flows.handleRegistrationName('A').ok, false);
});

test('handleRegistrationName accepts and trims a valid name', () => {
  const result = flows.handleRegistrationName('  Asha Rao  ');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Asha Rao');
});

test('handleAmountReply parses a plain number', () => {
  const result = flows.handleAmountReply('5000');
  assert.equal(result.ok, true);
  assert.equal(result.amount, 5000);
});

test('handleAmountReply strips currency symbols and commas', () => {
  const result = flows.handleAmountReply('₹5,000');
  assert.equal(result.ok, true);
  assert.equal(result.amount, 5000);
});

test('handleAmountReply rejects non-numeric or zero input', () => {
  assert.equal(flows.handleAmountReply('abc').ok, false);
  assert.equal(flows.handleAmountReply('0').ok, false);
  assert.equal(flows.handleAmountReply('-5').ok, false);
});

test('handleProofReply classifies media as a screenshot', () => {
  const result = flows.handleProofReply('', true);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'screenshot');
});

test('handleProofReply classifies CASH (case-insensitive)', () => {
  const result = flows.handleProofReply('cash', false);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'cash');
});

test('handleProofReply classifies an alphanumeric reference as utr_text, uppercased', () => {
  const result = flows.handleProofReply('utr123abc', false);
  assert.equal(result.ok, true);
  assert.equal(result.proofType, 'utr_text');
  assert.equal(result.proofReference, 'UTR123ABC');
});

test('handleProofReply rejects unrecognizable input', () => {
  const result = flows.handleProofReply('idk maybe later', false);
  assert.equal(result.ok, false);
});

test('parseAdminCommand parses CONFIRM with an id', () => {
  assert.deepEqual(flows.parseAdminCommand('CONFIRM ab12cd34'), { command: 'CONFIRM', claimId: 'ab12cd34' });
});

test('parseAdminCommand parses REJECT with an id and reason', () => {
  assert.deepEqual(
    flows.parseAdminCommand('REJECT ab12cd34 wrong amount'),
    { command: 'REJECT', claimId: 'ab12cd34', reason: 'wrong amount' }
  );
});

test('parseAdminCommand parses REJECT with no reason', () => {
  assert.deepEqual(flows.parseAdminCommand('REJECT ab12cd34'), { command: 'REJECT', claimId: 'ab12cd34', reason: null });
});

test('parseAdminCommand parses PENDING LINKS distinctly from PENDING', () => {
  assert.deepEqual(flows.parseAdminCommand('pending'), { command: 'PENDING' });
  assert.deepEqual(flows.parseAdminCommand('pending links'), { command: 'PENDING_LINKS' });
});

test('parseAdminCommand parses BALANCE with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('balance Asha Rao'), { command: 'BALANCE', query: 'Asha Rao' });
});

test('parseAdminCommand parses IMPORT and unknown text', () => {
  assert.deepEqual(flows.parseAdminCommand('import'), { command: 'IMPORT' });
  assert.deepEqual(flows.parseAdminCommand('hello there'), { command: 'UNKNOWN' });
});
