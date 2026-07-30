const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPin, verifyPin } = require('../src/adminAuth');

test('verifyPin accepts the correct PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin('4821'), true);
});

test('verifyPin rejects a wrong PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin('0000'), false);
});

test('verifyPin rejects when no PIN is configured', () => {
  delete process.env.ADMIN_PIN_HASH;
  assert.equal(verifyPin('4821'), false);
});

test('verifyPin rejects an empty supplied PIN', () => {
  process.env.ADMIN_PIN_HASH = hashPin('4821');
  assert.equal(verifyPin(''), false);
  assert.equal(verifyPin(undefined), false);
});
