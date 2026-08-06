'use strict';

const fs = require('fs');
const path = require('path');

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateKey(date) {
  if (typeof date !== 'string' || !DATE_KEY_RE.test(date)) {
    throw new Error('Date must be in YYYY-MM-DD format');
  }
}

function validateRows(rows, arrName) {
  if (!Array.isArray(rows)) throw new Error(`${arrName} must be an array`);
  return rows.map((r) => {
    const label = ((r && r.label) || '').trim();
    if (!label) throw new Error(`Each ${arrName} row needs a non-blank label`);
    const amount = Number(r && r.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Each ${arrName} row's amount must be a number ≥ 0`);
    }
    return { label, amount };
  });
}

function sum(rows) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

function computeSummary(date, rows) {
  const cashTotal = sum(rows.cashIn);
  const expensesTotal = sum(rows.expenses);
  const cashSubtotal = cashTotal - expensesTotal;
  const bankInTotal = sum(rows.bankIn);
  const bankOutTotal = sum(rows.bankOut);
  const bankSubtotal = bankInTotal - bankOutTotal;
  const closingBalance = cashSubtotal + bankSubtotal;
  return {
    date,
    cashIn: rows.cashIn,
    bankIn: rows.bankIn,
    expenses: rows.expenses,
    bankOut: rows.bankOut,
    cashTotal,
    expensesTotal,
    cashSubtotal,
    bankInTotal,
    bankOutTotal,
    bankSubtotal,
    closingBalance,
  };
}

function createStore(filePath) {
  let data = null;

  function load() {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`balance-sheet.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
      data = { days: {} };
      save();
    }
  }

  function save() {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function ensureLoaded() {
    if (!data) load();
  }

  function init() {
    ensureLoaded();
  }

  // The closing balance of the most recent EARLIER date that has a saved
  // record — computed fresh from whatever is on disk right now, never
  // cached. This is what makes editing a past day automatically correct
  // every later day's opening the next time it's viewed: there is no
  // stored "opening" value to go stale, only this live derivation.
  function deriveOpening(date) {
    const priorDates = Object.keys(data.days)
      .filter((d) => d < date)
      .sort();
    if (priorDates.length === 0) return 0;
    const lastDate = priorDates[priorDates.length - 1];
    return computeSummary(lastDate, data.days[lastDate]).closingBalance;
  }

  function getDay(date) {
    ensureLoaded();
    validateDateKey(date);
    const saved = data.days[date];
    if (saved) return computeSummary(date, saved);
    const opening = deriveOpening(date);
    return computeSummary(date, {
      cashIn: [{ label: 'Opening Balance', amount: opening }],
      bankIn: [],
      expenses: [],
      bankOut: [],
    });
  }

  function saveDay(date, { cashIn, bankIn, expenses, bankOut } = {}) {
    ensureLoaded();
    validateDateKey(date);
    const validCashIn = validateRows(cashIn, 'cashIn');
    if (validCashIn.length === 0) throw new Error('cashIn must include at least the Opening Balance row');
    // cashIn[0] is a reserved position, not identified by label text — its
    // label is always forced to the canonical value server-side so the UI
    // never has to trust (or re-send correctly) what the client displayed.
    validCashIn[0] = { ...validCashIn[0], label: 'Opening Balance' };
    const validBankIn = validateRows(bankIn, 'bankIn');
    const validExpenses = validateRows(expenses, 'expenses');
    const validBankOut = validateRows(bankOut, 'bankOut');

    data.days[date] = { cashIn: validCashIn, bankIn: validBankIn, expenses: validExpenses, bankOut: validBankOut };
    save();
    return computeSummary(date, data.days[date]);
  }

  return { init, getDay, saveDay };
}

module.exports = { createStore };
