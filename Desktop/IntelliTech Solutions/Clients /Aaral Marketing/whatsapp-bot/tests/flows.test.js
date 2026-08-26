const test = require('node:test');
const assert = require('node:assert/strict');
const flows = require('../src/whatsapp/flows');

test('parseAdminCommand parses BALANCE with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('balance Asha Rao'), { command: 'BALANCE', query: 'Asha Rao' });
});

test('parseAdminCommand parses LEDGER with a free-text query', () => {
  assert.deepEqual(flows.parseAdminCommand('ledger Asha Rao'), { command: 'LEDGER', query: 'Asha Rao' });
});

test('parseAdminCommand parses IMPORT and unknown text', () => {
  assert.deepEqual(flows.parseAdminCommand('import'), { command: 'IMPORT', force: false });
  assert.deepEqual(flows.parseAdminCommand('hello there'), { command: 'UNKNOWN' });
});

test('parseAdminCommand parses plain IMPORT with force false', () => {
  const result = flows.parseAdminCommand('IMPORT');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, false);
});

test('parseAdminCommand parses IMPORT FORCE with force true', () => {
  const result = flows.parseAdminCommand('IMPORT FORCE');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, true);
});

test('parseAdminCommand parses IMPORT FORCE case-insensitively', () => {
  const result = flows.parseAdminCommand('import force');
  assert.equal(result.command, 'IMPORT');
  assert.equal(result.force, true);
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

test('formatBalanceLine returns settled-up message when balance is zero', () => {
  assert.equal(flows.formatBalanceLine('0.00'), "You're all settled up!");
});

test('formatBalanceLine returns settled-up message when balance is negative', () => {
  assert.equal(flows.formatBalanceLine('-500.00'), "You're all settled up!");
});

test('formatBalanceLine returns the remaining balance when balance is positive', () => {
  assert.equal(flows.formatBalanceLine('1500.00'), 'Remaining balance: ₹1500.00');
});

test('formatBalanceLine accepts a plain number', () => {
  assert.equal(flows.formatBalanceLine(2000), 'Remaining balance: ₹2000');
});
