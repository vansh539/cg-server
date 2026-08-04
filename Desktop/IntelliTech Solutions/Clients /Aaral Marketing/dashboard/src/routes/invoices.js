const express = require('express');
const { createInvoice, normalizeItems, voidInvoice, updateInvoice, deleteInvoice } = require('../invoices');
const { notify, notifyWithPdf } = require('../notify');
const { renderInvoicePdf } = require('../pdf');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');
const { requirePin } = require('../adminAuth');

const router = express.Router();

router.post('/invoices', async (req, res) => {
  try {
    const {
      customerId, items, unloadingCharge, paidNow, createdBy, sendWhatsapp,
      invoiceDate, destination, paperWidthMm, paperHeightMm,
    } = req.body;
    const result = await createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy, invoiceDate, destination });

    if (customerId) {
      const customer = await customers.findById(customerId);
      const balance = await balances.getBalanceByCustomerId(customerId);
      const balanceLine = balance ? `Balance: ₹${balance.balance}` : '';

      const customerMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received, thank you! ${balanceLine}`
        : `New invoice #${result.invoice.invoice_number} for ₹${result.invoice.total}. ${balanceLine}`;
      const adminMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received from ${customer.name}. ${balanceLine}`
        : `Invoice #${result.invoice.invoice_number} (₹${result.invoice.total}) issued to ${customer.name}. ${balanceLine}`;

      if (sendWhatsapp) {
        const pdfItems = result.items.map((item) => ({
          s_no: item.sNo, particulars: item.particulars, grade: item.grade,
          vch: item.vch, qty: item.qty, rate: item.rate, amount: item.amount,
        }));
        renderInvoicePdf({
          invoice: result.invoice, items: pdfItems, customerName: customer.name,
          paperWidthMm, paperHeightMm,
        })
          .then((pdfBuffer) => notifyWithPdf(
            customer.phone_number, customerMsg, pdfBuffer, `Invoice-${result.invoice.invoice_number}.pdf`
          ))
          .catch((err) => console.error('[Invoices] Failed to generate/send invoice PDF:', err.message));
      } else {
        notify(customer.phone_number, customerMsg);
      }
      const { rows: admins } = await query('SELECT phone_number FROM admins WHERE active = true');
      for (const admin of admins) notify(admin.phone_number, adminMsg);
    }

    res.json({
      ok: true,
      invoiceId: result.invoice ? result.invoice.id : null,
      invoiceNumber: result.invoice ? result.invoice.invoice_number : null,
      total: result.invoice ? result.invoice.total : result.total,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Stateless PDF generation for the slip's "Save as PDF" / reprint flow --
// deliberately never touches the DB (mirrors quotations.js's stateless PDF
// route), so it can be called any number of times without ever creating a
// duplicate invoice, whether or not the slip has actually been saved yet.
router.post('/invoices/pdf', async (req, res) => {
  try {
    const {
      items, unloadingCharge, invoiceDate, destination,
      paperWidthMm, paperHeightMm, customerName,
    } = req.body;
    const normalizedItems = normalizeItems(items);
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
    const unloading = unloadingCharge ? Number(unloadingCharge) : 0;
    const total = subtotal + unloading;
    const pdfItems = normalizedItems.map((item) => ({
      s_no: item.sNo, particulars: item.particulars, grade: item.grade,
      vch: item.vch, qty: item.qty, rate: item.rate, amount: item.amount,
    }));
    const pdfBuffer = await renderInvoicePdf({
      invoice: { total, created_at: invoiceDate || null, destination: destination || null },
      items: pdfItems,
      customerName: customerName || '',
      paperWidthMm, paperHeightMm,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Slip.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  const { rows: invoiceRows } = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
  const { rows: itemRows } = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
    [req.params.id]
  );
  res.json({ invoice: invoiceRows[0], items: itemRows });
});

// Reprint -- regenerates the same branded PDF a customer would have gotten
// via WhatsApp, from the invoice as it's actually stored today. Paper size
// isn't persisted on the invoice (never was, even for the original send),
// so this defaults to A4 same as renderInvoicePdf always has.
router.get('/invoices/:id/pdf', async (req, res) => {
  const { rows: invoiceRows } = await query(
    `SELECT i.*, c.name AS customer_name FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1`,
    [req.params.id]
  );
  if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
  const invoice = invoiceRows[0];
  const { rows: itemRows } = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
    [req.params.id]
  );
  const pdfBuffer = await renderInvoicePdf({ invoice, items: itemRows, customerName: invoice.customer_name });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`);
  res.send(pdfBuffer);
});

router.put('/invoices/:id', requirePin, async (req, res) => {
  try {
    const { items, unloadingCharge, destination, invoiceDate } = req.body;
    const result = await updateInvoice(
      req.params.id, { items, unloadingCharge, destination, invoiceDate }, 'dashboard'
    );
    res.json({ ok: true, invoice: result.invoice });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/invoices/:id/void', requirePin, async (req, res) => {
  try {
    await voidInvoice(req.params.id, 'dashboard');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/invoices/:id', requirePin, async (req, res) => {
  try {
    await deleteInvoice(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
