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

test('toWhatsAppChatId prepends 91 to a bare 10-digit number', () => {
  assert.equal(flows.toWhatsAppChatId('9848358160'), '919848358160@c.us');
});

test('toWhatsAppChatId normalizes a number with country code and formatting', () => {
  assert.equal(flows.toWhatsAppChatId('+91 98483 58160'), '919848358160@c.us');
});

test('toWhatsAppChatId does not crash on null/undefined/empty input', () => {
  assert.equal(flows.toWhatsAppChatId(''), '@c.us');
  assert.equal(flows.toWhatsAppChatId(null), '@c.us');
  assert.equal(flows.toWhatsAppChatId(undefined), '@c.us');
});

test('extractAmountMatch finds a currency-prefixed amount that matches', () => {
  const result = flows.extractAmountMatch('Payment Successful\n₹5,000\nTo: CoKarma', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch finds a currency-prefixed amount that does not match', () => {
  const result = flows.extractAmountMatch('Paid Rs 4000 successfully', 5000);
  assert.equal(result.matched, false);
  assert.equal(result.extractedAmount, 4000);
});

test('extractAmountMatch handles a currency-suffixed amount', () => {
  const result = flows.extractAmountMatch('5000 INR received', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch handles decimal amounts', () => {
  const result = flows.extractAmountMatch('INR 1,234.50 paid', 1234.5);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 1234.5);
});

test('extractAmountMatch ignores bare numbers with no currency marker', () => {
  const result = flows.extractAmountMatch('Transaction ID 240915001234 on 15/09/2026', 5000);
  assert.equal(result.matched, null);
  assert.equal(result.extractedAmount, null);
});

test('extractAmountMatch returns the skip case for empty OCR text', () => {
  const result = flows.extractAmountMatch('', 5000);
  assert.equal(result.matched, null);
  assert.equal(result.extractedAmount, null);
});

test('extractAmountMatch finds the matching candidate among multiple currency-adjacent numbers', () => {
  const result = flows.extractAmountMatch('Balance ₹9999 Amount Paid ₹5000', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch does not treat "rs" inside an unrelated word as a currency marker', () => {
  const result = flows.extractAmountMatch('Paid Rs 4000 successfully\nMembers 5000 today', 5000);
  assert.equal(result.matched, false);
  assert.equal(result.extractedAmount, 4000);
});

test('extractAmountMatch uses the earliest candidate in text order when no candidate matches', () => {
  const result = flows.extractAmountMatch('5000 INR received, Rs 3000 also seen', 9999);
  assert.equal(result.matched, false);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch treats a number alone on its own line as a candidate', () => {
  const result = flows.extractAmountMatch('Payment successful\n4,000\nPaid via UPI\nUPI txn ID : 002926693520', 4000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 4000);
});

test('extractAmountMatch does not treat a number with surrounding text on the same line as standalone', () => {
  const result = flows.extractAmountMatch('UPI txn ID : 002926693520', 4000);
  assert.equal(result.matched, null);
  assert.equal(result.extractedAmount, null);
});

test('extractAmountMatch catches a misread currency symbol fused to the amount on its own line', () => {
  const result = flows.extractAmountMatch('Payment successful\n24,000\nPaid via Navi UPI', 24000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 24000);
});

test('extractAmountMatch recognizes a correct payment despite a misread currency symbol prefix', () => {
  const result = flows.extractAmountMatch('Payment successful\n24,000\nPaid via Navi UPI', 4000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 4000);
});

test('extractAmountMatch does not invent a stripped candidate from a cleanly-read number', () => {
  const result = flows.extractAmountMatch('Payment successful\n4,000\nPaid via Navi UPI', 999);
  assert.equal(result.matched, false);
  assert.equal(result.extractedAmount, 4000);
});
