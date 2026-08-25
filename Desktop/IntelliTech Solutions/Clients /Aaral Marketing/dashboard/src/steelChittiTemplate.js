// The Iron & Steel chitti -- built on the same `.slip` rules as the cement
// chitti (src/chittiTemplate.js) so the two businesses share one house
// style, but with steel's own fields: ported from Narayani Steels'
// final-invoice-NS.html, where a row is billed as Pcs x Rate only when no
// Qty(kg) was entered (a one-off item with no kg stock kept, e.g. a casting),
// and by Qty(kg) x Rate otherwise. Charge lines (Loading, Kanta, ...) are
// shown only when set, exactly as that tool does, since a printed 0 next to
// a charge that doesn't apply reads as a mistake on the slip.

const { escapeHtml, formatIndian, formatDate } = require('./chittiTemplate');
const { SLIP_CSS } = require('./chittiStyles');

const MIN_BODY_ROWS = 5;

const CHARGE_LABELS = [
  ['loading', 'Loading'],
  ['kanta', 'Kanta'],
  ['freight', 'Freight'],
  ['unloading', 'Unloading'],
  ['bending', 'Bending Charges'],
  ['gst', 'GST @18%'],
  ['others', 'Others'],
];

// A row with no Qty(kg) but a Pcs and Rate is a piece-priced item (no kg
// stock kept for it); everything else is priced by weight. Matches
// Narayani's rowAmount exactly -- this is a business rule, not house style,
// and changing it silently changes what a customer is charged.
function rowAmount(row) {
  const qty = Number(row.qty) || 0;
  const pcs = Number(row.pcs) || 0;
  const rate = Number(row.rate) || 0;
  if (qty <= 0 && pcs > 0 && rate > 0) return pcs * rate;
  return qty * rate;
}

function buildRows(items) {
  const rows = items.map((item, i) => {
    const amount = rowAmount(item);
    return `    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(item.particulars)}</td>
      <td class="n">${item.pcs ? escapeHtml(String(item.pcs)) : ''}</td>
      <td class="n">${item.qty ? escapeHtml(String(item.qty)) : ''}</td>
      <td class="n">${item.rate ? escapeHtml(formatIndian(item.rate)) : ''}</td>
      <td class="n amt">${amount > 0 ? escapeHtml(formatIndian(amount)) : ''}</td>
    </tr>`;
  });

  for (let i = items.length; i < MIN_BODY_ROWS; i += 1) {
    rows.push('    <tr><td>&nbsp;</td><td></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n amt"></td></tr>');
  }
  return rows.join('\n');
}

function totalQtyKg(items) {
  return items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

function subtotal(items) {
  return items.reduce((sum, item) => sum + rowAmount(item), 0);
}

// Every set charge, in the shop's fixed order, plus Advance (subtracted) and
// a Note line -- each only when present, so a slip with no Bending Charges
// this time doesn't print a confusing "Bending Charges: 0".
function buildChargeRows(charges = {}, advance, note) {
  const rows = [];
  for (const [key, label] of CHARGE_LABELS) {
    const value = Number(charges[key]) || 0;
    if (value > 0) {
      rows.push(`    <tr class="charge-row"><td colspan="5" class="lbl">${label}</td><td class="n amt">${escapeHtml(formatIndian(value))}</td></tr>`);
    }
  }
  const advanceValue = Number(advance) || 0;
  if (advanceValue > 0) {
    rows.push(`    <tr class="charge-row"><td colspan="5" class="lbl">Advance</td><td class="n amt">-${escapeHtml(formatIndian(advanceValue))}</td></tr>`);
  }
  if (note) {
    rows.push(`    <tr class="charge-row"><td colspan="6" class="lbl" style="text-align:left">Note: ${escapeHtml(note)}</td></tr>`);
  }
  return rows.join('\n');
}

function chargesTotal(charges = {}, advance) {
  const chargeSum = CHARGE_LABELS.reduce((sum, [key]) => sum + (Number(charges[key]) || 0), 0);
  return chargeSum - (Number(advance) || 0);
}

function buildSteelChittiTable({ meta = {}, items = [], charges = {}, advance = 0, note, customerName } = {}) {
  const sub = subtotal(items);
  const total = sub + chargesTotal(charges, advance);
  const qs = totalQtyKg(items);
  const qtyLabel = Number.isInteger(qs) ? qs : qs.toFixed(2);

  return `<table class="slip steel">
  <colgroup>
    <col class="s-sl"><col class="s-part"><col class="s-pcs">
    <col class="s-qty"><col class="s-rate"><col class="s-amt">
  </colgroup>
  <thead>
    <tr><th class="slip-banner" colspan="6">${escapeHtml(customerName) || 'Walk-in / Cash Sale'}</th></tr>
    <tr>
      <th class="slip-meta" colspan="3">Date <span class="v">${escapeHtml(formatDate(meta.date))}</span></th>
      <th class="slip-meta" colspan="3">Lorry No. <span class="v">${escapeHtml(meta.lorry || '')}</span></th>
    </tr>
    <tr>
      <th class="col">Sl</th>
      <th class="col">Particulars</th>
      <th class="col n">Pcs</th>
      <th class="col n">Qty (Kg)</th>
      <th class="col n">Rate</th>
      <th class="col n amt">Amount</th>
    </tr>
  </thead>
  <tbody>
${buildRows(items)}
    <tr class="charge-row"><td colspan="3">${escapeHtml(qtyLabel)} Kgs</td><td colspan="2" class="lbl" style="font-weight:800">Subtotal</td><td class="n amt">${escapeHtml(formatIndian(sub))}</td></tr>
${buildChargeRows(charges, advance, note)}
  </tbody>
  <tfoot>
    <tr>
      <td class="total-label" colspan="5">TOTAL</td>
      <td class="n amt">${escapeHtml(formatIndian(total))}</td>
    </tr>
  </tfoot>
</table>`;
}

function buildSteelChittiHtml(data) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: #fff; }
${SLIP_CSS}
</style></head><body>${buildSteelChittiTable(data)}</body></html>`;
}

module.exports = { buildSteelChittiHtml, buildSteelChittiTable, rowAmount, MIN_BODY_ROWS };
