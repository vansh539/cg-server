const { CHITTI_CSS } = require('./chittiStyles');

// Server-side chitti markup. Kept in one place so the PDF, the JPEG and the
// WhatsApp attachment are literally the same document, and so the browser
// views can be styled from the same CSS.

const MIN_BODY_ROWS = 5;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Indian digit grouping: 1,17,500 rather than 117,500. What the shop writes by
// hand and what every other document they handle uses.
function formatIndian(value) {
  const num = Number(value) || 0;
  const negative = num < 0;
  const abs = Math.abs(num);
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const [whole, decimals] = fixed.split('.');
  let grouped;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  return `${negative ? '-' : ''}${grouped}${decimals ? `.${decimals}` : ''}`;
}

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function buildRows(items) {
  const filled = items.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.s_no ?? index + 1)}</td>
      <td>${escapeHtml(item.particulars)}</td>
      <td>${escapeHtml(item.grade)}</td>
      <td>${escapeHtml(item.vch)}</td>
      <td class="n">${formatIndian(item.qty)}</td>
      <td class="n">${formatIndian(item.rate)}</td>
      <td class="n amt">${formatIndian(item.amount)}</td>
    </tr>`);

  // Blank rows so a short slip still reads like a page torn off a printed pad,
  // which is what the client's reference shows.
  const blanks = [];
  for (let i = filled.length; i < MIN_BODY_ROWS; i += 1) {
    blanks.push(`
    <tr>
      <td>${i + 1}</td><td></td><td></td><td></td>
      <td class="n"></td><td class="n"></td><td class="n amt"></td>
    </tr>`);
  }
  return filled.concat(blanks).join('');
}

// The table on its own, for embedding in a page that already has the CSS.
function buildChittiTable({ invoice = {}, items = [], customerName }) {
  return `<table class="slip chitti">
  <colgroup>
    <col class="c-sl"><col class="c-part"><col class="c-grade"><col class="c-vch">
    <col class="c-qty"><col class="c-rate"><col class="c-amt">
  </colgroup>
  <thead>
    <tr><th class="slip-banner" colspan="7">${escapeHtml(customerName) || 'Walk-in / Cash Sale'}</th></tr>
    <tr>
      <th class="slip-meta" colspan="4">To <span class="v">${escapeHtml(invoice.destination || '')}</span></th>
      <th class="slip-meta" colspan="3">Date <span class="v">${formatDate(invoice.created_at)}</span></th>
    </tr>
    <tr>
      <th class="col">Sl</th><th class="col">Particulars</th><th class="col">Grade</th><th class="col">Vch</th>
      <th class="col n">Qty</th><th class="col n">Rate</th><th class="col n amt">Amount</th>
    </tr>
  </thead>
  <tbody>${buildRows(items)}</tbody>
  <tfoot>
    ${invoice.note ? `<tr><td class="total-label" colspan="7" style="text-align:left">Note: ${escapeHtml(invoice.note)}</td></tr>` : ''}
    <tr><td class="total-label" colspan="6">Total</td><td class="n amt">${formatIndian(invoice.total)}</td></tr>
  </tfoot>
</table>`;
}

// A complete standalone document, for Puppeteer. No margin/padding on body:
// the paper size IS the slip size, so the grid runs edge to edge the way a
// pre-printed pad does.
function buildChittiHtml(data) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
${CHITTI_CSS}
</style></head><body>${buildChittiTable(data)}</body></html>`;
}

module.exports = { buildChittiHtml, buildChittiTable, formatIndian, formatDate, escapeHtml, MIN_BODY_ROWS };
