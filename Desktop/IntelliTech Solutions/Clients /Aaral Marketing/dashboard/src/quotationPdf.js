const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_EXECUTABLE = process.env.CHROME_PATH || (
  process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
);

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'aaral-logo-pdf.jpg');
const LOGO_DATA_URI = `data:image/jpeg;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function buildQuotationHtml({ recipientName, recipientAddress, recipientMobile, items, unloadingCharge }) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.qty) * Number(item.rate), 0);
  const unloading = Number(unloadingCharge) || 0;
  const total = subtotal + unloading;

  const rows = items.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(item.particulars)}</td>
      <td>${escapeHtml(item.grade)}</td>
      <td>${escapeHtml(item.vch)}</td>
      <td class="num">${Number(item.qty)}</td>
      <td class="num">${Number(item.rate).toFixed(2)}</td>
      <td class="num">${(Number(item.qty) * Number(item.rate)).toFixed(2)}</td>
    </tr>`).join('');

  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 0; }
:root {
  --navy: #211155; --blue: #0093d9; --blue-light: #5fc4ef;
  --ink: #14101b; --muted: #5b6b82; --line: #dfe6f0;
}
body { width: 210mm; height: 297mm; font-family: Arial, Helvetica, sans-serif; position: relative; }
.top-bar { height: 6mm; background: linear-gradient(90deg, var(--navy) 0%, var(--blue) 55%, var(--blue-light) 100%); }
.header { padding: 6mm 14mm 4mm; display: flex; align-items: center; gap: 6mm; }
.header img { height: 22mm; width: auto; display: block; }
.header-text { flex: 1; }
.firm-name { font-family: Arial, Helvetica, sans-serif; font-size: 22pt; font-weight: 800; letter-spacing: -0.01em; color: var(--navy); line-height: 1; }
.tagline { font-size: 9pt; color: var(--muted); margin-top: 2mm; letter-spacing: 0.02em; }
.header-contact { text-align: right; font-size: 10.5pt; color: var(--ink); line-height: 1.6; white-space: pre-line; }
.header-contact .gstin { display: inline-block; margin-top: 1.5mm; font-size: 10.5pt; font-weight: 700; color: var(--navy); }
.divider { height: 2px; background: linear-gradient(90deg, var(--navy) 0%, var(--blue) 55%, var(--blue-light) 100%); margin: 0 14mm; }
.content-area { padding: 10mm 14mm; }
.doc-title { font-family: Arial, Helvetica, sans-serif; font-size: 13pt; font-weight: 700; color: var(--navy); text-align: center; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4mm; }
.meta-row { display: flex; justify-content: space-between; align-items: flex-start; font-size: 9.5pt; color: var(--muted); margin-bottom: 4mm; }
.to-block { line-height: 1.6; }
.to-block .to-name { font-weight: 700; color: var(--ink); }
.intro-line { font-size: 9.5pt; color: var(--ink); line-height: 1.6; margin-bottom: 6mm; }
table.items { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
table.items th { background: var(--navy); color: #fff; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.03em; padding: 2.6mm 2mm; text-align: left; }
table.items td { border: 1px solid var(--line); padding: 3mm 2mm; }
table.items td.num, table.items th.num { text-align: right; }
.totals-row { display: flex; justify-content: flex-end; margin-top: 4mm; font-size: 10pt; }
.totals-row .box { width: 60mm; }
.totals-row .line { display: flex; justify-content: space-between; padding: 1.5mm 0; border-bottom: 1px solid var(--line); }
.totals-row .grand { font-weight: 700; color: var(--navy); font-size: 12pt; border-bottom: none; padding-top: 2mm; }
.footer { position: absolute; bottom: 0; left: 0; right: 0; }
.footer-strip { background: var(--navy); color: #fff; padding: 5mm 14mm; display: flex; justify-content: space-between; align-items: flex-start; font-size: 8pt; line-height: 1.6; }
.footer-strip .bank-details { white-space: pre-line; }
.footer-strip .bank-label { font-weight: 700; color: var(--blue-light); text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.06em; margin-bottom: 1mm; }
.bottom-bar { height: 4mm; background: linear-gradient(90deg, var(--navy) 0%, var(--blue) 55%, var(--blue-light) 100%); }
</style></head>
<body>
  <div class="top-bar"></div>
  <div class="header">
    <img src="${LOGO_DATA_URI}" alt="Aaral Marketing">
    <div class="header-text">
      <div class="firm-name">AARAL MARKETING</div>
      <div class="tagline">Cement &amp; Building Materials Trading</div>
    </div>
    <div class="header-contact">5-4-57 to 62, 1st floor, Sri Krishna Govinda Complex
Distillery Road, Secunderabad – 500 003, Telangana
Ph: +91 80082 22501
aaralmarketing@gmail.com
<span class="gstin">GSTIN: 36ABEFA2347P1Z6</span></div>
  </div>
  <div class="divider"></div>
  <div class="content-area">
    <div class="doc-title">Quotation</div>
    <div class="meta-row">
      <div class="to-block">
        ${recipientName ? `To,<br><span class="to-name">${escapeHtml(recipientName)}</span><br>` : ''}
        ${recipientAddress ? `${escapeHtml(recipientAddress)}<br>` : ''}
        ${recipientMobile ? `Mobile: ${escapeHtml(recipientMobile)}` : ''}
      </div>
      <span>Date: ${dateStr}</span>
    </div>
    <div class="intro-line">Dear ${recipientName ? escapeHtml(recipientName) : 'Sir/Madam'},<br>
    Thank you for your inquiry. Please find below the quotation for the items requested. We look forward to your valued order.</div>
    <table class="items">
      <thead><tr>
        <th style="width:8%;">S No.</th><th>Particulars</th><th style="width:14%;">Grade</th>
        <th style="width:10%;">Vch</th><th style="width:10%;" class="num">Qty</th>
        <th style="width:14%;" class="num">Rate</th><th style="width:16%;" class="num">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals-row">
      <div class="box">
        <div class="line"><span>Subtotal</span><span>₹${subtotal.toFixed(2)}</span></div>
        ${unloading ? `<div class="line"><span>Unloading charges</span><span>₹${unloading.toFixed(2)}</span></div>` : ''}
        <div class="line grand"><span>Total</span><span>₹${total.toFixed(2)}</span></div>
      </div>
    </div>
  </div>
  <div class="footer">
    <div class="footer-strip">
      <div class="bank-details">
        <div class="bank-label">Bank Details</div>
        Aaral Marketing
        A/c No: 512020010018707
        IFSC: CIUB0000076
        City Union Bank Ltd, Ranigunj, Secunderabad – 3
      </div>
      <div class="bank-details" style="text-align:right;">
        <div class="bank-label">Registered Office</div>
        5-4-57 to 62, 1st floor
        Sri Krishna Govinda Complex, Distillery Road
        Secunderabad – 500 003, Telangana
      </div>
    </div>
    <div class="bottom-bar"></div>
  </div>
</body></html>`;
}

async function renderQuotationPdf({ recipientName, recipientAddress, recipientMobile, items, unloadingCharge }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one line item is required');
  }
  const browser = await puppeteer.launch({ executablePath: CHROME_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildQuotationHtml({ recipientName, recipientAddress, recipientMobile, items, unloadingCharge }), { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  } finally {
    await browser.close();
  }
}

module.exports = { renderQuotationPdf };
