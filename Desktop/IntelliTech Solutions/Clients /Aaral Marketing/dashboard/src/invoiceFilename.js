// Builds the filename a slip/invoice PDF should be saved as.
//
// Previously every download came out as "Slip.pdf" (the stateless preview
// route) or "Invoice-<n>.pdf" (the reprint route) — so a folder of saved slips
// was Slip.pdf, Slip (1).pdf, Slip (2).pdf, with no way to tell whose was
// whose. The rule the client asked for: customer name then invoice number, or
// just "Invoice" and the number when it's a walk-in with no customer.

// Characters Windows forbids in a filename, plus control chars. A customer
// name is free text typed by staff, so it genuinely can contain '/' (e.g.
// "M/s Sharma Traders") — which would otherwise silently truncate the name or
// produce a broken download.
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

// Windows also refuses these as base names regardless of extension.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

const MAX_BASE_LENGTH = 80;

function sanitize(part) {
  return String(part == null ? '' : part)
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Hyphen-separated, matching the existing convention elsewhere in this
    // codebase (e.g. the ledger PDF's `Ledger-<name>.pdf`).
    .replace(/ /g, '-')
    // A trailing dot or hyphen is legal but looks like a mistake next to the
    // extension, and Windows strips trailing dots from filenames silently.
    .replace(/^[.\-]+|[.\-]+$/g, '');
}

/**
 * @param {{ customerName?: string, invoiceNumber?: string|number }} input
 * @returns {string} a safe filename WITHOUT the .pdf extension
 */
function buildInvoiceFilenameBase({ customerName, invoiceNumber } = {}) {
  const name = sanitize(customerName);
  const number = sanitize(invoiceNumber);

  // Walk-in slips are deliberately never persisted, so they have no invoice
  // number at all — don't produce a dangling "Ramesh-" with nothing after it.
  const parts = [];
  parts.push(name && !RESERVED.test(name) ? name : 'Invoice');
  if (number) parts.push(number);

  const base = parts.join('-').slice(0, MAX_BASE_LENGTH).replace(/[.\-]+$/g, '');
  return base || 'Invoice';
}

function buildInvoiceFilename(input) {
  return `${buildInvoiceFilenameBase(input)}.pdf`;
}

// RFC 5987/6266: a plain `filename="..."` is latin-1 only, so a name with any
// non-ASCII character (very likely here — Telugu/Hindi names, or a ₹) either
// mangles or gets dropped by the browser. Sending both forms means modern
// browsers take filename* and anything older still gets a usable ASCII name.
function contentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = { buildInvoiceFilename, buildInvoiceFilenameBase, contentDisposition, sanitize };
