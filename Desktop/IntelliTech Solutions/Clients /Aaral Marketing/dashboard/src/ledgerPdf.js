// Renders the customer statement that gets sent on WhatsApp.
//
// The document itself is src/ledgerTemplate.js, which is built on the same
// `.slip` rules as the chitti. This file is only the Puppeteer wrapper: it
// used to also carry a full navy/cyan stylesheet of its own, which is exactly
// how the statement ended up looking nothing like the slip.

const puppeteer = require('puppeteer-core');
const { CHROME_EXECUTABLE } = require('./chromeExecutable');
const { buildLedgerHtml } = require('./ledgerTemplate');

const DEFAULT_PAPER_MM = { w: 210, h: 297 };

async function renderLedgerPdf({ customer, entries, paperWidthMm, paperHeightMm, asOf }) {
  const w = Number(paperWidthMm) || DEFAULT_PAPER_MM.w;
  const h = Number(paperHeightMm) || DEFAULT_PAPER_MM.h;
  const browser = await puppeteer.launch({ executablePath: CHROME_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    // 'load' rather than 'networkidle' -- the statement, like the slip, fetches
    // nothing, so there is no network to wait for.
    await page.setContent(buildLedgerHtml({ customer, entries, asOf }), { waitUntil: 'load' });
    return Buffer.from(await page.pdf({
      width: `${w}mm`,
      height: `${h}mm`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    }));
  } finally {
    await browser.close();
  }
}

module.exports = { renderLedgerPdf, DEFAULT_PAPER_MM };
