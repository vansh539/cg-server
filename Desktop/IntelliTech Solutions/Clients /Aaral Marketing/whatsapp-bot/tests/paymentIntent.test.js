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
