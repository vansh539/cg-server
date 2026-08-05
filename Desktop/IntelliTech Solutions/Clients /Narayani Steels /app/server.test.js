'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-server-'));
process.env.STOCK_DATA_PATH = path.join(tmpDir, 'stock.json');
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

test('dualTrack stock item: stock-in/deduct/adjust require both kg and pcs; report exposes pcs columns', async () => {
  const server = await listen();
  try {
    const cats = await (await fetch(`${baseUrl(server)}/api/stock/categories`)).json();
    const item = await (await postJson(server, '/api/stock/items', {
      categoryId: cats[0].id, name: 'Dual Test Item', unit: 'kg', dualTrack: true, initialStockKg: 0, initialStockPcs: 0,
    })).json();
    assert.equal(item.dualTrack, true);

    const badStockIn = await postJson(server, `/api/stock/items/${item.id}/stock-in`, { kg: 100 }); // pcs missing
    assert.equal(badStockIn.status, 400);

    const stockIn = await postJson(server, `/api/stock/items/${item.id}/stock-in`, { kg: 100, pcs: 40 });
    assert.equal(stockIn.status, 200);
    assert.equal((await stockIn.json()).stockPcs, 40);

    const deduct = await postJson(server, `/api/stock/items/${item.id}/deduct`, { kg: 10, pcs: 4, note: 'Chitti/Invoice' });
    assert.equal(deduct.status, 200);
    const deducted = await deduct.json();
    assert.equal(deducted.currentStockKg, 90);
    assert.equal(deducted.stockPcs, 36);

    const adjust = await postJson(server, `/api/stock/items/${item.id}/adjust`, { newTotalKg: 80, newTotalPcs: 30 });
    assert.equal(adjust.status, 200);
    const adjusted = await adjust.json();
    assert.equal(adjusted.currentStockKg, 80);
    assert.equal(adjusted.stockPcs, 30);

    const report = await (await fetch(`${baseUrl(server)}/api/stock/report?type=monthly`)).json();
    const row = report.rows.find((r) => r.itemId === item.id);
    assert.equal(row.dualTrack, true);
    assert.ok('closingPcs' in row);
  } finally {
    await close(server);
  }
});
