'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./ledgerStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-ledger-'));
  return path.join(dir, 'ledger.json');
}

test('starts with no customers', () => {
  const store = createStore(tempFile());
  assert.deepEqual(store.listCustomers(), []);
});

test('addCustomer validates name and phone', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.addCustomer({ name: '', phone: '9876543210' }), /Customer name is required/);
  assert.throws(() => store.addCustomer({ name: 'Lakshmi Steel', phone: '' }), /Phone number is required/);
  assert.throws(() => store.addCustomer({ name: 'Lakshmi Steel', phone: 'abc123' }), /Phone number must contain digits only/);

  const cust = store.addCustomer({ name: 'Lakshmi Steel', phone: '9876543210' });
  assert.equal(cust.name, 'Lakshmi Steel');
  assert.equal(cust.balance, 0);
  assert.equal(store.listCustomers().length, 1);
});

test('getCustomer throws for unknown id', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.getCustomer('cust_ghost'), /Customer not found/);
});

test('createInvoice posts a due entry equal to charges only, never including old balance', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Lakshmi Steel', phone: '9876543210' });

  const invoice = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '9876543210', lorry: 'TS08AB1234',
    items: [{ q: '500', name: 'MS Angle', p: '20', r: '52' }],
    sub: 26000, lab: 200, weigh: 0, freight: 0, unload: 0, gst: 4716, others: 0, advance: 0,
  });

  assert.equal(invoice.invoiceNo, 1);
  assert.equal(invoice.total, 26000 + 200 + 4716); // sub+lab+gst only — no old balance in this total

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'due');
  assert.equal(entries[0].reason, 'invoice');
  assert.equal(entries[0].amount, 26000 + 200 + 4716);
  assert.equal(entries[0].invoiceId, invoice.id);

  assert.equal(store.getCustomer(cust.id).balance, 26000 + 200 + 4716);
});

test('createInvoice with advance also posts a separate payment entry', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Test Buyer', phone: '9998887776' });

  const invoice = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '', lorry: '',
    items: [{ q: '100', name: 'TMT Bar', p: '10', r: '55' }],
    sub: 5500, lab: 40, weigh: 0, freight: 0, unload: 0, gst: 998, others: 0, advance: 2000,
  });

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reason, 'invoice');   // pushed first, chronologically first
  assert.equal(entries[1].reason, 'advance');
  assert.equal(entries[1].type, 'payment');
  assert.equal(entries[1].amount, 2000);
  assert.equal(entries[1].invoiceId, invoice.id);

  assert.equal(store.getCustomer(cust.id).balance, (5500 + 40 + 998) - 2000);
});

test('createInvoice stores oldbal/advance for display but never lets them affect total or the due amount', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Display Fields Co', phone: '8887776665' });
  store.addOldBalance(cust.id, 40916); // pre-existing balance, same as what the Chitti's Old Balance field would show

  const invoice = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '9876543210', lorry: 'TS08AB1234',
    items: [{ q: '500', name: 'MS Angle', p: '', r: '52' }],
    sub: 26000, lab: 200, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, oldbal: 40916, advance: 1000,
  });

  assert.equal(invoice.oldbal, 40916);
  assert.equal(invoice.advance, 1000);
  assert.equal(invoice.total, 26000 + 200); // oldbal/advance never enter this sum
  assert.equal(store.getCustomer(cust.id).balance, 40916 + (26000 + 200) - 1000); // old balance counted once, not twice
});

test('createInvoice rejects an unknown customer and requires items', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.createInvoice({ customerId: 'cust_ghost', items: [{ q: '1', name: 'x', p: '1', r: '1' }], sub: 1 }),
    /Customer not found/
  );
  const cust = store.addCustomer({ name: 'Empty Items Co', phone: '1112223334' });
  assert.throws(() => store.createInvoice({ customerId: cust.id, items: [] }), /Items are required/);
});

test('addOldBalance posts a due entry with reason old-balance; addCashPaid posts a payment', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Backfill Co', phone: '5556667778' });

  store.addOldBalance(cust.id, 15000, 'Pre-system dues');
  assert.equal(store.getCustomer(cust.id).balance, 15000);

  store.addCashPaid(cust.id, 5000, 'Cash collected in shop');
  assert.equal(store.getCustomer(cust.id).balance, 10000);

  const entries = store.listEntries(cust.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reason, 'old-balance');
  assert.equal(entries[0].type, 'due');
  assert.equal(entries[1].reason, 'cash-paid');
  assert.equal(entries[1].type, 'payment');
});

