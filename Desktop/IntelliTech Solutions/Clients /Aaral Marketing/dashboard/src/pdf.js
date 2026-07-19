const puppeteer = require('puppeteer-core');

const CHROME_EXECUTABLE = process.env.CHROME_PATH || (
  process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
);

const DEFAULT_PAPER_MM = { w: 210, h: 297 };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function buildInvoiceHtml({ invoice, items, customerName }) {
  const rows = items.map((item) => `
    <tr>
      <td class="c-sno">${item.s_no}</td>
      <td>${escapeHtml(item.particulars)}</td>
      <td class="c-muted">${escapeHtml(item.grade)}</td>
      <td class="c-muted">${escapeHtml(item.vch)}</td>
      <td class="num">${formatMoney(item.qty)}</td>
      <td class="num">${formatMoney(item.rate)}</td>
      <td class="num c-amount">${formatMoney(item.amount)}</td>
    </tr>`).join('');

  const destinationRow = invoice.destination ? `
      <div class="meta-row">
        <span class="meta-label">Destination</span>
        <span class="meta-value">${escapeHtml(invoice.destination)}</span>
      </div>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root {
    --navy: #191048;
    --cyan: #0093d9;
    --ink: #1d1a2b;
    --ink-muted: #6f6a5c;
    --line: #d9d4c8;
    --wash: #f7f5ef;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: var(--ink);
    margin: 0;
    padding: 6.5vw 6vw;
  }
  .sheet { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }

  .head {
    padding: 5vw 5.5vw 4vw;
    border-bottom: 3px solid var(--navy);
  }
  .customer-name {
    font-size: 6.4vw;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--navy);
    line-height: 1.15;
    word-break: break-word;
  }
  .meta-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2vw 6vw;
    margin-top: 3vw;
  }
  .meta-row { display: flex; flex-direction: column; gap: 0.4vw; }
  .meta-label {
    font-size: 2.5vw;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .meta-value { font-size: 3.6vw; font-weight: 700; color: var(--ink); }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.c-sl { width: 5%; }
  col.c-particulars { width: 22%; }
  col.c-grade { width: 13%; }
  col.c-vchcol { width: 11%; }
  col.c-qty { width: 12%; }
  col.c-rate { width: 14%; }
  col.c-amt { width: 23%; }

  thead th {
    text-align: left;
    font-size: 1.75vw;
    font-weight: 700;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--ink-muted);
    background: var(--wash);
    padding: 2vw 1.6vw;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  thead th.num { text-align: right; }
  tbody td {
    padding: 2.2vw 1.6vw;
    font-size: 3vw;
    font-weight: 600;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    overflow-wrap: break-word;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .c-sno { color: var(--ink-muted); font-weight: 500; }
  .c-muted { color: var(--ink-muted); font-weight: 500; }
  .c-amount { font-weight: 700; color: var(--navy); }

  .total-row {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 3vw;
    padding: 4vw 5.5vw;
    background: var(--wash);
    border-top: 3px solid var(--navy);
  }
  .total-label {
    font-size: 3vw;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .total-value { font-size: 6vw; font-weight: 800; color: var(--navy); }
</style></head><body>
  <div class="sheet">
    <div class="head">
      <div class="customer-name">${escapeHtml(customerName) || 'Walk-in / Cash Sale'}</div>
      <div class="meta-strip">
        <div class="meta-row">
          <span class="meta-label">Date</span>
          <span class="meta-value">${formatDate(invoice.created_at)}</span>
        </div>
        ${destinationRow}
      </div>
    </div>
    <table>
      <colgroup>
        <col class="c-sl"><col class="c-particulars"><col class="c-grade"><col class="c-vchcol">
        <col class="c-qty"><col class="c-rate"><col class="c-amt">
      </colgroup>
      <thead>
        <tr>
          <th>Sl</th>
          <th>Particulars</th>
          <th>Grade</th>
          <th>Vch</th>
          <th class="num">Qty</th>
          <th class="num">Rate</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total-row">
      <span class="total-label">Total</span>
      <span class="total-value">₹${formatMoney(invoice.total)}</span>
    </div>
  </div>
</body></html>`;
}

async function renderInvoicePdf({ invoice, items, customerName, paperWidthMm, paperHeightMm }) {
  const w = Number(paperWidthMm) || DEFAULT_PAPER_MM.w;
  const h = Number(paperHeightMm) || DEFAULT_PAPER_MM.h;
  const browser = await puppeteer.launch({ executablePath: CHROME_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildInvoiceHtml({ invoice, items, customerName }), { waitUntil: 'load' });
    return Buffer.from(await page.pdf({
      width: `${w}mm`,
      height: `${h}mm`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    }));
  } finally {
    await browser.close();
  }
}

module.exports = { renderInvoicePdf };
