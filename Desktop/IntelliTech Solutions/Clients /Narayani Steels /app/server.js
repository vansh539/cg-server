'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { execSync, execFileSync } = require('child_process');
const os = require('os');
const { createStore } = require('./stockStore');
const { createStore: createLedgerStore } = require('./ledgerStore');
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

// Guards every /api/balance-sheet/* route — same reasoning as requireStock
// and requireLedger: a corrupted balance-sheet.json must not take down
// billing, Stock, or Ledger.
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

function formatBalanceLine(balance) {
  if (balance > 0) return `Balance Due: ₹${pdfFmt(balance)}`;
  if (balance < 0) return `Credit Balance: ₹${pdfFmt(Math.abs(balance))}`;
  return `Balance: Settled (₹0)`;
}

// Best-effort — a WhatsApp send failure must never fail the ledger update
// that triggered it. Callers get back {notified, notifyError?} to surface
// in their own response rather than this function throwing.
async function notifyBalanceUpdate(customer, message) {
  try {
    const botPort = process.env.WHATSAPP_BOT_PORT || 5010;
    const botRes = await fetch(`http://127.0.0.1:${botPort}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ phone: customer.phone, message }),
    });
    const botBody = await botRes.json();
    if (!botRes.ok) return { notified: false, notifyError: botBody.error || 'WhatsApp bot rejected the message' };
    return { notified: true };
  } catch (err) {
    const isTimeoutOrUnreachable =
      err.name === 'TimeoutError' || err.code === 'ECONNREFUSED' || (err.cause && err.cause.code === 'ECONNREFUSED');
    return { notified: false, notifyError: isTimeoutOrUnreachable ? 'WhatsApp bot is not reachable' : err.message };
  }
}

app.post('/api/ledger/customers/:id/old-balance', async (req, res) => {
  try {
    const entry = ledgerStore.addOldBalance(req.params.id, req.body && req.body.amount, req.body && req.body.note);
    const customer = ledgerStore.getCustomer(req.params.id);
    const notifyResult = await notifyBalanceUpdate(
      customer,
      `Narayani Steels — Old balance of ₹${pdfFmt(entry.amount)} added. ${formatBalanceLine(customer.balance)}`
    );
    res.status(201).json({ ...entry, ...notifyResult });
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/customers/:id/cash-paid', async (req, res) => {
  try {
    const entry = ledgerStore.addCashPaid(req.params.id, req.body && req.body.amount, req.body && req.body.note);
    const customer = ledgerStore.getCustomer(req.params.id);
    const notifyResult = await notifyBalanceUpdate(
      customer,
      `Narayani Steels — Payment of ₹${pdfFmt(entry.amount)} received. ${formatBalanceLine(customer.balance)}`
    );
    res.status(201).json({ ...entry, ...notifyResult });
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

// ─── Invoice PDF rendering (single A6 copy, mirrors the real Chitti slip) ─────
//
// This intentionally re-implements the same table/slip-building functions
// that live client-side in final-invoice-NS.html's inline script
// (colgroup/thead/tableRows/emptyRows/totalsBlock/buildFirstSlip/
// buildContSlip) — reusing that code directly isn't practical since it's
// written for the DOM inside a page-scoped <script>, not as a standalone
// module. If the client-side slip layout changes, this needs a matching
// manual update. Differences from the physical print: single copy (not the
// A5 dual-copy side-by-side sheet meant for a physical printer — a WhatsApp
// PDF only needs one copy) and A6 page size (matching the original
// single-slip size before the A5 dual-copy feature was added). The known
// pre-existing bug where the header always reads "QUOTATION" regardless of
// document type is deliberately left as-is here too, so the PDF matches
// exactly what the shop already prints — not something this task was asked
// to fix.
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function pdfFmt(v) {
  return `${Math.round(v).toLocaleString('en-IN')}`;
}
function pdfColgroup() {
  return `<colgroup><col style="width:17%"><col style="width:36%"><col style="width:11%"><col style="width:17%"><col style="width:19%"></colgroup>`;
}
function pdfThead() {
  return `<thead><tr><th>Qty.</th><th>Particulars</th><th>Pcs.</th><th>Rate</th><th>Amount</th></tr></thead>`;
}
function pdfTableRows(items) {
  return items
    .map((r) => {
      const q = parseFloat(r.q) || 0, rt = parseFloat(r.r) || 0, a = q * rt;
      return `<tr><td class="c">${r.q || ''}</td><td class="lbl">${r.name || ''}</td><td class="c">${r.p || ''}</td><td class="r">${rt ? '' + rt : ''}</td><td class="r">${a > 0 ? pdfFmt(a) : ''}</td></tr>`;
    })
    .join('');
}
function pdfEmptyRows(n) {
  let r = '';
  for (let i = 0; i < n; i++) r += `<tr class="empty"><td></td><td></td><td></td><td></td><td></td></tr>`;
  return r;
}
function pdfTotalsBlock(sub, tq, lab, weigh, freight, unload, gst, others, oldbal, advance, tot) {
  const qs = tq % 1 === 0 ? tq : tq.toFixed(2);
  let r = `<tr class="sep"><td class="c">${qs}</td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2" style="font-weight:bold">Subtotal</td><td class="r">${pdfFmt(sub)}</td></tr>`;
  [
    ['Loading Charges', lab], ['Kanta Charges', weigh], ['Freight', freight],
    ['Unloading', unload], ['GST @18%', gst], ['Others', others], ['Old Balance', oldbal],
  ].forEach(([l, v]) => {
    if (v > 0) r += `<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">${l}</td><td class="r">${pdfFmt(v)}</td></tr>`;
  });
  if (advance > 0) r += `<tr class="charge"><td></td><td style="border-right:0.75px solid #000"></td><td class="lbl" colspan="2">Advance</td><td class="r">-${pdfFmt(advance)}</td></tr>`;
  r += `<tr class="grand"><td colspan="4" style="text-align:right;padding-right:2mm">TOTAL</td><td class="r">${pdfFmt(tot)}</td></tr>`;
  return r;
}
const PDF_SLIP_TOTAL = 19;
function pdfBuildFirstSlip(ic, isLast, sub, tq, lab, weigh, freight, unload, gst, others, oldbal, advance, tot, meta) {
  const { name, date, mobile, lorry } = meta;
  let tbody = pdfTableRows(ic);
  const tc = isLast ? 2 + [lab, weigh, freight, unload, gst, others, oldbal, advance].filter((v) => v > 0).length : 0;
  tbody += pdfEmptyRows(Math.max(0, PDF_SLIP_TOTAL - ic.length - tc));
  if (isLast) tbody += pdfTotalsBlock(sub, tq, lab, weigh, freight, unload, gst, others, oldbal, advance, tot);
  return `<div class="doc"><div class="d-hdr"><div class="d-shri">||श्री||</div><div class="d-title">QUOTATION</div><div class="d-valid">Valid for 2 Hours</div></div><div class="d-meta"><span>M/s.&nbsp;<b style="font-size:11pt">${name}</b></span><span>Dt.&nbsp;<b style="font-size:11pt">${date}</b></span></div><div class="d-meta"><span>Mobile No.&nbsp;<b style="font-size:11pt">${mobile}</b></span><span style="margin-right:12mm">Lorry No.&nbsp;<b style="font-size:11pt">${lorry}</b></span></div><table class="d-tbl">${pdfColgroup()}${pdfThead()}<tbody>${tbody}</tbody></table></div>`;
}
function pdfBuildContSlip(ic, isLast, sub, tq, lab, weigh, freight, unload, gst, others, oldbal, advance, tot) {
  let tbody = pdfTableRows(ic);
  const tc = isLast ? 2 + [lab, weigh, freight, unload, gst, others, oldbal, advance].filter((v) => v > 0).length : 0;
  tbody += pdfEmptyRows(Math.max(0, PDF_SLIP_TOTAL - ic.length - tc));
  if (isLast) tbody += pdfTotalsBlock(sub, tq, lab, weigh, freight, unload, gst, others, oldbal, advance, tot);
  return `<div class="doc-cont"><table class="d-tbl">${pdfColgroup()}${pdfThead()}<tbody>${tbody}</tbody></table></div>`;
}

// `invoice` here must already include `customerName` (see the two call
// sites below, both of which merge it the same way the GET
// /api/ledger/invoices/:id route does) — this function does not fetch the
// customer itself, to keep it a pure rendering function.
function renderInvoicePdf(invoice) {
  const tq = invoice.items.reduce((s, r) => s + (parseFloat(r.q) || 0), 0);
  const meta = { name: invoice.customerName, date: invoice.date || '', mobile: invoice.mobile || '', lorry: invoice.lorry || '' };
  const cc = [invoice.lab, invoice.weigh, invoice.freight, invoice.unload, invoice.gst, invoice.others, invoice.oldbal, invoice.advance].filter((v) => v > 0).length;
  const tr2 = 2 + cc;
  const mp1 = PDF_SLIP_TOTAL - tr2;
  const chunks = invoice.items.length <= mp1
    ? [{ items: invoice.items, cont: false }]
    : [{ items: invoice.items.slice(0, mp1), cont: false }, { items: invoice.items.slice(mp1), cont: true }];

  let body = '';
  chunks.forEach((c, idx) => {
    const isLast = idx === chunks.length - 1;
    body += c.cont
      ? pdfBuildContSlip(c.items, isLast, invoice.sub, tq, invoice.lab, invoice.weigh, invoice.freight, invoice.unload, invoice.gst, invoice.others, invoice.oldbal, invoice.advance, invoice.total)
      : pdfBuildFirstSlip(c.items, isLast, invoice.sub, tq, invoice.lab, invoice.weigh, invoice.freight, invoice.unload, invoice.gst, invoice.others, invoice.oldbal, invoice.advance, invoice.total, meta);
    if (!isLast) body += `<div style="page-break-after:always"></div>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:105mm 148.5mm;margin:0}
    body{background:#fff}
    .doc,.doc-cont{background:#fff;color:#000;width:105mm;height:148.5mm;overflow:hidden;font-family:'Times New Roman',serif;border:1.5px solid #000;padding:2.5mm 3.5mm 2mm 3.5mm;display:block}
    .d-hdr{text-align:center;margin-bottom:1.2mm;line-height:1.15}
    .d-shri{font-size:10.5pt;font-weight:bold}
    .d-title{font-size:13pt;font-weight:bold;text-decoration:underline}
    .d-valid{font-size:8.5pt;color:#444;line-height:1;margin-bottom:0.8mm}
    .d-meta{display:flex;justify-content:space-between;align-items:baseline;font-size:10pt;border-bottom:0.5px solid #000;padding-bottom:0.5mm;margin-bottom:0.8mm;line-height:1.4}
    .d-tbl tr.empty td{height:5mm;padding:0 1mm;border:0.75px solid #000;background:#fff}
    .d-tbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt;line-height:1.3}
    .d-tbl thead th{border:0.75px solid #000;padding:0 1mm;height:5mm;text-align:center;font-weight:bold;font-size:8.5pt;background:#e8e8e8;white-space:nowrap;vertical-align:middle}
    .d-tbl tbody td{border:0.75px solid #000;padding:0 1mm;height:5mm;font-size:8.5pt;line-height:1.3;vertical-align:middle;overflow:hidden;white-space:nowrap}
    .d-tbl td.c{text-align:center;font-weight:bold}
    .d-tbl td.r{text-align:right;font-weight:bold}
    .d-tbl td.lbl{text-align:left;font-weight:bold;overflow:hidden;text-overflow:ellipsis}
    .d-tbl tr.sep td{border-top:2px solid #000;font-weight:normal;background:#efefef;height:5mm;padding:0 1mm}
    .d-tbl tr.charge td{background:#fafafa;height:5mm;padding:0 1mm;font-size:8.5pt}
    .d-tbl tr.grand td{border-top:1.5px solid #000;font-weight:bold;font-size:9.5pt;background:#e8e8e8;height:5mm;padding:0 1mm}
  </style></head><body>${body}</body></html>`;

  const tmpHtml = path.join(os.tmpdir(), `ns-invoice-${invoice.id}.html`);
  const tmpPdf = path.join(os.tmpdir(), `ns-invoice-${invoice.id}.pdf`);
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

app.get('/api/ledger/invoices/:id/pdf', (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    const pdfBuffer = renderInvoicePdf({ ...invoice, customerName: customer.name });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    sendLedgerError(res, err);
  }
});

app.post('/api/ledger/invoices/:id/send-whatsapp', async (req, res) => {
  try {
    const invoice = ledgerStore.getInvoice(req.params.id);
    const customer = ledgerStore.getCustomer(invoice.customerId);
    const pdfBuffer = renderInvoicePdf({ ...invoice, customerName: customer.name });
    const botPort = process.env.WHATSAPP_BOT_PORT || 5010;
    const botRes = await fetch(`http://127.0.0.1:${botPort}/send-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        phone: customer.phone,
        pdfBase64: pdfBuffer.toString('base64'),
        filename: `Invoice-${invoice.invoiceNo}.pdf`,
        message: `Invoice #${invoice.invoiceNo} from Narayani Steels — Total ₹${pdfFmt(invoice.total)}. ${formatBalanceLine(customer.balance)}`,
      }),
    });
    const botBody = await botRes.json();
    if (!botRes.ok) throw new Error(botBody.error || 'WhatsApp bot rejected the send');
    res.json({ sent: true });
  } catch (err) {
    // Node's fetch wraps connection failures in a TypeError whose real code
    // lives on `.cause`, not on the error itself — checking `err.code` alone
    // would never match and this branch would silently never fire.
    const isTimeoutOrUnreachable =
      err.name === 'TimeoutError' || err.code === 'ECONNREFUSED' || (err.cause && err.cause.code === 'ECONNREFUSED');
    res.status(isTimeoutOrUnreachable ? 503 : 400).json({
      error: isTimeoutOrUnreachable ? 'WhatsApp bot is not reachable — is it running?' : err.message,
    });
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
