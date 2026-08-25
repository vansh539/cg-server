const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoiceFilename, contentDisposition } = require('../src/invoiceFilename');

test('customer name followed by invoice number', () => {
  assert.equal(buildInvoiceFilename({ customerName: 'Ramesh Kumar', invoiceNumber: 42 }), 'Ramesh-Kumar-42.pdf');
});

test('no customer name falls back to Invoice + number', () => {
  assert.equal(buildInvoiceFilename({ customerName: '', invoiceNumber: 42 }), 'Invoice-42.pdf');
  assert.equal(buildInvoiceFilename({ invoiceNumber: 42 }), 'Invoice-42.pdf');
  assert.equal(buildInvoiceFilename({ customerName: null, invoiceNumber: 42 }), 'Invoice-42.pdf');
});

test('a name that is only whitespace is treated as absent', () => {
  assert.equal(buildInvoiceFilename({ customerName: '   ', invoiceNumber: 7 }), 'Invoice-7.pdf');
});

test('walk-in slip with neither name nor number still gets a usable name', () => {
  // These are never persisted, so there is genuinely no invoice number.
  assert.equal(buildInvoiceFilename({}), 'Invoice.pdf');
  assert.equal(buildInvoiceFilename({ customerName: 'Ramesh' }), 'Ramesh.pdf');
});

test('strips characters Windows forbids in filenames', () => {
  // Real case: trade names are routinely written "M/s Something".
  assert.equal(buildInvoiceFilename({ customerName: 'M/s Sharma Traders', invoiceNumber: 9 }), 'M-s-Sharma-Traders-9.pdf');
  assert.equal(buildInvoiceFilename({ customerName: 'A:B*C?D"E<F>G|H', invoiceNumber: 1 }), 'A-B-C-D-E-F-G-H-1.pdf');
});

test('collapses runs of whitespace rather than leaving gaps', () => {
  assert.equal(buildInvoiceFilename({ customerName: 'Ramesh    Kumar', invoiceNumber: 3 }), 'Ramesh-Kumar-3.pdf');
});

test('does not leave a trailing separator before the extension', () => {
  assert.equal(buildInvoiceFilename({ customerName: 'Ramesh...', invoiceNumber: '' }), 'Ramesh.pdf');
  assert.equal(buildInvoiceFilename({ customerName: 'Ramesh -- ' }), 'Ramesh.pdf');
});

test('Windows reserved device names are not used as the base name', () => {
  // "CON.pdf" is genuinely unwritable on Windows.
  assert.equal(buildInvoiceFilename({ customerName: 'CON', invoiceNumber: 5 }), 'Invoice-5.pdf');
  assert.equal(buildInvoiceFilename({ customerName: 'nul', invoiceNumber: 5 }), 'Invoice-5.pdf');
});

test('very long names are truncated but stay valid', () => {
  const name = 'A'.repeat(300);
  const out = buildInvoiceFilename({ customerName: name, invoiceNumber: 1 });
  assert.ok(out.length <= 85, `too long: ${out.length}`);
  assert.ok(out.endsWith('.pdf'));
  assert.ok(!out.includes('-.pdf'), 'must not end with a dangling separator');
});

test('non-ASCII names survive via RFC 5987 filename*', () => {
  const filename = buildInvoiceFilename({ customerName: 'रमेश कुमार', invoiceNumber: 8 });
  const header = contentDisposition(filename);
  // Old browsers get a safe ASCII name...
  assert.match(header, /filename="[\x20-\x7E]+"/);
  // ...modern ones get the real thing.
  assert.match(header, /filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent(filename)));
});

test('a quote in the name cannot break out of the header', () => {
  const header = contentDisposition(buildInvoiceFilename({ customerName: 'He said "hi"', invoiceNumber: 2 }));
  const quoted = header.match(/filename="([^"]*)"/)[1];
  assert.ok(!quoted.includes('"'), 'ASCII fallback must contain no bare quotes');
});
