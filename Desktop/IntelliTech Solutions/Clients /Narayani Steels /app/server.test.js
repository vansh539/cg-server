'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-server-'));
process.env.STOCK_DATA_PATH = path.join(tmpDir, 'stock.json');
process.env.LEDGER_DATA_PATH = path.join(tmpDir, 'ledger.json');
process.env.PORT = '0'; // unused directly by tests, but keeps server.js's default sane if ever invoked

const app = require('./server.js');

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
async function postJson(server, urlPath, body) {
  return fetch(`${baseUrl(server)}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET /api/stock/categories returns the 6 preset categories', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/stock/categories`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 6);
    assert.ok(body.some((c) => c.name === 'TMT Bars'));
  } finally {
    await close(server);
  }
});

test('POST /api/stock/categories creates a category, rejects duplicates', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/stock/categories', { name: 'Nails' });
    assert.equal(res.status, 201);
    const dup = await postJson(server, '/api/stock/categories', { name: 'nails' });
    assert.equal(dup.status, 400);
    const dupBody = await dup.json();
    assert.equal(dupBody.error, 'Category already exists');
  } finally {
    await close(server);
  }
});

test('POST /api/stock/items creates an item and computes pieces', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const tmt = cats.find((c) => c.name === 'TMT Bars');
    const res = await postJson(server, '/api/stock/items', {
      categoryId: tmt.id,
      name: 'TMT 12mm Bar',
      weightPerPieceKg: 10.5,
      initialStockKg: 105,
    });
    assert.equal(res.status, 201);
    const item = await res.json();
    assert.equal(item.currentStockKg, 105);
    assert.equal(item.pieces, 10);
  } finally {
    await close(server);
  }
});

test('POST /api/stock/items rejects an unknown category with 400', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/stock/items', { categoryId: 'nope', name: 'Ghost Item' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Category not found');
  } finally {
    await close(server);
  }
});

test('stock-in, deduct, and adjust update currentStockKg via the ledger; unknown item is 404', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const cement = cats.find((c) => c.name === 'Cement');
    const created = await (
      await postJson(server, '/api/stock/items', {
        categoryId: cement.id,
        name: 'UltraTech 50kg Bag',
        weightPerPieceKg: 50,
        initialStockKg: 1000,
      })
    ).json();

    const afterStockIn = await (await postJson(server, `/api/stock/items/${created.id}/stock-in`, { kg: 500 })).json();
    assert.equal(afterStockIn.currentStockKg, 1500);

    const afterDeduct = await (await postJson(server, `/api/stock/items/${created.id}/deduct`, { kg: 1800 })).json();
    assert.equal(afterDeduct.currentStockKg, -300);

    const afterAdjust = await (
      await postJson(server, `/api/stock/items/${created.id}/adjust`, { newTotalKg: 200 })
    ).json();
    assert.equal(afterAdjust.currentStockKg, 200);

    const movements = await (await fetch(`${baseUrl(server)}/api/stock/items/${created.id}/movements`)).json();
    assert.equal(movements.length, 4);
    assert.equal(movements[0].reason, 'adjustment');

    const missing = await postJson(server, '/api/stock/items/item_ghost/stock-in', { kg: 10 });
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test('GET /api/stock/items/:id/movements 404s for an unknown item', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/stock/items/item_ghost/movements`);
    assert.equal(res.status, 404);
  } finally {
    await close(server);
  }
});

test('a corrupted stock.json disables only /api/stock/* (500), not the rest of the app', async () => {
  const corruptFile = path.join(tmpDir, 'corrupt-stock.json');
  fs.writeFileSync(corruptFile, '{ not valid json');
  const prevPath = process.env.STOCK_DATA_PATH;
  process.env.STOCK_DATA_PATH = corruptFile;
  delete require.cache[require.resolve('./server.js')];
  const corruptApp = require('./server.js');
  process.env.STOCK_DATA_PATH = prevPath; // restore for any later require in this process

  const server = await new Promise((resolve) => {
    const s = http.createServer(corruptApp);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const stockRes = await fetch(`${baseUrl(server)}/api/stock/categories`);
    assert.equal(stockRes.status, 500);
    const staticRes = await fetch(`${baseUrl(server)}/final-invoice-NS.html`);
    assert.equal(staticRes.status, 200); // rest of the app still works
  } finally {
    await close(server);
  }
});

test('GET /api/ledger/customers starts empty', async () => {
  const server = await listen();
  try {
    const res = await fetch(`${baseUrl(server)}/api/ledger/customers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/customers creates a customer, validates input', async () => {
  const server = await listen();
  try {
    const res = await postJson(server, '/api/ledger/customers', { name: 'Lakshmi Steel', phone: '9876543210' });
    assert.equal(res.status, 201);
    const cust = await res.json();
    assert.equal(cust.balance, 0);

    const bad = await postJson(server, '/api/ledger/customers', { name: '', phone: '123' });
    assert.equal(bad.status, 400);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/invoices creates an invoice + due entry, excludes old balance from the due amount', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Test Buyer', phone: '9998887776' })).json();
    const res = await postJson(server, '/api/ledger/invoices', {
      customerId: cust.id, date: '17/07/2026', mobile: '9998887776', lorry: 'TS08AB1234',
      items: [{ q: '500', name: 'MS Angle', p: '20', r: '52' }],
      sub: 26000, lab: 200, weigh: 0, freight: 0, unload: 0, gst: 4716, others: 0, advance: 2000,
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.invoiceNo, 1);
    assert.equal(body.customerName, 'Test Buyer');
    assert.equal(body.total, 26000 + 200 + 4716);

    const entriesRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}/entries`);
    const entries = await entriesRes.json();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].reason, 'invoice');
    assert.equal(entries[1].reason, 'advance');

    const custRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`);
    const custBody = await custRes.json();
    assert.equal(custBody.balance, (26000 + 200 + 4716) - 2000);
  } finally {
    await close(server);
  }
});

