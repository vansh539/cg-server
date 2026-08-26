const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, pool } = require('./helpers/db');
const { query } = require('payment-ledger-core/db');
const { logActivity } = require('../src/activityLog');

test.after(async () => { await pool.end(); });
test.beforeEach(resetDb);

async function createAdminAndSession(displayName = 'Admin One') {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('password123', 10);
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
    [`admin_${Date.now()}`, hash, displayName, `9${Date.now()}`.slice(0, 10)]
  );
  return rows[0].id;
}

// The routes are session-gated in production, but hitting the route module
// directly through raw fetch makes real session-cookie login awkward, so
// the route-level behavior that doesn't depend on session identity
// (validation, delete-blocking) is exercised via direct SQL setup + a stub
// Express app mounting just this router, matching the existing dashboard
// test convention of testing route logic without a full login round-trip.
const express = require('express');
const usersRouter = require('../src/routes/users');

const ADMIN_SESSION = { id: '00000000-0000-0000-0000-000000000001', username: 'admin1', displayName: 'Stub Admin', role: 'admin' };

function buildTestApp(sessionUser) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, _res, next) => { req.session = { user: sessionUser }; next(); });
  testApp.use('/api', usersRouter);
  return testApp;
}

// Guarantees the ephemeral test server is always closed, even if an
// assertion inside fn() throws -- without this, a failing test leaks an
// open listener, and enough of those left open across a run can stop the
// node --test process from ever exiting cleanly.
async function withServer(sessionUser, fn) {
  const server = buildTestApp(sessionUser).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /users requires a phone number', async () => {
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newemp', password: 'password123', displayName: 'New Emp', role: 'employee' }),
    });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.match(data.error, /phone/i);
  });
});

test('POST /users creates a user with a phone number', async () => {
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newemp2', password: 'password123', displayName: 'New Emp Two', role: 'employee', phoneNumber: '9812300001' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.user.phone_number, '9812300001');
  });
});

test('PATCH /users/:id/phone updates the phone number', async () => {
  const adminId = await createAdminAndSession();
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users/${adminId}/phone`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '9812399999' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    const { rows } = await query('SELECT phone_number FROM dashboard_users WHERE id = $1', [adminId]);
    assert.equal(rows[0].phone_number, '9812399999');
  });
});

test('PATCH /users/:id/phone rejects a duplicate phone number', async () => {
  const firstId = await createAdminAndSession('First Admin');
  await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('second_admin', 'x', 'Second Admin', 'employee', '9812311111')`
  );
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users/${firstId}/phone`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '9812311111' }),
    });
    assert.equal(res.status, 400);
  });
});

test('DELETE /users/:id removes a user with no activity history', async () => {
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('throwaway', 'x', 'Throwaway', 'employee', '9812322222') RETURNING id`
  );
  const targetId = rows[0].id;
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users/${targetId}`, { method: 'DELETE' });
    const data = await res.json();
    assert.equal(data.ok, true);
    const { rows: remaining } = await query('SELECT 1 FROM dashboard_users WHERE id = $1', [targetId]);
    assert.equal(remaining.length, 0);
  });
});

test('DELETE /users/:id refuses a user with activity history', async () => {
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role, phone_number)
     VALUES ('has_history', 'x', 'Has History', 'employee', '9812333333') RETURNING id`
  );
  const targetId = rows[0].id;
  const fakeReq = { session: { user: { id: targetId, username: 'has_history', displayName: 'Has History' } } };
  await logActivity(fakeReq, 'recorded payment', 'test activity');

  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users/${targetId}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    const { rows: stillThere } = await query('SELECT 1 FROM dashboard_users WHERE id = $1', [targetId]);
    assert.equal(stillThere.length, 1);
  });
});

test('DELETE /users/:id refuses to delete the last active admin', async () => {
  const adminId = await createAdminAndSession('Only Admin');
  await withServer(ADMIN_SESSION, async (url) => {
    const res = await fetch(`${url}/api/users/${adminId}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
  });
});
