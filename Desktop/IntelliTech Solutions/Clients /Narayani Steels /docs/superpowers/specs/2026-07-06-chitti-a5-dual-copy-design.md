# Invoice/Chitti: A6 → A5 dual-copy print

## Problem

The Invoice/Chitti tab in `final-invoice-NS.html` currently prints each slip on a physical A6 page (`@page{size:105mm 148.5mm}`). The client's printer at Narayani Steels cannot physically feed/print A6. It can print A5.

The client wants each printed sheet to be A5-sized, containing two identical copies of the same slip placed side by side, so the sheet can be torn down the middle after printing — one half kept as the customer copy, the other kept as the shop's copy.

## Scope

Only the print output of the Invoice/Chitti (Chitti) document type is affected. Out of scope:
- Quotation print output (separate template, separate `@page` rule, untouched)
- Delivery Challan print output (separate file, untouched)
- The on-screen editing form/UI
- Any calculation logic: GST, totals, Old Balance/Advance, row-padding math, labour auto-calc, etc.
- The multi-page continuation logic itself (`buildFirstSlip`/`buildContSlip`, `FIRST_TOTAL`/`CONT_TOTAL` row counts) — content generation per slip is unchanged, only how a finished slip is placed on the physical page changes.

## Design

### Page size

`@page{size:105mm 148.5mm;margin:0!important}` → `@page{size:210mm 148.5mm;margin:0!important}`.

210mm = 2 × 105mm (two A6 widths side by side). This is effectively A5 landscape. The client must set their printer/paper tray to A5.

### Per-page structure

Today, `generate()`'s assembly loop builds one `.print-slip` div per physical page:

```
prh += `<div class="print-slip"><div style="height:9mm"></div>${sh}</div>`;
```

where `sh` is the HTML returned by `buildFirstSlip()` or `buildContSlip()` for that page (already includes the 9mm top spacer inside the slip box).

This changes to wrap two copies of the same `sh` side by side inside the `.print-slip` container, with a divider between them:

```
prh += `<div class="print-slip">
  <div class="a5-half"><div style="height:9mm"></div>${sh}</div>
  <div class="a5-tear"></div>
  <div class="a5-half"><div style="height:9mm"></div>${sh}</div>
</div>`;
```

`sh` itself is not duplicated in code twice — it's the same string interpolated into both halves, so both halves are guaranteed byte-identical (no drift between "customer" and "shop" copy).

The page-break-after-each-page logic for multi-item invoices (`if(!il)prh+='<div class="page-break"></div>'`) is unchanged — it still fires once per logical page (i.e., once per A5 sheet now, not once per A6 half).

### CSS changes (print media block)

- `.print-slip`: `display:block; width:105mm; height:148.5mm` → `display:flex; width:210mm; height:148.5mm; align-items:stretch`.
- New `.a5-half`: `width:105mm; height:148.5mm; overflow:hidden` (carries the box each copy renders into).
- New `.a5-tear`: zero-width flex item with `border-left:1px dashed #000` spanning the full 148.5mm height — renders as the tear guide between the two halves. No scissors glyph, no "cut here" text.
- `.print-slip .doc, .print-slip .doc-cont` border override changes from `border:none!important` back to `border:1px solid #000!important` (was previously stripped for the single-copy A6 print; now restored so each half looks like a complete, self-contained slip once physically separated).

Font sizes, table layout, row heights, and all other `.doc`/`.d-tbl`/etc. rules inside each half are untouched — each half is pixel-for-pixel the same rendering as today's single A6 slip, just placed twice.

### UI status text

The on-screen line `✓ Ready · A6 · Margins: None · Scale: 100% · Backgrounds: ON` updates to say `A5 (2 copies)` instead of `A6`, so the operator knows what paper size to load. No other on-screen UI changes.

## Explicitly not doing

- No "Customer Copy" / "Office Copy" labels on either half — both are identical, unlabeled, per the client's own framing ("one can be customer copy and one will be mine").
- No scaling/shrinking of slip content to fit a different half-size — each half stays at the existing 105mm width/font sizes, unchanged.
- No changes to how many items fit per slip (`FIRST_TOTAL`/`CONT_TOTAL` stay at 19) — that's a content-density question, unrelated to physical page size.

## Testing plan

Verify via local `python3 -m http.server` + Claude-in-Chrome (file:// blocked by the extension, per existing project convention):
1. Generate a Chitti with a small number of items (single page) — confirm print preview shows one A5-sized page with two identical, bordered 105mm halves and a dashed center divider.
2. Generate a Chitti with enough items to force a continuation page (>19 items) — confirm each resulting page (first + continuation) independently gets the same two-up treatment, and page-break still produces one page-break per logical page, not per half.
3. Confirm on-screen status text now reads A5.
4. Print-to-PDF and visually inspect margins/divider alignment (headless Chrome `--print-to-pdf`, same pipeline used for prior letterhead/quotation verification in this project).
