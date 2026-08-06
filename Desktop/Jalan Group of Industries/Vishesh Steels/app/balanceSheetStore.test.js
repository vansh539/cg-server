'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./balanceSheetStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-balance-sheet-'));
  return path.join(dir, 'balance-sheet.json');
}

test('getDay on a date with no saved history returns opening 0 and empty arrays', () => {
  const store = createStore(tempFile());
  const day = store.getDay('2026-07-01');
  assert.equal(day.cashIn.length, 1);
  assert.equal(day.cashIn[0].label, 'Opening Balance');
  assert.equal(day.cashIn[0].amount, 0);
  assert.deepEqual(day.bankIn, []);
  assert.deepEqual(day.expenses, []);
  assert.deepEqual(day.bankOut, []);
  assert.equal(day.closingBalance, 0);
});

test('saveDay computes cashSubtotal, bankSubtotal, and closingBalance correctly', () => {
  const store = createStore(tempFile());
  const saved = store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }, { label: 'Ashok', amount: 500 }],
    bankIn: [{ label: 'Narsingh Steel', amount: 2000 }],
    expenses: [{ label: 'Coal', amount: 300 }],
    bankOut: [{ label: 'Supplier payment', amount: 1200 }],
  });
  assert.equal(saved.cashTotal, 1500);
  assert.equal(saved.expensesTotal, 300);
  assert.equal(saved.cashSubtotal, 1200); // 1500 - 300
  assert.equal(saved.bankInTotal, 2000);
  assert.equal(saved.bankOutTotal, 1200);
  assert.equal(saved.bankSubtotal, 800); // 2000 - 1200
  assert.equal(saved.closingBalance, 2000); // 1200 + 800
});

test('saveDay persists rows; a fresh store instance reloading from disk returns the same data', () => {
  const file = tempFile();
  const store = createStore(file);
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [{ label: 'Coal', amount: 300 }],
    bankOut: [],
  });

  const reloaded = createStore(file);
  const day = reloaded.getDay('2026-07-01');
  assert.equal(day.cashIn[0].amount, 1000);
  assert.equal(day.expenses[0].label, 'Coal');
  assert.equal(day.closingBalance, 700);
});

test('opening balance carries forward from the most recent earlier saved date', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 1000

  const nextDay = store.getDay('2026-07-02');
  assert.equal(nextDay.cashIn[0].amount, 1000);
});

test('opening balance carries forward across a gap day that has no saved record at all', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 500 }],
    bankIn: [{ label: 'Deposit', amount: 200 }],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 700
  // 2026-07-02 is never saved.
  const dayAfterGap = store.getDay('2026-07-03');
  assert.equal(dayAfterGap.cashIn[0].amount, 700);
});

test('editing a past day changes a later unsaved day\'s derived opening on next read', () => {
  const store = createStore(tempFile());
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 1000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 1000
  assert.equal(store.getDay('2026-07-02').cashIn[0].amount, 1000);

  // Re-save 2026-07-01 with a corrected higher opening balance.
  store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Opening Balance', amount: 5000 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  }); // closingBalance = 5000
  assert.equal(store.getDay('2026-07-02').cashIn[0].amount, 5000);
});

test('saveDay rejects a blank label, a negative amount, and a non-numeric amount', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: '  ', amount: 100 }], bankIn: [], expenses: [], bankOut: [] }),
    /non-blank label/
  );
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: 'Opening Balance', amount: -5 }], bankIn: [], expenses: [], bankOut: [] }),
    /amount must be a number/
  );
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [{ label: 'Opening Balance', amount: 'abc' }], bankIn: [], expenses: [], bankOut: [] }),
    /amount must be a number/
  );
});

test('saveDay rejects an empty cashIn array', () => {
  const store = createStore(tempFile());
  assert.throws(
    () => store.saveDay('2026-07-01', { cashIn: [], bankIn: [], expenses: [], bankOut: [] }),
    /at least the Opening Balance row/
  );
});

test('saveDay forces cashIn[0]\'s label to "Opening Balance" regardless of what the client sends', () => {
  const store = createStore(tempFile());
  const saved = store.saveDay('2026-07-01', {
    cashIn: [{ label: 'Whatever the client sent', amount: 250 }],
    bankIn: [],
    expenses: [],
    bankOut: [],
  });
  assert.equal(saved.cashIn[0].label, 'Opening Balance');
  assert.equal(saved.cashIn[0].amount, 250);
});

test('getDay and saveDay reject a malformed date key', () => {
  const store = createStore(tempFile());
  assert.throws(() => store.getDay('07-01-2026'), /YYYY-MM-DD/);
  assert.throws(
    () => store.saveDay('not-a-date', { cashIn: [{ label: 'Opening Balance', amount: 0 }], bankIn: [], expenses: [], bankOut: [] }),
    /YYYY-MM-DD/
  );
});
