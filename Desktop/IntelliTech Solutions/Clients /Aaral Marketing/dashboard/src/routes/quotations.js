const express = require('express');
const { renderQuotationPdf } = require('../quotationPdf');
const { notifyWithPdf, humanReason } = require('../notify');
const { logActivity } = require('../activityLog');
const { formatDate } = require('../chittiTemplate');

const router = express.Router();

router.post('/quotations/pdf', async (req, res) => {
  try {
    const { recipientName, recipientAddress, recipientMobile, items, unloadingCharge } = req.body;
    const pdfBuffer = await renderQuotationPdf({ recipientName, recipientAddress, recipientMobile, items, unloadingCharge });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Aaral-Marketing-Quotation.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/quotations/send-whatsapp', async (req, res) => {
  try {
    const { recipientName, recipientAddress, recipientMobile, items, unloadingCharge } = req.body;
    if (!recipientMobile) return res.status(400).json({ ok: false, error: 'Mobile number is required to send via WhatsApp' });

    const pdfBuffer = await renderQuotationPdf({ recipientName, recipientAddress, recipientMobile, items, unloadingCharge });
    const message = `Please find attached our quotation dated ${formatDate()}${recipientName ? `, ${recipientName}` : ''}. Thank you for your inquiry!`;
    const result = await notifyWithPdf(recipientMobile, message, pdfBuffer, 'Aaral-Marketing-Quotation.pdf');
    if (!result.sent) return res.status(502).json({ ok: false, error: humanReason(result), recovering: result.recovering === true });

    await logActivity(req, 'sent quotation on WhatsApp', recipientName || recipientMobile);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
