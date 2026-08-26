const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAmount } = require('../src/whatsapp/paymentIntent');

test('extractAmount finds a plain bare number', () => {
  assert.equal(extractAmount('Received 15000 payment from Shyam'), 15000);
});

test('extractAmount finds a currency-prefixed amount with commas', () => {
  assert.equal(extractAmount('Got ₹5,000 cash from Ramesh'), 5000);
});

test('extractAmount finds an Rs.-prefixed amount', () => {
  assert.equal(extractAmount('paid Rs.2500 today'), 2500);
});

test('extractAmount handles a decimal amount', () => {
  assert.equal(extractAmount('1234.50 received'), 1234.5);
});

test('extractAmount returns null when no amount-shaped number is present', () => {
  assert.equal(extractAmount('no amount mentioned here'), null);
});

test('extractAmount ignores small bare numbers under the 100 floor', () => {
  assert.equal(extractAmount('table 5 paid nothing'), null);
});

test('extractAmount picks the largest bare candidate when several are present and none is currency-marked', () => {
  assert.equal(extractAmount('15000 from Shyam, previous balance was 8000'), 15000);
});

const { extractDateInfo } = require('../src/whatsapp/paymentIntent');

const REF = new Date('2026-08-26T12:00:00');

test('extractDateInfo defaults to the reference date when nothing is mentioned', () => {
  const result = extractDateInfo('Received 15000 from Shyam', REF);
  assert.equal(result.iso, '2026-08-26');
  assert.equal(result.matchedText, null);
});

test('extractDateInfo parses "today"', () => {
  const result = extractDateInfo('Received 15000 from Shyam today', REF);
  assert.equal(result.iso, '2026-08-26');
});

test('extractDateInfo parses "yesterday"', () => {
  const result = extractDateInfo('Received 15000 from Shyam yesterday', REF);
  assert.equal(result.iso, '2026-08-25');
});

test('extractDateInfo parses an explicit dd-mm-yyyy date', () => {
  const result = extractDateInfo('Received 15000 from Shyam on 15-06-2026', REF);
  assert.equal(result.iso, '2026-06-15');
});

test('extractDateInfo parses "15th Aug"', () => {
  const result = extractDateInfo('Received 15000 from Shyam on 15th Aug', REF);
  assert.equal(result.iso, '2026-08-15');
});

test('extractDateInfo parses "3 days ago"', () => {
  const result = extractDateInfo('Received 15000 from Shyam 3 days ago', REF);
  assert.equal(result.iso, '2026-08-23');
});

test('extractDateInfo returns the matched substring so it can be masked out', () => {
  const result = extractDateInfo('Received 15000 from Shyam yesterday', REF);
  assert.equal(result.matchedText, 'yesterday');
});

const { extractMethod } = require('../src/whatsapp/paymentIntent');

test('extractMethod recognizes cash', () => {
  assert.equal(extractMethod('received 5000 cash from Ramesh'), 'cash');
});

test('extractMethod recognizes gpay and its spelling variants', () => {
  assert.equal(extractMethod('5000 via gpay from Shyam'), 'gpay');
  assert.equal(extractMethod('5000 via g pay from Shyam'), 'gpay');
  assert.equal(extractMethod('5000 via UPI from Shyam'), 'gpay');
});

test('extractMethod recognizes bank transfer and its abbreviations', () => {
  assert.equal(extractMethod('bank transfer of 5000'), 'bank_transfer');
  assert.equal(extractMethod('NEFT 5000 from X'), 'bank_transfer');
  assert.equal(extractMethod('5000 IMPS from X'), 'bank_transfer');
});

test('extractMethod returns null when no method keyword is present', () => {
  assert.equal(extractMethod('just received payment from Shyam'), null);
});

const { extractNameCandidatePhrases, resolveCustomerFromText, parsePaymentMessage } = require('../src/whatsapp/paymentIntent');

test('extractNameCandidatePhrases drops stopwords, amounts, and produces word + adjacent-pair candidates', () => {
  const phrases = extractNameCandidatePhrases('Received 15000 payment from Shyam miyapur today');
  assert.ok(phrases.includes('Shyam'));
  assert.ok(phrases.includes('miyapur'));
  assert.ok(phrases.includes('Shyam miyapur'));
  assert.ok(!phrases.some((p) => p.toLowerCase().includes('received')));
  assert.ok(!phrases.some((p) => p.toLowerCase().includes('today')));
  assert.ok(!phrases.includes('15000'));
});

test('extractNameCandidatePhrases orders longer phrases first', () => {
  const phrases = extractNameCandidatePhrases('paid 5000 to Shyam Kumar');
  assert.equal(phrases[0], 'Shyam Kumar');
});

async function fakeFindByNameOrPhone(term) {
  const db = [
    { id: '1', name: 'Shyam Miyapur Traders' },
    { id: '2', name: 'Shyam Kumar' },
    { id: '3', name: 'Ramesh Stores' },
  ];
  const lower = term.toLowerCase();
  return db.filter((c) => c.name.toLowerCase().includes(lower));
}

test('resolveCustomerFromText resolves an unambiguous two-word match uniquely', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Shyam miyapur today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '1');
});

test('resolveCustomerFromText surfaces both candidates on an ambiguous single-word match', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Shyam today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 2);
});

test('resolveCustomerFromText returns an empty array when nothing matches', async () => {
  const phrases = extractNameCandidatePhrases('Received 15000 from Nobody today');
  const results = await resolveCustomerFromText(phrases, fakeFindByNameOrPhone);
  assert.equal(results.length, 0);
});

test('parsePaymentMessage masks the matched date text out before amount/method/name extraction', () => {
  const result = parsePaymentMessage('Received 15000 payment from Shyam miyapur on 15-06-2026', new Date('2026-08-26'));
  assert.equal(result.amount, 15000);
  assert.equal(result.date, '2026-06-15');
  assert.ok(result.candidatePhrases.includes('Shyam'));
  assert.ok(!result.candidatePhrases.some((p) => p.includes('15-06-2026')));
});

test('parsePaymentMessage extracts method alongside amount/date/name', () => {
  const result = parsePaymentMessage('Received 5000 cash from Ramesh today', new Date('2026-08-26'));
  assert.equal(result.amount, 5000);
  assert.equal(result.method, 'cash');
  assert.ok(result.candidatePhrases.includes('Ramesh'));
});

test('parsePaymentMessage returns a null amount when the message has none', () => {
  const result = parsePaymentMessage('hello there', new Date('2026-08-26'));
  assert.equal(result.amount, null);
});
