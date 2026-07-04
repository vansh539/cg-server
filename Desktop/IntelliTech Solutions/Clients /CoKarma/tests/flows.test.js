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

test('extractTxnId finds a UPI txn ID label', () => {
  assert.equal(flows.extractTxnId('UPI txn ID : 002926693520'), '002926693520');
});

test('extractTxnId finds a UPI Ref No label', () => {
  assert.equal(flows.extractTxnId('UPI Ref No: 123456789012'), '123456789012');
});

test('extractTxnId finds a bare Transaction ID label', () => {
  assert.equal(flows.extractTxnId('Transaction ID: 987654321098'), '987654321098');
});

test('extractTxnId returns null when no recognizable label is present', () => {
  assert.equal(flows.extractTxnId('Payment successful\nto PREETI AGARWAL'), null);
});

test('extractTxnId finds the ID in a full real screenshot OCR dump', () => {
  const ocrText = 'Paid securely on\nn\' navi =r\nGet up to @1,000 on every payment | @100 = 1\nPayment successful\nto PREETI AGARWAL\n& preetiagrwal1982@okhdfcbank\n4,000\nPaid via Navi UPI\n19 Jun 2026, 11:07 PM\nfrom Mr YAPRALA SHIVA SHANKAR\n% CITY UNION BANK LTD - 3743\nUPI txn ID : 002926693520';
  assert.equal(flows.extractTxnId(ocrText), '002926693520');
});

test('extractTxnId does not treat "id" inside an unrelated word as a label', () => {
  assert.equal(flows.extractTxnId('You paid 123456789012 successfully'), null);
});

test('extractPaymentDate finds a DD Mon YYYY date with a time suffix', () => {
  assert.equal(flows.extractPaymentDate('19 Jun 2026, 11:07 PM'), '2026-06-19');
});

test('extractPaymentDate finds a full month name', () => {
  assert.equal(flows.extractPaymentDate('Payment successful\n15 December 2026'), '2026-12-15');
});

test('extractPaymentDate returns null when no date is present', () => {
  assert.equal(flows.extractPaymentDate('No date here at all'), null);
});

test('extractPaymentDate returns null for an unrecognizable month name', () => {
  assert.equal(flows.extractPaymentDate('19 Zzz 2026'), null);
});

test('extractPaymentDate finds the date in a full real screenshot OCR dump', () => {
  const ocrText = 'Paid securely on\nn\' navi =r\nGet up to @1,000 on every payment | @100 = 1\nPayment successful\nto PREETI AGARWAL\n& preetiagrwal1982@okhdfcbank\n4,000\nPaid via Navi UPI\n19 Jun 2026, 11:07 PM\nfrom Mr YAPRALA SHIVA SHANKAR\n% CITY UNION BANK LTD - 3743\nUPI txn ID : 002926693520';
  assert.equal(flows.extractPaymentDate(ocrText), '2026-06-19');
});

test('extractPaymentDate rejects a calendar-impossible day-month combination', () => {
  assert.equal(flows.extractPaymentDate('31 Apr 2026'), null);
});
