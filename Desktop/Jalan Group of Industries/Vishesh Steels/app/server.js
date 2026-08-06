'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { execFileSync } = require('child_process');
const { createStore } = require('./stockStore');
const { createStore: createBalanceSheetStore } = require('./balanceSheetStore');

const app  = express();
const PORT = process.env.PORT || 3500;

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

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());

app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json());

app.get('/', (req, res) => res.redirect('/final-invoice-VS.html'));

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

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
      ];
  return candidates.find(p => p && fs.existsSync(p)) || candidates[0];
}

const CHROME_PATH = resolveChromePath();

function pdfFmt(v) {
  return `${Math.round(v).toLocaleString('en-IN')}`;
}

// ─── Balance Sheet PDF rendering ──────────────────────────────────────────────
//
// Rendered via headless Chrome (--no-pdf-header-footer) rather than the
// browser's own print dialog from balance-sheet.html directly — Chrome's
// native print dialog injects its own header/footer (page title, date, URL)
// around whatever a page prints, which page-level CSS can't suppress.
// Generating an actual PDF server-side sidesteps that entirely.
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
    <div class="titlerow"><div class="hindi">Vishesh Steels</div><div>${dateStr}</div></div>
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

  const tmpHtml = path.join(os.tmpdir(), `vs-balance-sheet-${day.date}.html`);
  const tmpPdf = path.join(os.tmpdir(), `vs-balance-sheet-${day.date}.pdf`);
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
    console.log(`Vishesh Steels — Billing Tool`);
    console.log(`  Open in browser: http://localhost:${PORT}`);
  });
}

module.exports = app;
