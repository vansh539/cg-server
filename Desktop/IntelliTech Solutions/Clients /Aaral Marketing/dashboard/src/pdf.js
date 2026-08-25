const puppeteer = require('puppeteer-core');
const { CHROME_EXECUTABLE } = require('./chromeExecutable');
const { buildChittiHtml } = require('./chittiTemplate');

const DEFAULT_PAPER_MM = { w: 210, h: 297 };
const MM_PER_INCH = 25.4;
const SCREENSHOT_DPI = 150; // sharp enough to print or read on a phone

function paperMm(paperWidthMm, paperHeightMm) {
  return {
    w: Number(paperWidthMm) || DEFAULT_PAPER_MM.w,
    h: Number(paperHeightMm) || DEFAULT_PAPER_MM.h,
  };
}

// Both renderers below drive the same page in the same browser, so a PDF and a
// JPEG of the same slip are guaranteed to be the same image.
async function withChittiPage({ invoice, items, customerName }, fn) {
  const browser = await puppeteer.launch({ executablePath: CHROME_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildChittiHtml({ invoice, items, customerName }), { waitUntil: 'load' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function renderInvoicePdf({ invoice, items, customerName, paperWidthMm, paperHeightMm }) {
  const { w, h } = paperMm(paperWidthMm, paperHeightMm);
  return withChittiPage({ invoice, items, customerName }, async (page) => (
    // page.pdf() returns a Uint8Array in this Puppeteer version, not a Buffer.
    // Express's res.send() silently JSON-serialises a Uint8Array byte by byte
    // instead of sending the bytes, which produced corrupt PDFs until this
    // Buffer.from() was added at the source.
    Buffer.from(await page.pdf({
      width: `${w}mm`,
      height: `${h}mm`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    }))
  ));
}

// Same slip as a JPEG, for staff who want to drop it straight into a chat or a
// gallery rather than deal with a PDF.
async function renderInvoiceImage({ invoice, items, customerName, paperWidthMm, paperHeightMm }) {
  const { w, h } = paperMm(paperWidthMm, paperHeightMm);
  // Set the viewport to the true paper size in CSS pixels so every `vw` in the
  // stylesheet resolves exactly as it does for the PDF; deviceScaleFactor then
  // multiplies that up to print resolution without changing the layout.
  const cssWidth = Math.round((w / MM_PER_INCH) * 96);
  const cssHeight = Math.round((h / MM_PER_INCH) * 96);
  return withChittiPage({ invoice, items, customerName }, async (page) => {
    await page.setViewport({
      width: cssWidth,
      height: cssHeight,
      deviceScaleFactor: SCREENSHOT_DPI / 96,
    });
    return Buffer.from(await page.screenshot({
      type: 'jpeg',
      quality: 92,
      // Crop to the slip itself rather than the full page box, so a short
      // chitti doesn't come out as a tall band of empty white.
      clip: await page.evaluate(() => {
        const el = document.querySelector('.chitti');
        const r = el.getBoundingClientRect();
        return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.bottom) };
      }),
    }));
  });
}

module.exports = { renderInvoicePdf, renderInvoiceImage };
