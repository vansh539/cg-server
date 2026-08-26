const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { resetDb, pool } = require('./helpers/db');
const customers = require('payment-ledger-core/ledger/customers');

// Mounts only the router under test in a bare Express app -- NOT
// require('../server'), which calls app.listen(PORT, '0.0.0.0', ...) as a
// module-load side effect, so requiring it here would try to bind the real
// dashboard port during every test run. This matches the rest of this
// codebase's actual test convention (business-logic functions called
// directly, never through a live HTTP server) as closely as possible while
// still exercising the secret-header middleware, which is the one
// genuinely new request-layer behavior in this task.
process.env.BOT_INTERNAL_SECRET = 'test-internal-secret';
const botInternalRouter = require('../src/routes/botInternal');

function buildTestApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(botInternalRouter);
  return testApp;
}

test.after(async () => { await pool.end(); });
test.beforeEach(resetDb);

function postJson(baseUrl, path, body, headers) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('rejects a request with no secret header', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345670' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(baseUrl, '/internal/bot/ledger-pdf', { customerId: customer.id }, {});
  assert.equal(res.status, 401);
  server.close();
});

test('rejects a request with the wrong secret header', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345671' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(baseUrl, '/internal/bot/ledger-pdf', { customerId: customer.id }, { 'X-Bot-Internal-Secret': 'wrong' });
  assert.equal(res.status, 401);
  server.close();
});

test('returns a 404 for an unknown customer with the correct secret', async () => {
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(
    baseUrl, '/internal/bot/ledger-pdf',
    { customerId: '00000000-0000-0000-0000-000000000000' },
    { 'X-Bot-Internal-Secret': 'test-internal-secret' }
  );
  assert.equal(res.status, 404);
  server.close();
});

test('returns a PDF for a real customer with the correct secret', async () => {
  const customer = await customers.createCustomer({ name: 'Shyam Miyapur Traders', phoneNumber: '9812345672' });
  const server = buildTestApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await postJson(
    baseUrl, '/internal/bot/ledger-pdf',
    { customerId: customer.id },
    { 'X-Bot-Internal-Secret': 'test-internal-secret' }
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.pdfBase64.length > 0);
  assert.ok(data.filename.includes('Shyam'));
  assert.match(data.balanceLine, /Shyam Miyapur Traders/);
  server.close();
});
