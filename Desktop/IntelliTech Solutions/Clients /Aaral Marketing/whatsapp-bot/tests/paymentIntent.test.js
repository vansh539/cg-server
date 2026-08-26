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
