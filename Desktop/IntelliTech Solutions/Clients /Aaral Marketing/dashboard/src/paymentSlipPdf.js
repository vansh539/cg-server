const puppeteer = require('puppeteer-core');
const { CHROME_EXECUTABLE } = require('./chromeExecutable');

const DEFAULT_PAPER_MM = { w: 105, h: 148 }; // A6 — receipt-sized by default

const METHOD_LABELS = { cash: 'Cash', gpay: 'GPay', bank_transfer: 'Bank Transfer' };

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

function buildPaymentSlipHtml({ payment, customerName, balanceAfter }) {
  const balanceRow = balanceAfter !== null && balanceAfter !== undefined ? `
      <div class="meta-row">
        <span class="meta-label">Balance after</span>
        <span class="meta-value">₹${formatMoney(balanceAfter)}</span>
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
  .doc-label {
    font-size: 2.6vw;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cyan);
    margin-bottom: 1.5vw;
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

  .amount-block {
    padding: 6vw 5.5vw;
    text-align: center;
  }
  .amount-label {
    font-size: 2.8vw;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin-bottom: 2vw;
  }
  .amount-value {
    font-size: 11vw;
    font-weight: 800;
    color: var(--navy);
  }

  .total-row {
    display: flex;
    justify-content: center;
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
  .total-value { font-size: 5vw; font-weight: 800; color: var(--navy); }
</style></head><body>
  <div class="sheet">
    <div class="head">
      <div class="doc-label">Payment Received</div>
      <div class="customer-name">${escapeHtml(customerName)}</div>
      <div class="meta-strip">
        <div class="meta-row">
          <span class="meta-label">Date</span>
          <span class="meta-value">${formatDate(payment.reported_at)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Mode</span>
          <span class="meta-value">${METHOD_LABELS[payment.proof_type] || payment.proof_type}</span>
        </div>
      </div>
    </div>
    <div class="amount-block">
      <div class="amount-label">Amount received</div>
      <div class="amount-value">₹${formatMoney(payment.amount_claimed)}</div>
    </div>
    ${balanceRow ? `<div class="total-row"><span class="total-label">Balance after</span><span class="total-value">₹${formatMoney(balanceAfter)}</span></div>` : ''}
  </div>
</body></html>`;
}

async function renderPaymentSlipPdf({ payment, customerName, balanceAfter, paperWidthMm, paperHeightMm }) {
  const w = Number(paperWidthMm) || DEFAULT_PAPER_MM.w;
  const h = Number(paperHeightMm) || DEFAULT_PAPER_MM.h;
  const browser = await puppeteer.launch({ executablePath: CHROME_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildPaymentSlipHtml({ payment, customerName, balanceAfter }), { waitUntil: 'load' });
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

module.exports = { renderPaymentSlipPdf };
