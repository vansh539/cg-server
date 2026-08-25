const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChittiTable, buildChittiHtml, formatIndian, MIN_BODY_ROWS } = require('../src/chittiTemplate');

const ITEMS = [
  { s_no: 1, particulars: 'Birla Samrat', grade: 'PPC', vch: '4471', qty: 500, rate: 235, amount: 117500 },
];
const INVOICE = { total: 117500, created_at: '2026-07-09', destination: 'Miyapur' };

test('Indian digit grouping, not Western', () => {
  assert.equal(formatIndian(117500), '1,17,500');
  assert.equal(formatIndian(1655000), '16,55,000');
  assert.equal(formatIndian(999), '999');
  assert.equal(formatIndian(1000), '1,000');
});

test('whole numbers stay whole, decimals keep two places', () => {
  assert.equal(formatIndian(500), '500');
  assert.equal(formatIndian(235.5), '235.50');
  assert.equal(formatIndian(0), '0');
});

test('negative amounts keep their sign outside the grouping', () => {
  assert.equal(formatIndian(-117500), '-1,17,500');
});

test('non-numeric input degrades to 0 rather than NaN on a printed slip', () => {
  assert.equal(formatIndian(undefined), '0');
  assert.equal(formatIndian(null), '0');
  assert.equal(formatIndian('abc'), '0');
});

test('all seven columns are present, voucher included', () => {
  const html = buildChittiTable({ invoice: INVOICE, items: ITEMS, customerName: 'Shyam Miyapur' });
  for (const heading of ['Sl', 'Particulars', 'Grade', 'Vch', 'Qty', 'Rate', 'Amount']) {
    assert.ok(html.includes(`>${heading}<`), `missing column: ${heading}`);
  }
  // The voucher value itself must reach the slip, not just the header.
  assert.ok(html.includes('4471'), 'voucher value missing');
});

test('short slips are padded with blank rows like a printed pad', () => {
  const html = buildChittiTable({ invoice: INVOICE, items: ITEMS, customerName: 'X' });
  const bodyRows = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>')).match(/<tr>/g) || [];
  assert.equal(bodyRows.length, MIN_BODY_ROWS);
});

test('a full slip is not truncated to the blank-row minimum', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ ...ITEMS[0], s_no: i + 1 }));
  const html = buildChittiTable({ invoice: INVOICE, items: many, customerName: 'X' });
  const bodyRows = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>')).match(/<tr>/g) || [];
  assert.equal(bodyRows.length, 9);
});

test('a walk-in with no customer still gets a banner', () => {
  const html = buildChittiTable({ invoice: INVOICE, items: ITEMS, customerName: '' });
  assert.ok(html.includes('Walk-in / Cash Sale'));
});

test('customer names are escaped, not injected', () => {
  const html = buildChittiTable({
    invoice: INVOICE, items: ITEMS,
    customerName: '<script>alert(1)</script>',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag reached the slip');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('item fields are escaped too', () => {
  const html = buildChittiTable({
    invoice: INVOICE,
    items: [{ ...ITEMS[0], particulars: 'A & B <b>' }],
    customerName: 'X',
  });
  assert.ok(html.includes('A &amp; B &lt;b&gt;'));
});

test('a missing destination renders an empty cell, not the word undefined', () => {
  const html = buildChittiTable({
    invoice: { total: 100, created_at: '2026-07-09' }, items: ITEMS, customerName: 'X',
  });
  assert.ok(!html.toLowerCase().includes('undefined'));
  assert.ok(!html.toLowerCase().includes('null'));
});

test('dates render dd-mm-yyyy', () => {
  const html = buildChittiTable({ invoice: INVOICE, items: ITEMS, customerName: 'X' });
  assert.ok(html.includes('09-07-2026'), 'expected dd-mm-yyyy');
});

test('the destination sits left of the date in the meta row', () => {
  const html = buildChittiTable({ invoice: INVOICE, items: ITEMS, customerName: 'X' });
  const toIndex = html.indexOf('>To ');
  const dateIndex = html.indexOf('>Date ');
  assert.ok(toIndex > -1 && dateIndex > -1, 'meta row fields not found');
  assert.ok(toIndex < dateIndex, 'To must render before Date, left to right');
});

test('the standalone document carries the stylesheet and no external fetches', () => {
  const html = buildChittiHtml({ invoice: INVOICE, items: ITEMS, customerName: 'X' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('.slip {'), 'shared slip rules not inlined');
  assert.ok(html.includes('.chitti col'), 'chitti column widths not inlined');
  // A web-font fetch at Puppeteer render time is what made output size swing
  // between 200KB and 4MB; the slip must stay on system fonts.
  assert.ok(!/fonts\.googleapis|@import|<link/i.test(html), 'slip must not fetch anything at render time');
});
