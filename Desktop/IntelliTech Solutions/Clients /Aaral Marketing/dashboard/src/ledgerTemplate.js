// The customer's statement of account, as sent on WhatsApp.
//
// Built on the same rules as the chitti (src/chittiStyles.js, `.slip`) so the
// two documents a customer receives look like they came from one business.
// Before this, the statement was a navy/cyan rounded card that shared nothing
// with the slip -- the same drift v1.5.0 removed between the printed chitti
// and the PDF, just one document further along.
//
// Only the columns differ, and those live in chittiStyles.js under `.ledger`.

const { escapeHtml, formatIndian, formatDate } = require('./chittiTemplate');
const { SLIP_CSS } = require('./chittiStyles');

// Blank rows so a two-entry statement still reads as a ruled ledger page
// rather than a stub floating at the top of the paper.
const MIN_BODY_ROWS = 6;

const TYPE_LABELS = { invoice: 'Invoice', payment: 'Payment', opening: 'Opening' };
const METHOD_LABELS = {
  cash: 'Cash',
  gpay: 'GPay',
  bank_transfer: 'Bank Transfer',
  screenshot: 'Screenshot',
  utr_text: 'UTR',
};

// An invoice raises what the customer owes, a payment reduces it. The sign is
// carried in the Amount column so Balance never has to be read twice.
function signedAmount(entry) {
  const amount = formatIndian(Math.abs(Number(entry.amount) || 0));
  return entry.type === 'payment' ? `-${amount}` : `+${amount}`;
}

// One line per item bought on that invoice -- particulars, quantity and
// rate, alongside the invoice number, so the customer's own copy shows what
// was actually bought without having to ask the office to look it up.
// Pre-escaped HTML: every dynamic value is escaped individually here since
// detailFor's result is inserted into the row without a further escapeHtml
// pass (that pass would otherwise escape the <span> markup itself).
// Non-breaking spaces around "×" keep "100 × ₹100" together as one unit --
// without them, the browser was free to wrap the line right after "×",
// leaving it dangling on its own line with "₹100" stranded on the next.
function itemLine(item) {
  return `<span class="item-line">${escapeHtml(item.particulars)} — `
    + `${escapeHtml(formatIndian(item.qty))} × ₹${escapeHtml(formatIndian(item.rate))}</span>`;
}

function detailFor(entry) {
  if (entry.type === 'payment') return escapeHtml(METHOD_LABELS[entry.label] || entry.label || '');
  const label = String(entry.label ?? '');
  const heading = escapeHtml(label.replace(/\b\w/g, (c) => c.toUpperCase()));
  const items = Array.isArray(entry.items) ? entry.items : [];
  if (!items.length) return heading;
  return `${heading}${items.map(itemLine).join('')}`;
}

function buildRows(entries) {
  const rows = entries.map((entry) => {
    const voided = entry.voided ? ' <span class="void">(voided)</span>' : '';
    return `    <tr>
      <td class="l-nowrap">${escapeHtml(formatDate(entry.occurred_at))}</td>
      <td class="l-nowrap">${escapeHtml(TYPE_LABELS[entry.type] || entry.type || '')}</td>
      <td>${detailFor(entry)}${voided}</td>
      <td class="n">${escapeHtml(signedAmount(entry))}</td>
      <td class="n amt">${escapeHtml(formatIndian(entry.runningBalance))}</td>
    </tr>`;
  });

  for (let i = entries.length; i < MIN_BODY_ROWS; i += 1) {
    rows.push('    <tr><td class="l-nowrap">&nbsp;</td><td></td><td></td><td class="n"></td><td class="n amt"></td></tr>');
  }
  return rows.join('\n');
}

// The closing balance, worded the way the shop would say it out loud rather
// than as a signed number the customer has to interpret.
function balanceLabel(balance) {
  const n = Number(balance) || 0;
  if (n > 0) return 'Balance Due';
  if (n < 0) return 'In Credit';
  return 'Balance';
}

function buildLedgerTable({ customer = {}, entries = [], asOf } = {}) {
  const balance = Number(customer.balance) || 0;
  return `<table class="slip ledger">
  <colgroup>
    <col class="l-date"><col class="l-type"><col class="l-detail">
    <col class="l-amt"><col class="l-bal">
  </colgroup>
  <thead>
    <tr><th class="slip-banner" colspan="5">${escapeHtml(customer.name) || 'Customer'}</th></tr>
    <tr>
      <th class="slip-meta" colspan="3">Statement <span class="v">${escapeHtml(formatDate(asOf))}</span></th>
      <th class="slip-meta" colspan="2">${escapeHtml(balanceLabel(balance))} <span class="v">${escapeHtml(formatIndian(Math.abs(balance)))}</span></th>
    </tr>
    <tr>
      <th class="col">Date</th>
      <th class="col">Type</th>
      <th class="col">Detail</th>
      <th class="col n">Amount</th>
      <th class="col n amt">Balance</th>
    </tr>
  </thead>
  <tbody>
${buildRows(entries)}
  </tbody>
  <tfoot>
    <tr>
      <td class="total-label" colspan="4">${escapeHtml(balanceLabel(balance))}</td>
      <td class="n amt">${escapeHtml(formatIndian(Math.abs(balance)))}</td>
    </tr>
  </tfoot>
</table>`;
}

function buildLedgerHtml(data) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: #fff; }
${SLIP_CSS}
.slip .void { font-weight: 700; text-transform: uppercase; font-size: 2vw; }
</style></head><body>${buildLedgerTable(data)}</body></html>`;
}

module.exports = { buildLedgerHtml, buildLedgerTable, balanceLabel, MIN_BODY_ROWS };