test('POST /api/ledger/customers/:id/old-balance and /cash-paid update the ledger; unknown customer is 404', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Backfill Co', phone: '5556667778' })).json();
    const oldBalRes = await postJson(server, `/api/ledger/customers/${cust.id}/old-balance`, { amount: 15000, note: 'Pre-system' });
    assert.equal(oldBalRes.status, 201);

    const cashRes = await postJson(server, `/api/ledger/customers/${cust.id}/cash-paid`, { amount: 5000 });
    assert.equal(cashRes.status, 201);

    const custRes = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`);
    assert.equal((await custRes.json()).balance, 10000);

    const missing = await postJson(server, '/api/ledger/customers/cust_ghost/old-balance', { amount: 100 });
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test('pdfRowAmount bills piece-rate rows (no qty) as Pcs x Rate, matching the client-side rowAmount()', () => {
  // Regression test: pdfTableRows previously computed q*rt only, so a
  // piece-billed item (q blank, p+r filled) showed a blank/₹0 Amount on the
  // actual WhatsApp invoice PDF sent to customers, even though the invoice
  // total (computed separately from the client's own `sub`) was correct.
  assert.equal(app.pdfRowAmount({ q: '', p: '20', r: '52' }), 1040);
  assert.equal(app.pdfRowAmount({ q: '0', p: '20', r: '52' }), 1040);
  assert.equal(app.pdfRowAmount({ q: '500', p: '', r: '52' }), 26000);
  assert.equal(app.pdfRowAmount({ q: '', p: '', r: '52' }), 0);
  assert.ok(app.pdfTableRows([{ q: '', name: 'Covering Block', p: '20', r: '52' }]).includes('1,040'));
});

test('GET /api/ledger/invoices/:id returns the snapshot with customerName; 404 for unknown', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Snapshot Co', phone: '2223334445' })).json();
    const created = await (
      await postJson(server, '/api/ledger/invoices', {
        customerId: cust.id, date: '17/07/2026', mobile: '2223334445', lorry: 'TS09ZZ0001',
        items: [{ q: '10', name: 'Rod', p: '1', r: '5' }], sub: 50, lab: 5, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
      })
    ).json();

    const res = await fetch(`${baseUrl(server)}/api/ledger/invoices/${created.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.customerName, 'Snapshot Co');
    assert.equal(body.items.length, 1);

    const missing = await fetch(`${baseUrl(server)}/api/ledger/invoices/inv_ghost`);
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

async function deleteReq(server, urlPath, body) {
  return fetch(`${baseUrl(server)}${urlPath}`, {
    method: 'DELETE',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('DELETE /api/ledger/entries/:id on an invoice entry voids the whole invoice (entry + advance + invoice record)', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Void Test Co', phone: '9001112223' })).json();
    const invoice = await (
      await postJson(server, '/api/ledger/invoices', {
        customerId: cust.id, date: '01/08/2026', mobile: '9001112223', lorry: 'TS01AB0001',
        items: [{ q: '100', name: 'Angle', p: '', r: '50' }],
        sub: 5000, lab: 40, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 1000,
      })
    ).json();

    let entries = await (await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}/entries`)).json();
    assert.equal(entries.length, 2); // invoice (due) + advance
    const invoiceEntry = entries.find((e) => e.reason === 'invoice');

    const delRes = await deleteReq(server, `/api/ledger/entries/${invoiceEntry.id}`);
    assert.equal(delRes.status, 204);

    entries = await (await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}/entries`)).json();
    assert.equal(entries.length, 0); // both the invoice entry and its paired advance entry are gone

    const custAfter = await (await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`)).json();
    assert.equal(custAfter.balance, 0);

    const invoiceAfter = await fetch(`${baseUrl(server)}/api/ledger/invoices/${invoice.id}`);
    assert.equal(invoiceAfter.status, 404); // invoice record itself is gone too, nothing left dangling
  } finally {
    await close(server);
  }
});

test('DELETE /api/ledger/customers/:id cascades to their invoices and entries; unknown customer is 404', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Delete Me Co', phone: '9002223334' })).json();
    await postJson(server, `/api/ledger/customers/${cust.id}/old-balance`, { amount: 500 });
    const invoice = await (
      await postJson(server, '/api/ledger/invoices', {
        customerId: cust.id, date: '01/08/2026', mobile: '9002223334', lorry: 'TS01AB0002',
        items: [{ q: '10', name: 'Rod', p: '', r: '50' }], sub: 500, lab: 4, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
      })
    ).json();

    const delRes = await deleteReq(server, `/api/ledger/customers/${cust.id}`);
    assert.equal(delRes.status, 204);

    const custAfter = await fetch(`${baseUrl(server)}/api/ledger/customers/${cust.id}`);
    assert.equal(custAfter.status, 404);
    const invoiceAfter = await fetch(`${baseUrl(server)}/api/ledger/invoices/${invoice.id}`);
    assert.equal(invoiceAfter.status, 404);
    const listAfter = await (await fetch(`${baseUrl(server)}/api/ledger/customers`)).json();
    assert.ok(!listAfter.some((c) => c.id === cust.id));

    const missing = await deleteReq(server, '/api/ledger/customers/cust_ghost');
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test('DELETE /api/ledger/reset requires the exact confirmation phrase and then wipes everything', async () => {
  const server = await listen();
  try {
    const cust = await (await postJson(server, '/api/ledger/customers', { name: 'Reset Test Co', phone: '9003334445' })).json();
    await postJson(server, `/api/ledger/customers/${cust.id}/old-balance`, { amount: 1000 });

    const noConfirm = await deleteReq(server, '/api/ledger/reset');
    assert.equal(noConfirm.status, 400);
    const wrongConfirm = await deleteReq(server, '/api/ledger/reset', { confirm: 'delete all ledger data' });
    assert.equal(wrongConfirm.status, 400);

    // Nothing was touched by the two rejected attempts (checked by presence,
    // not array length — this test file shares one ledger.json across tests
    // run in the same process, so other tests' customers are already in it).
    let list = await (await fetch(`${baseUrl(server)}/api/ledger/customers`)).json();
    assert.ok(list.some((c) => c.id === cust.id));

    const ok = await deleteReq(server, '/api/ledger/reset', { confirm: 'DELETE ALL LEDGER DATA' });
    assert.equal(ok.status, 204);

    list = await (await fetch(`${baseUrl(server)}/api/ledger/customers`)).json();
    assert.equal(list.length, 0);

    // Invoice numbering restarts after a reset.
    const newCust = await (await postJson(server, '/api/ledger/customers', { name: 'Post Reset Co', phone: '9004445556' })).json();
    const newInvoice = await (
      await postJson(server, '/api/ledger/invoices', {
        customerId: newCust.id, date: '01/08/2026', mobile: '9004445556', lorry: 'TS01AB0003',
        items: [{ q: '1', name: 'Rod', p: '', r: '10' }], sub: 10, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
      })
    ).json();
    assert.equal(newInvoice.invoiceNo, 1);
  } finally {
    await close(server);
  }
});
