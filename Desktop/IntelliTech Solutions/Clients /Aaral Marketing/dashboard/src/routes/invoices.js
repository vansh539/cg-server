const express = require('express');
const { createInvoice, normalizeItems, voidInvoice, updateInvoice, deleteInvoice } = require('../invoices');
const { notify, notifyWithPdf, humanReason } = require('../notify');
const { renderInvoicePdf, renderInvoiceImage } = require('../pdf');
const customers = require('payment-ledger-core/ledger/customers');
const balances = require('payment-ledger-core/ledger/balances');
const { query } = require('payment-ledger-core/db');
const { requireAdmin } = require('../sessionAuth');
const { buildInvoiceFilename, contentDisposition } = require('../invoiceFilename');
const { buildChittiTable, formatDate } = require('../chittiTemplate');
const { logActivity } = require('../activityLog');

const router = express.Router();

router.post('/invoices', async (req, res) => {
  try {
    const {
      customerId, items, unloadingCharge, paidNow,
      invoiceDate, destination,
    } = req.body;
    const createdBy = req.session.user.username;
    const result = await createInvoice({ customerId, items, unloadingCharge, paidNow, createdBy, invoiceDate, destination });

    if (customerId) {
      const customer = await customers.findById(customerId);
      const balance = await balances.getBalanceByCustomerId(customerId);
      const balanceLine = balance ? `Balance: ₹${balance.balance}` : '';

      const customerMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received on ${formatDate()}, thank you! ${balanceLine}`
        : `New invoice #${result.invoice.invoice_number} for ₹${result.invoice.total}, dated ${formatDate()}. ${balanceLine}`;
      const adminMsg = result.claimId
        ? `Payment of ₹${result.invoice.total} received from ${customer.name} on ${formatDate()}. ${balanceLine}`
        : `Invoice #${result.invoice.invoice_number} (₹${result.invoice.total}) issued to ${customer.name} on ${formatDate()}. ${balanceLine}`;

      // The PDF itself is sent on demand via the dashboard's "Send PDF on
      // WhatsApp" button (POST /invoices/:id/send-whatsapp) instead of
      // automatically here -- that used to be a checkbox on this same
      // request, but a fire-and-forget PDF render+send with failures only
      // logged server-side meant staff had no way to tell it hadn't
      // actually gone through.
      notify(customer.phone_number, customerMsg);
      const { rows: admins } = await query('SELECT phone_number FROM admins WHERE active = true');
      for (const admin of admins) notify(admin.phone_number, adminMsg);
    }

    await logActivity(
      req, 'created invoice',
      result.invoice ? `#${result.invoice.invoice_number} — ₹${result.invoice.total}` : `walk-in — ₹${result.total}`
    );

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
      paperWidthMm, paperHeightMm, customerName, invoiceNumber,
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
    // Was hardcoded "Slip.pdf", so a folder of saved slips was Slip.pdf,
    // Slip (1).pdf, ... with no way to tell whose was whose.
    res.setHeader('Content-Disposition', contentDisposition(
      buildInvoiceFilename({ customerName, invoiceNumber })
    ));
    res.send(pdfBuffer);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// JPEG twin of the PDF route above. Same slip, same exact paper size --
// staff asked for an image they can drop straight into a chat or a gallery
// without going through a PDF viewer.
router.post('/invoices/image', async (req, res) => {
  try {
    const {
      items, unloadingCharge, invoiceDate, destination,
      paperWidthMm, paperHeightMm, customerName, invoiceNumber,
    } = req.body;
    const normalizedItems = normalizeItems(items);
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
    const unloading = unloadingCharge ? Number(unloadingCharge) : 0;
    const pdfItems = normalizedItems.map((item) => ({
      s_no: item.sNo, particulars: item.particulars, grade: item.grade,
      vch: item.vch, qty: item.qty, rate: item.rate, amount: item.amount,
    }));
    const imageBuffer = await renderInvoiceImage({
      invoice: { total: subtotal + unloading, created_at: invoiceDate || null, destination: destination || null },
      items: pdfItems,
      customerName: customerName || '',
      paperWidthMm, paperHeightMm,
    });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', contentDisposition(
      buildInvoiceFilename({ customerName, invoiceNumber }).replace(/\.pdf$/, '.jpg')
    ));
    res.send(imageBuffer);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Stateless chitti fragment, for the slip editor's Print button. Same
// template as the PDF/JPEG, so what prints is what downloads.
router.post('/invoices/chitti', async (req, res) => {
  try {
    const { items, unloadingCharge, invoiceDate, destination, customerName } = req.body;
    const normalizedItems = normalizeItems(items);
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
    const unloading = unloadingCharge ? Number(unloadingCharge) : 0;
    res.json({
      ok: true,
      html: buildChittiTable({
        invoice: { total: subtotal + unloading, created_at: invoiceDate || null, destination: destination || null },
        items: normalizedItems.map((item) => ({
          s_no: item.sNo, particulars: item.particulars, grade: item.grade,
          vch: item.vch, qty: item.qty, rate: item.rate, amount: item.amount,
        })),
        customerName: customerName || '',
      }),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  const { rows: invoiceRows } = await query(
    `SELECT i.*, c.name AS customer_name FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1`,
    [req.params.id]
  );
  if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
  const { rows: itemRows } = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
    [req.params.id]
  );
  res.json({ invoice: invoiceRows[0], items: itemRows });
});

// The rendered chitti for one saved invoice, as an HTML fragment.
//
// invoice.html injects this instead of rebuilding the slip in browser JS. That
// keeps the on-screen preview, the printed page, the PDF and the JPEG all
// coming from src/chittiTemplate.js -- previously invoice.html had its own
// copy of both the markup and the print CSS, which is how the design drifted
// apart in the first place. Every value is escaped by the template.
router.get('/invoices/:id/chitti', async (req, res) => {
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
  res.json({
    ok: true,
    html: buildChittiTable({ invoice, items: itemRows, customerName: invoice.customer_name }),
  });
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
  res.setHeader('Content-Disposition', contentDisposition(buildInvoiceFilename({
    customerName: invoice.customer_name, invoiceNumber: invoice.invoice_number,
  })));
  res.send(pdfBuffer);
});

// Explicit, on-demand send -- triggered by the dashboard's "Send PDF on
// WhatsApp" button rather than bundled into invoice creation, specifically
// so a failure (bot offline, PDF render error, etc) is reported back to
// whoever clicked the button instead of only ever reaching a server log.
router.post('/invoices/:id/send-whatsapp', async (req, res) => {
  try {
    const { paperWidthMm, paperHeightMm } = req.body;
    const { rows: invoiceRows } = await query(
      `SELECT i.*, c.name AS customer_name, c.phone_number AS customer_phone FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (invoiceRows.length === 0) return res.status(404).json({ ok: false, error: 'Invoice not found' });
    const invoice = invoiceRows[0];
    if (!invoice.customer_id) {
      return res.status(400).json({ ok: false, error: 'This invoice has no customer on file (walk-in sale) -- nothing to send it to.' });
    }

    const { rows: itemRows } = await query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY s_no ASC',
      [req.params.id]
    );
    const balance = await balances.getBalanceByCustomerId(invoice.customer_id);
    const balanceLine = balance ? ` Balance: ₹${balance.balance}` : '';
    const message = invoice.paid_now
      ? `Payment of ₹${invoice.total} received on ${formatDate()}, thank you!${balanceLine}`
      : `Invoice #${invoice.invoice_number} for ₹${invoice.total}, dated ${formatDate()}.${balanceLine}`;

    const pdfBuffer = await renderInvoicePdf({
      invoice, items: itemRows, customerName: invoice.customer_name, paperWidthMm, paperHeightMm,
    });
    // Same naming as the downloadable copy, so what the customer receives on
    // WhatsApp and what the office files away are the same recognisable document.
    const result = await notifyWithPdf(
      invoice.customer_phone, message, pdfBuffer,
      buildInvoiceFilename({ customerName: invoice.customer_name, invoiceNumber: invoice.invoice_number })
    );
    if (!result.sent) {
      return res.status(502).json({ ok: false, error: humanReason(result), recovering: result.recovering === true });
    }
    await logActivity(req, 'sent invoice on WhatsApp', `#${invoice.invoice_number} to ${invoice.customer_name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/invoices/:id', async (req, res) => {
  try {
    const { items, unloadingCharge, destination, invoiceDate } = req.body;
    const result = await updateInvoice(
      req.params.id, { items, unloadingCharge, destination, invoiceDate }, req.session.user.username
    );
    await logActivity(req, 'edited invoice', `#${result.invoice.invoice_number}`);
    res.json({ ok: true, invoice: result.invoice });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/invoices/:id/void', async (req, res) => {
  try {
    await voidInvoice(req.params.id, req.session.user.username);
    await logActivity(req, 'voided invoice', `id ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/invoices/:id', requireAdmin, async (req, res) => {
  try {
    await deleteInvoice(req.params.id);
    await logActivity(req, 'deleted invoice', `id ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
