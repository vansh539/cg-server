'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync } = require('child_process');
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');

const app  = express();
const PORT = process.env.PORT || 3300;

const STOCK_DATA_PATH = process.env.STOCK_DATA_PATH || path.join(__dirname, 'data', 'stock.json');
const stockStore = createStore(STOCK_DATA_PATH);
let _stockInitError = null;
try {
  stockStore.init();
} catch (err) {
  _stockInitError = err;
  console.error(`[Stock] Failed to load stock data: ${err.message}`);
}

function sendStockError(res, err) {
  const status = err.message === 'Item not found' ? 404 : 400;
  res.status(status).json({ error: err.message });
}

// Guards every /api/stock/* route: a corrupted stock.json must not take down
// the rest of the app (billing still needs to work) — it only disables stock.
function requireStock(req, res, next) {
  if (_stockInitError) return res.status(500).json({ error: 'Stock data is unavailable — see server logs.' });
  next();
}

const LEDGER_DATA_PATH = process.env.LEDGER_DATA_PATH || path.join(__dirname, 'data', 'ledger.json');
const ledgerStore = createLedgerStore(LEDGER_DATA_PATH);
let _ledgerInitError = null;
try {
  ledgerStore.init();
} catch (err) {
  _ledgerInitError = err;
  console.error(`[Ledger] Failed to load ledger data: ${err.message}`);
}

function sendLedgerError(res, err) {
  const status = /not found/i.test(err.message) ? 404 : 400;
  res.status(status).json({ error: err.message });
}

// Guards every /api/ledger/* route — same reasoning as requireStock: a
// corrupted ledger.json must not take down billing or Stock.
function requireLedger(req, res, next) {
  if (_ledgerInitError) return res.status(500).json({ error: 'Ledger data is unavailable — see server logs.' });
  next();
}

// ─── License validation ───────────────────────────────────────────────────────

const _LS = '0d7a2e955e516326ece7612a68a97d00cf62bab779e65b5cc14e819e2decfbc4';

function _getMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic csproduct get UUID /value', { encoding: 'utf8', timeout: 4000 });
      const m = out.match(/UUID=([^\r\n]+)/);
      return m ? m[1].trim() : null;
    }
  } catch (_) {}
  return null; // non-Windows: skip machine check (dev environment)
}

function _checkLicense() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'license.key'), 'utf8').trim();
    const dot  = raw.lastIndexOf('.');
    if (dot === -1) return 'Invalid license format';
    const payloadB64 = raw.slice(0, dot);
    const sig        = raw.slice(dot + 1);
    const expected   = crypto.createHmac('sha256', _LS).update(payloadB64).digest('hex');
    if (sig !== expected) return 'License key is invalid';
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (new Date(p.expires) < new Date()) return `License expired on ${p.expires}`;
    const machineId = _getMachineId();
    if (p.machine && p.machine !== '*' && machineId && p.machine !== machineId)
      return 'License is not valid for this machine';
    console.log(`[License] Valid — client: ${p.client}, expires: ${p.expires}`);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return 'License file (license.key) not found';
    return 'License validation error';
  }
}

const _licenseError = _checkLicense();
if (_licenseError) {
  console.error(`[License] INVALID: ${_licenseError}`);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());

app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.originalUrl}`);
  next();
});

// License gate — blocks everything except the expired page itself
app.use((req, res, next) => {
  if (!_licenseError) return next();
  const url = req.path;
  if (url === '/expired.html' || url.startsWith('/favicon')) return next();
  return res.redirect(`/expired.html?reason=${encodeURIComponent(_licenseError)}`);
});

app.use(express.json());

app.get('/', (req, res) => res.redirect('/final-invoice-NS.html'));

app.use('/api/stock', requireStock);

app.get('/api/stock/categories', (req, res) => {
  res.json(stockStore.listCategories());
});

app.post('/api/stock/categories', (req, res) => {
  try {
    res.status(201).json(stockStore.addCategory(req.body && req.body.name));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.get('/api/stock/items', (req, res) => {
  res.json(stockStore.listItems());
});

app.post('/api/stock/items', (req, res) => {
  try {
    res.status(201).json(stockStore.addItem(req.body || {}));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/stock-in', (req, res) => {
  try {
    res.json(stockStore.stockIn(req.params.id, req.body && req.body.kg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/adjust', (req, res) => {
  try {
    res.json(stockStore.adjust(req.params.id, req.body && req.body.newTotalKg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/deduct', (req, res) => {
  try {
    res.json(stockStore.deduct(req.params.id, req.body && req.body.kg, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.get('/api/stock/items/:id/movements', (req, res) => {
  try {
    stockStore.getItem(req.params.id);
    res.json(stockStore.listMovements(req.params.id));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.use('/api/ledger', requireLedger);

app.get('/api/ledger/customers', (req, res) => {
  res.json(ledgerStore.listCustomers());
});

app.post('/api/ledger/customers', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addCustomer(req.body || {}));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/customers/:id', (req, res) => {
  try {
    res.json(ledgerStore.getCustomer(req.params.id));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/customers/:id/entries', (req, res) => {
  try {
    res.json(ledgerStore.listEntries(req.params.id));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/customers/:id/old-balance', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addOldBalance(req.params.id, req.body && req.body.amount, req.body && req.body.note));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/customers/:id/cash-paid', (req, res) => {
  try {
    res.status(201).json(ledgerStore.addCashPaid(req.params.id, req.body && req.body.amount, req.body && req.body.note));
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/invoices', (req, res) => {
  try {
    const invoice = ledgerStore.createInvoice(req.body || {});
    const customer = ledgerStore.getCustomer(invoice.customerId);
    res.status(201).json({ ...invoice, customerName: customer.name });
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.get('/api/ledger/invoices/:id', (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    res.json({ ...invoice, customerName: customer.name });
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Narayani Steels — Billing Tool`);
    console.log(`  Open in browser: http://localhost:${PORT}`);
  });
}

module.exports = app;
