'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync, execFileSync } = require('child_process');
const os = require('os');
const { createStore } = require('./stockStore');
const { createStore: createBalanceSheetStore } = require('./balanceSheetStore');

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

const BALANCE_SHEET_DATA_PATH = process.env.BALANCE_SHEET_DATA_PATH || path.join(__dirname, 'data', 'balance-sheet.json');
const balanceSheetStore = createBalanceSheetStore(BALANCE_SHEET_DATA_PATH);
let _balanceSheetInitError = null;
try {
  balanceSheetStore.init();
} catch (err) {
  _balanceSheetInitError = err;
  console.error(`[BalanceSheet] Failed to load balance sheet data: ${err.message}`);
}

function sendBalanceSheetError(res, err) {
  res.status(400).json({ error: err.message });
}

// Guards every /api/balance-sheet/* route — same reasoning as requireStock:
// a corrupted balance-sheet.json must not take down billing or Stock.
function requireBalanceSheet(req, res, next) {
  if (_balanceSheetInitError) return res.status(500).json({ error: 'Balance sheet data is unavailable — see server logs.' });
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

app.patch('/api/stock/items/:id', (req, res) => {
  try {
    res.json(stockStore.updateItem(req.params.id, req.body || {}));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.delete('/api/stock/items/:id', (req, res) => {
  try {
    stockStore.deleteItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/stock-in', (req, res) => {
  try {
    res.json(stockStore.stockIn(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/adjust', (req, res) => {
  try {
    res.json(stockStore.adjust(req.params.id, req.body && req.body.newTotalKg, req.body && req.body.newTotalPcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.post('/api/stock/items/:id/deduct', (req, res) => {
  try {
    res.json(stockStore.deduct(req.params.id, req.body && req.body.kg, req.body && req.body.pcs, req.body && req.body.note));
  } catch (err) {
    sendStockError(res, err);
  }
});

app.get('/api/stock/report', (req, res) => {
  try {
    res.json(stockStore.getReport({ type: req.query.type, date: req.query.date }));
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

app.use('/api/balance-sheet', requireBalanceSheet);

app.get('/api/balance-sheet/:date', (req, res) => {
  try {
    res.json(balanceSheetStore.getDay(req.params.date));
  } catch (err) {
    sendBalanceSheetError(res, err);
  }
});

app.put('/api/balance-sheet/:date', (req, res) => {
  try {
    res.json(balanceSheetStore.saveDay(req.params.date, req.body || {}));
  } catch (err) {
    sendBalanceSheetError(res, err);
  }
});

const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Shared with Balance Sheet PDF rendering below — the invoice-PDF renderer
// that used to also depend on this (and on CHROME_PATH above) was removed
// along with Ledger.
function pdfFmt(v) {
  return `${Math.round(v).toLocaleString('en-IN')}`;
}

// ─── Balance Sheet PDF rendering ──────────────────────────────────────────────
//
// Rendered the same way as the invoice PDF above (headless Chrome,
// --no-pdf-header-footer) rather than relying on the browser's own print
// dialog from balance-sheet.html directly — Chrome's native print dialog
// injects its own header (page title) and footer (date/URL) around
// whatever a page prints, which isn't something page-level CSS can
// suppress. Vansh saw exactly that (a date top-right, the page title
// centered) on a real test print and asked for it gone; generating an
// actual PDF server-side sidesteps the browser chrome entirely, matching
// how the Invoice/Quotation flow already avoids the same problem.
function bsRowsHtml(rows) {
  return rows.map((r) => `<div class="row"><span>${r.label}</span><span class="amt">${pdfFmt(r.amount)}</span></div>`).join('');
}
function bsSection(title, rows, totalLabel, total) {
  return `<div class="section"><h4>${title}</h4>${bsRowsHtml(rows)}<div class="total-row"><span>${totalLabel}</span><span>${pdfFmt(total)}</span></div></div>`;
}
function renderBalanceSheetPdf(day) {
  const dateStr = new Date(`${day.date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 portrait;margin:14mm}
    body{font-family:'Times New Roman',serif;color:#000}
    .shri{text-align:center;font-size:20pt;font-weight:700;font-family:'Noto Sans Devanagari','Nirmala UI',sans-serif;margin-bottom:6mm}
    .rule{border:none;border-top:1.5px solid #000;margin:0 0 4mm 0}
    .titlerow{display:flex;justify-content:space-between;align-items:baseline;font-size:12pt;margin-bottom:4mm}
    .hindi{font-weight:700;font-family:'Noto Sans Devanagari','Nirmala UI',sans-serif;font-size:13pt}
    .cols{display:flex}
    .col{flex:1}
    .col.left{padding-right:6mm;border-right:1px solid #000}
    .col.right{padding-left:6mm}
    .section{margin-bottom:8mm}
    .section h4{font-size:10.5pt;letter-spacing:0.04em;margin-bottom:2mm;font-family:Arial,sans-serif}
    .row{display:flex;justify-content:space-between;font-size:10.5pt;padding:1mm 0;border-bottom:1px dotted #ccc}
    .total-row{display:flex;justify-content:space-between;font-weight:700;font-size:10.5pt;border-top:1px solid #000;padding-top:1.5mm;margin-top:1mm}
    .totals{display:flex;justify-content:flex-end;gap:14mm;margin-top:6mm;padding-top:4mm;border-top:1.5px solid #000;font-size:10.5pt}
    .totals .lbl{font-size:8.5pt;color:#444;text-transform:uppercase}
    .totals .val{font-weight:700;font-size:12pt}
    .totals .closing .val{font-size:14pt}
  </style></head><body>
    <div class="shri">श्री</div>
    <hr class="rule">
    <div class="titlerow"><div class="hindi">श्री रानी सती दादी</div><div>${dateStr}</div></div>
    <hr class="rule">
    <div class="cols">
      <div class="col left">
        ${bsSection('CASH IN', day.cashIn, 'Cash Total', day.cashTotal)}
        ${bsSection('BANK IN', day.bankIn, 'Bank In Total', day.bankInTotal)}
      </div>
      <div class="col right">
        ${bsSection('EXPENSES', day.expenses, 'Expenses Total', day.expensesTotal)}
        ${bsSection('BANK OUT', day.bankOut, 'Bank Out Total', day.bankOutTotal)}
      </div>
    </div>
    <div class="totals">
      <div><div class="lbl">Cash Subtotal</div><div class="val">${pdfFmt(day.cashSubtotal)}</div></div>
      <div><div class="lbl">Bank Subtotal</div><div class="val">${pdfFmt(day.bankSubtotal)}</div></div>
      <div class="closing"><div class="lbl">Closing Balance</div><div class="val">${pdfFmt(day.closingBalance)}</div></div>
    </div>
  </body></html>`;

  const tmpHtml = path.join(os.tmpdir(), `ns-balance-sheet-${day.date}.html`);
  const tmpPdf = path.join(os.tmpdir(), `ns-balance-sheet-${day.date}.pdf`);
  fs.writeFileSync(tmpHtml, html);
  execFileSync(
    CHROME_PATH,
    ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${tmpPdf}`, `file://${tmpHtml}`],
    { timeout: 15000 }
  );
  const pdfBuffer = fs.readFileSync(tmpPdf);
  fs.unlinkSync(tmpHtml);
  fs.unlinkSync(tmpPdf);
  return pdfBuffer;
}

app.get('/api/balance-sheet/:date/pdf', (req, res) => {
  try {
    const day = balanceSheetStore.getDay(req.params.date);
    const pdfBuffer = renderBalanceSheetPdf(day);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    sendBalanceSheetError(res, err);
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