test('addOldBalance and addCashPaid reject non-positive amounts and unknown customers', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Validation Co', phone: '4443332221' });
  assert.throws(() => store.addOldBalance(cust.id, 0), /Amount must be a positive number/);
  assert.throws(() => store.addCashPaid(cust.id, -5), /Amount must be a positive number/);
  assert.throws(() => store.addOldBalance('cust_ghost', 100), /Customer not found/);
});

test('getInvoice returns the stored snapshot; throws for unknown id', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Snapshot Co', phone: '2223334445' });
  const created = store.createInvoice({
    customerId: cust.id, date: '17/07/2026', mobile: '2223334445', lorry: 'TS09ZZ0001',
    items: [{ q: '10', name: 'Rod', p: '1', r: '5' }], sub: 50, lab: 5, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0,
  });
  const fetched = store.getInvoice(created.id);
  assert.equal(fetched.invoiceNo, created.invoiceNo);
  assert.equal(fetched.items.length, 1);
  assert.throws(() => store.getInvoice('inv_ghost'), /Invoice not found/);
});

test('invoice numbers increment sequentially across customers', () => {
  const store = createStore(tempFile());
  const a = store.addCustomer({ name: 'A Co', phone: '1000000001' });
  const b = store.addCustomer({ name: 'B Co', phone: '1000000002' });
  const inv1 = store.createInvoice({ customerId: a.id, items: [{ q: '1', name: 'x', p: '1', r: '1' }], sub: 1, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0 });
  const inv2 = store.createInvoice({ customerId: b.id, items: [{ q: '1', name: 'y', p: '1', r: '1' }], sub: 1, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 0 });
  assert.equal(inv1.invoiceNo, 1);
  assert.equal(inv2.invoiceNo, 2);
});

test('data survives being reloaded from disk by a fresh store instance', () => {
  const file = tempFile();
  const store = createStore(file);
  const cust = store.addCustomer({ name: 'Persist Co', phone: '9990001112' });
  store.addOldBalance(cust.id, 500);

  const reloaded = createStore(file);
  assert.equal(reloaded.getCustomer(cust.id).balance, 500);
  assert.equal(reloaded.listEntries(cust.id).length, 1);
});

test('updateEntry edits the amount and note of a manual entry and recomputes balance', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Editable Co', phone: '1112223334' });
  const entry = store.addOldBalance(cust.id, 500, 'typo, should be 600');

  const updated = store.updateEntry(entry.id, { amount: 600, note: 'corrected' });
  assert.equal(updated.amount, 600);
  assert.equal(updated.note, 'corrected');
  assert.equal(store.getCustomer(cust.id).balance, 600);

  assert.throws(() => store.updateEntry(entry.id, { amount: 0 }), /Amount must be a positive number/);
  assert.throws(() => store.updateEntry('le_ghost', { amount: 100 }), /Ledger entry not found/);
});

test('deleteEntry removes a manual entry and recomputes balance; unknown id throws', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Deletable Co', phone: '1112223335' });
  const entry = store.addCashPaid(cust.id, 200);
  assert.equal(store.getCustomer(cust.id).balance, -200);

  store.deleteEntry(entry.id);
  assert.equal(store.getCustomer(cust.id).balance, 0);
  assert.equal(store.listEntries(cust.id).length, 0);

  assert.throws(() => store.deleteEntry('le_ghost'), /Ledger entry not found/);
});

test('updateEntry and deleteEntry reject invoice and advance entries — those stay paired with the printed invoice', () => {
  const store = createStore(tempFile());
  const cust = store.addCustomer({ name: 'Invoice Co', phone: '1112223336' });
  store.createInvoice({
    customerId: cust.id,
    items: [{ q: '10', name: 'Rod', p: '1', r: '5' }],
    sub: 50, lab: 0, weigh: 0, freight: 0, unload: 0, gst: 0, others: 0, advance: 20,
  });
  const [invoiceEntry, advanceEntry] = store.listEntries(cust.id);
  assert.equal(invoiceEntry.reason, 'invoice');
  assert.equal(advanceEntry.reason, 'advance');

  assert.throws(() => store.updateEntry(invoiceEntry.id, { amount: 999 }), /Only manually-added entries/);
  assert.throws(() => store.deleteEntry(advanceEntry.id), /Only manually-added entries/);
});
