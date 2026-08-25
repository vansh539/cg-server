const test = require('node:test');
const assert = require('node:assert');
const {
  buildLedgerHtml,
  buildLedgerTable,
  balanceLabel,
  MIN_BODY_ROWS,
} = require('../src/ledgerTemplate');

const CUSTOMER = { name: 'Bharat Cement Agencies', balance: 67500 };
const ENTRIES = [
  { occurred_at: '2026-08-05', type: 'invoice', label: 'invoice #1207', amount: 87500, runningBalance: 87500 },
  { occurred_at: '2026-08-11', type: 'payment', label: 'cash', amount: 50000, runningBalance: 37500 },
];

test('the statement is built on the shared slip class, not a design of its own', () => {
  const html = buildLedgerTable({ customer: CUSTOMER, entries: ENTRIES });
  assert.ok(html.includes('class="slip ledger"'), 'statement must reuse the slip rules');
  assert.ok(html.includes('slip-banner'), 'shared banner not used');
  // The navy/cyan card this replaced must not creep back in.
  assert.ok(!/#191048|#0093d9|border-radius/i.test(html), 'old ledger styling present');
});

test('an invoice adds to the balance and a payment subtracts', () => {
  const html = buildLedgerTable({ customer: CUSTOMER, entries: ENTRIES });
  assert.ok(html.includes('+87,500'), 'invoice should be signed positive');
  assert.ok(html.includes('-50,000'), 'payment should be signed negative');
});

test('paise survive -- money is never silently rounded', () => {
  const html = buildLedgerTable({
    customer: { name: 'X', balance: 54999.5 },
    entries: [{ occurred_at: '2026-08-20', type: 'payment', label: 'cash', amount: 12500.5, runningBalance: 54999.5 }],
  });
  assert.ok(html.includes('12,500.50'), 'amount lost its paise');
  assert.ok(html.includes('54,999.50'), 'balance lost its paise');
});

test('a short statement is padded so it reads as a ruled page', () => {
  const html = buildLedgerTable({ customer: CUSTOMER, entries: ENTRIES });
  const rows = html.match(/<tr>/g).length;
  // banner + meta + column labels + body + total
  assert.ok(rows >= MIN_BODY_ROWS + 4, `expected padding to ${MIN_BODY_ROWS} body rows, saw ${rows} rows total`);
});

test('a long statement is not truncated', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    occurred_at: '2026-08-05', type: 'invoice', label: `invoice #${i}`, amount: 100, runningBalance: 100 * i,
  }));
  const html = buildLedgerTable({ customer: CUSTOMER, entries: many });
  // Detail labels are title-cased for the customer's eye, as the old statement
  // did -- "invoice #39" goes out as "Invoice #39".
  assert.ok(html.includes('Invoice #39'), 'last entry missing');
  assert.strictEqual((html.match(/<tr>/g) || []).length, many.length + 4, 'row count changed');
});

test('the balance is labelled in words rather than by sign', () => {
  assert.strictEqual(balanceLabel(500), 'Balance Due');
  assert.strictEqual(balanceLabel(-500), 'In Credit');
  assert.strictEqual(balanceLabel(0), 'Balance');
  // A credit shows as a positive number under an "In Credit" label, never "-500".
  const html = buildLedgerTable({ customer: { name: 'X', balance: -500 }, entries: [] });
  assert.ok(html.includes('In Credit'));
  assert.ok(!html.includes('-500'), 'credit balance should not render as a negative');
});

test('a voided entry is still shown, and marked', () => {
  const html = buildLedgerTable({
    customer: CUSTOMER,
    entries: [{ occurred_at: '2026-08-20', type: 'payment', label: 'cash', amount: 1, runningBalance: 1, voided: true }],
  });
  assert.ok(/voided/i.test(html), 'voided entry lost its marker');
});

test('customer names and details are escaped', () => {
  const html = buildLedgerTable({
    customer: { name: '<script>alert(1)</script>', balance: 0 },
    entries: [{ occurred_at: '2026-08-05', type: 'invoice', label: '<img onerror=x>', amount: 1, runningBalance: 1 }],
  });
  assert.ok(!html.includes('<script>'), 'customer name not escaped');
  assert.ok(!html.includes('<img onerror'), 'entry label not escaped');
});

test('a customer with no entries still produces a usable statement', () => {
  const html = buildLedgerTable({ customer: { name: 'New Customer', balance: 0 }, entries: [] });
  assert.ok(html.includes('New Customer'));
  assert.ok(html.includes('Balance'));
});

test('an invoice entry with items shows particulars, quantity and rate', () => {
  const html = buildLedgerTable({
    customer: CUSTOMER,
    entries: [{
      occurred_at: '2026-08-05', type: 'invoice', label: 'invoice #1207', amount: 87500, runningBalance: 87500,
      items: [
        { particulars: 'OPC Cement', qty: 50, rate: 380 },
        { particulars: 'PPC', qty: 20, rate: 350 },
      ],
    }],
  });
  assert.ok(html.includes('Invoice #1207'), 'invoice heading missing');
  assert.ok(html.includes('OPC Cement'), 'first item particulars missing');
  assert.ok(html.includes('PPC'), 'second item particulars missing');
  assert.ok(html.includes('50') && html.includes('380'), 'first item qty/rate missing');
  assert.ok(html.includes('20') && html.includes('350'), 'second item qty/rate missing');
});

test('an invoice entry with no items still renders (opening balances, pre-items data)', () => {
  const html = buildLedgerTable({
    customer: CUSTOMER,
    entries: [{ occurred_at: '2026-08-05', type: 'invoice', label: 'Opening Balance', amount: 1000, runningBalance: 1000 }],
  });
  assert.ok(html.includes('Opening Balance'));
  assert.ok(!html.includes('item-line'), 'no item-line markup expected without items');
});

test('item particulars are escaped', () => {
  const html = buildLedgerTable({
    customer: CUSTOMER,
    entries: [{
      occurred_at: '2026-08-05', type: 'invoice', label: 'invoice #1', amount: 100, runningBalance: 100,
      items: [{ particulars: '<img onerror=x>', qty: 1, rate: 100 }],
    }],
  });
  assert.ok(!html.includes('<img onerror'), 'item particulars not escaped');
});

test('the standalone document inlines the stylesheet and fetches nothing', () => {
  const html = buildLedgerHtml({ customer: CUSTOMER, entries: ENTRIES });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('.slip {'), 'shared slip rules not inlined');
  assert.ok(html.includes('.ledger col'), 'ledger column widths not inlined');
  // Same constraint as the chitti: a render-time font fetch made output size
  // swing between 200KB and 4MB.
  assert.ok(!/fonts\.googleapis|@import|<link/i.test(html), 'statement must not fetch anything at render time');
});
