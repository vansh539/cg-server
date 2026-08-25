const test = require('node:test');
const assert = require('node:assert');
const { buildSteelChittiHtml, buildSteelChittiTable, rowAmount, MIN_BODY_ROWS } = require('../src/steelChittiTemplate');

test('is built on the shared slip class, like every other document', () => {
  const html = buildSteelChittiTable({ items: [] });
  assert.ok(html.includes('class="slip steel"'));
  assert.ok(html.includes('slip-banner'));
});

test('a row with Qty(kg) is billed by weight, even if Pcs is also filled', () => {
  assert.strictEqual(rowAmount({ qty: 100, pcs: 5, rate: 60 }), 6000);
});

test('a row with no Qty(kg) but Pcs and Rate is billed by piece', () => {
  assert.strictEqual(rowAmount({ qty: 0, pcs: 50, rate: 8 }), 400);
  assert.strictEqual(rowAmount({ qty: '', pcs: 50, rate: 8 }), 400);
});

test('a row missing Rate prices at zero rather than throwing', () => {
  assert.strictEqual(rowAmount({ qty: 100, pcs: '', rate: '' }), 0);
});

test('a charge is printed only when it is set, never as a confusing 0', () => {
  const html = buildSteelChittiTable({ items: [], charges: { loading: 480 } });
  assert.ok(html.includes('Loading'));
  assert.ok(!html.includes('Kanta'), 'an unset charge must not be printed');
  assert.ok(!html.includes('Bending Charges'));
});

test('Advance is subtracted from the total and shown as a negative line', () => {
  const items = [{ particulars: 'X', qty: 100, rate: 10 }]; // amount 1000
  const html = buildSteelChittiTable({ items, advance: 200 });
  assert.ok(html.includes('-200'));
  const totalMatch = html.match(/TOTAL<\/td>\s*<td class="n amt">([\d,]+)<\/td>/);
  assert.ok(totalMatch, 'TOTAL cell not found');
  assert.strictEqual(totalMatch[1], '800');
});

test('the subtotal row states total quantity in Kgs', () => {
  const items = [{ particulars: 'X', qty: 250.5, rate: 10 }, { particulars: 'Y', qty: 49.5, rate: 10 }];
  const html = buildSteelChittiTable({ items });
  assert.ok(html.includes('300 Kgs'), 'integer total should not show decimals');
});

test('a piece-only row (no kg) does not count toward the printed Kgs total', () => {
  const items = [{ particulars: 'Block', pcs: 10, rate: 8 }];
  const html = buildSteelChittiTable({ items });
  assert.ok(html.includes('0 Kgs'));
});

test('a short chitti is padded to the minimum body rows', () => {
  const html = buildSteelChittiTable({ items: [{ particulars: 'X', qty: 1, rate: 1 }] });
  const itemRows = (html.match(/<tr>/g) || []).length;
  assert.ok(itemRows >= MIN_BODY_ROWS, `expected at least ${MIN_BODY_ROWS} body rows`);
});

test('a note is printed only when given', () => {
  const withNote = buildSteelChittiTable({ items: [], note: 'Handle with care' });
  const withoutNote = buildSteelChittiTable({ items: [] });
  assert.ok(withNote.includes('Handle with care'));
  assert.ok(!withoutNote.includes('Note:'));
});

test('customer name, particulars and note are escaped', () => {
  const html = buildSteelChittiTable({
    customerName: '<script>alert(1)</script>',
    items: [{ particulars: '<img onerror=x>', qty: 1, rate: 1 }],
    note: '</td><b>x</b>',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('the standalone document inlines the stylesheet and fetches nothing', () => {
  const html = buildSteelChittiHtml({ items: [] });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('.slip {'), 'shared slip rules not inlined');
  assert.ok(html.includes('.steel col'), 'steel column widths not inlined');
  assert.ok(!/fonts\.googleapis|@import|<link/i.test(html), 'slip must not fetch anything at render time');
});
