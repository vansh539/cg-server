// The one and only definition of what a chitti looks like.
//
// Before this existed there were TWO designs: the browser print view (yellow
// banner, black grid — matching the reference photo the client supplied) and
// pdf.js's own navy/cyan rounded card, which shared nothing with it. So the
// slip that printed and the PDF that got downloaded or sent on WhatsApp were
// visibly different documents. This module is consumed by:
//   - src/chittiTemplate.js  -> the PDF and JPEG renderers
//   - GET /chitti-print.css  -> chitti.html (print only) and invoice.html
// so all four outputs are rendered from the same rules and cannot drift.
//
// The WhatsApp ledger statement (src/ledgerTemplate.js) and the Iron & Steel
// chitti (src/steelChittiTemplate.js) are further consumers. Each carries
// different columns, so the shared look lives on `.slip` and each document
// adds only its own column widths via `.chitti` / `.ledger` / `.steel`.
// Adding a document means adding widths here -- never a second copy of the
// design.
//
// Two hard constraints, both learned the expensive way:
//
// 1. SYSTEM FONTS ONLY. Fetching a web font at Puppeteer render time made
//    output size swing between 200KB and 4MB depending on whether the fetch
//    landed before the PDF was captured.
// 2. Sizes are in `vw`, not px or pt. The shop prints on whatever free
//    notepad the cement companies handed out that week, so the paper size
//    genuinely changes; vw resolves against the page box, so the slip fills
//    the paper it is actually printed on instead of floating in a corner.
//
// Design is "Option B / Ledger", approved 24-Aug-2026: hairline inner rules
// inside a heavy outer frame, so the filled-in numbers dominate the page
// rather than the grid itself.

const CHITTI_CSS = `
.slip {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 2.5px solid #000;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums;
}
.chitti col.c-sl    { width: 6%; }
.chitti col.c-part  { width: 26%; }
.chitti col.c-grade { width: 12%; }
.chitti col.c-vch   { width: 11%; }
.chitti col.c-qty   { width: 11%; }
.chitti col.c-rate  { width: 12%; }
.chitti col.c-amt   { width: 22%; }

/* The statement's own columns. Date and Balance are the two the customer
   actually scans down, so they get the room. */
.ledger col.l-date   { width: 20%; }
.ledger col.l-type   { width: 15%; }
.ledger col.l-detail { width: 24%; }
.ledger col.l-amt    { width: 19%; }
.ledger col.l-bal    { width: 22%; }

/* Date and Type are fixed-shape values -- a wrapped "Payme/nt" or "05-08-/2026"
   reads as a rendering fault. Detail is the column allowed to wrap instead. */
.ledger td.l-nowrap, .ledger th.l-nowrap { white-space: nowrap; }

/* Per-item particulars/qty/rate breakdown under an invoice's own "Invoice #N"
   heading in the Detail cell -- smaller and muted so it reads as supporting
   detail, not a second heading. */
.ledger .item-line { display: block; font-size: 2.3vw; font-weight: 500; color: #333; margin-top: 0.6vw; }

/* The steel chitti's own columns -- Pcs and Qty(Kg) both matter here (unlike
   cement, which is sold by weight alone), so Particulars gives up room to
   them relative to the cement chitti's 26%. */
.steel col.s-sl    { width: 6%; }
.steel col.s-part  { width: 30%; }
.steel col.s-pcs   { width: 12%; }
.steel col.s-qty   { width: 14%; }
.steel col.s-rate  { width: 14%; }
.steel col.s-amt   { width: 24%; }

/* The charges block under the item rows (Loading, Kanta, Bending Charges,
   Advance, ...) -- one line per charge, right-aligned like the cement
   chitti's tfoot, but as body rows since the set of charges is variable per
   slip rather than one fixed subtotal/total pair. */
.steel .charge-row td { border-color: #9a9a9a; font-weight: 600; }
.steel .charge-row .lbl { text-align: right; color: #444; }

.slip th,
.slip td {
  border: 1px solid #7d7d7d;
  padding: 1.1vw 1.3vw;
  font-size: 3vw;
  color: #000;
  text-align: left;
  overflow-wrap: break-word;
}

/* The chitti (not the ledger statement, which reads better left-aligned)
   centers its data cells to the grid. */
.chitti th, .chitti td { text-align: center; }

/* The customer's name, baked into the table rather than floated above it so
   border-collapse gives it seamless shared edges with the grid. */
.slip .slip-banner {
  background: #ffe600;
  border: 1px solid #000;
  border-bottom: 2px solid #000;
  text-align: center;
  font-weight: 800;
  font-size: 5.4vw;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  padding: 2vw 1.4vw;
}

/* Date and destination share one band. The old layout had each on its own
   full-width row with a dead spacer row between them. */
.slip .slip-meta {
  border-color: #000;
  font-weight: 500;
  font-size: 2.9vw;
  padding: 1.3vw 1.4vw;
}
.slip .slip-meta .v { font-weight: 800; font-size: 3.1vw; float: right; }
/* Chitti's To/Date row centers label+value together instead of spreading
   them to opposite edges -- the ledger's Statement/Balance row keeps the
   float since that wasn't part of this ask. */
.chitti .slip-meta { text-align: center; }
.chitti .slip-meta .v { float: none; }

.slip thead th.col {
  background: #ebebeb;
  border-top: 1px solid #000;
  border-bottom: 1.5px solid #000;
  font-weight: 700;
  font-size: 2.2vw;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.slip th.n, .slip td.n { text-align: right; }
.chitti th.n, .chitti td.n { text-align: center; }
.slip tbody td { height: 4.6vw; font-weight: 600; border-color: #9a9a9a; }

/* A rule down the left of Amount so the eye lands on the money. */
.slip .amt { border-left: 1.5px solid #000; }

.slip tfoot td {
  font-weight: 800;
  font-size: 4vw;
  border-top: 2px solid #000;
  background: #f4f4f4;
}
.slip tfoot .total-label { text-align: right; letter-spacing: 0.03em; }
`;

// SLIP_CSS is the honest name now that two documents share it; CHITTI_CSS
// stays exported so existing consumers keep working.
module.exports = { CHITTI_CSS, SLIP_CSS: CHITTI_CSS };
