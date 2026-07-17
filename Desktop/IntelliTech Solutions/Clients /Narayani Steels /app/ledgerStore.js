'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
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
        throw new Error(`ledger.json is corrupted and could not be parsed: ${err.message}`);
      }
    } else {
      data = { customers: [], invoices: [], ledgerEntries: [], invoiceCounter: 0 };
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

  function computeBalance(customerId) {
    let balance = 0;
    for (const e of data.ledgerEntries) {
      if (e.customerId !== customerId) continue;
      balance += e.type === 'due' ? e.amount : -e.amount;
    }
    return balance;
  }

  function listCustomers() {
    ensureLoaded();
    return data.customers.map((c) => ({ ...c, balance: computeBalance(c.id) }));
  }

  function getCustomer(id) {
    ensureLoaded();
    const c = data.customers.find((c) => c.id === id);
    if (!c) throw new Error('Customer not found');
    return { ...c, balance: computeBalance(id) };
  }

  function addCustomer({ name, phone }) {
    ensureLoaded();
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Customer name is required');
    const trimmedPhone = (phone || '').trim();
    if (!trimmedPhone) throw new Error('Phone number is required');
    if (!/^\d+$/.test(trimmedPhone)) throw new Error('Phone number must contain digits only');
    const cust = { id: newId('cust'), name: trimmedName, phone: trimmedPhone, createdAt: new Date().toISOString() };
    data.customers.push(cust);
    save();
    return { ...cust, balance: 0 };
  }

  function listEntries(customerId) {
    ensureLoaded();
    if (!data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    // ledgerEntries is always appended in chronological order — filtering
    // preserves that order, so this is already oldest-first with no sort
    // needed (same lesson as stockStore's movement-order fix: don't sort by
    // millisecond timestamps when array order already encodes the truth).
    return data.ledgerEntries.filter((e) => e.customerId === customerId);
  }

  function addManualEntry(customerId, type, amount, reason, note) {
    ensureLoaded();
    if (!data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Amount must be a positive number');
    const entry = { id: newId('le'), customerId, type, amount: n, reason, invoiceId: null, note: note || '', at: new Date().toISOString() };
    data.ledgerEntries.push(entry);
    save();
    return entry;
  }

  function addOldBalance(customerId, amount, note) {
    return addManualEntry(customerId, 'due', amount, 'old-balance', note);
  }

  function addCashPaid(customerId, amount, note) {
    return addManualEntry(customerId, 'payment', amount, 'cash-paid', note);
  }

  function getInvoice(id) {
    ensureLoaded();
    const inv = data.invoices.find((i) => i.id === id);
    if (!inv) throw new Error('Invoice not found');
    return inv;
  }

  function createInvoice({ customerId, date, mobile, lorry, items, sub, lab, weigh, freight, unload, gst, others, advance }) {
    ensureLoaded();
    if (!customerId || !data.customers.some((c) => c.id === customerId)) throw new Error('Customer not found');
    if (!Array.isArray(items) || !items.length) throw new Error('Items are required');
    const n = (v) => Number(v) || 0;
    const total = n(sub) + n(lab) + n(weigh) + n(freight) + n(unload) + n(gst) + n(others);
    data.invoiceCounter = (data.invoiceCounter || 0) + 1;
    const invoice = {
      id: newId('inv'),
      invoiceNo: data.invoiceCounter,
      customerId,
      date: date || '',
      mobile: mobile || '',
      lorry: lorry || '',
      items,
      sub: n(sub), lab: n(lab), weigh: n(weigh), freight: n(freight), unload: n(unload), gst: n(gst), others: n(others),
      total,
      createdAt: new Date().toISOString(),
    };
    data.invoices.push(invoice);
    data.ledgerEntries.push({ id: newId('le'), customerId, type: 'due', amount: total, reason: 'invoice', invoiceId: invoice.id, note: '', at: new Date().toISOString() });
    const advanceAmt = n(advance);
    if (advanceAmt > 0) {
      data.ledgerEntries.push({ id: newId('le'), customerId, type: 'payment', amount: advanceAmt, reason: 'advance', invoiceId: invoice.id, note: '', at: new Date().toISOString() });
    }
    save();
    return invoice;
  }

  return { init, listCustomers, getCustomer, addCustomer, listEntries, addOldBalance, addCashPaid, getInvoice, createInvoice };
}

module.exports = { createStore };
