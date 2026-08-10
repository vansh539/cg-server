# Narayani Steels — iPhone Mobile Billing Tool

**Date:** 2026-08-10
**Status:** Approved

## Purpose

Narayani Steels' main billing system (`app/` — Node/Express, stock, ledger-less invoicing, reports, balance sheet) lives on the shop PC. A partner (Shashank or Nishant) needs a lightweight way to generate a **Quotation** or a **Chitti (Invoice)** while on-site/in the field, away from the shop PC. This is a separate, minimal, standalone tool for exactly that — not a replacement for the shop system, and not synced with it in any way.

## Scope

**In scope — exactly 2 document types:**
- Quotation (3 formats: Basic / Including / Local)
- Chitti / Invoice, printed as a single A6 slip

**Explicitly out of scope** (deliberately not ported from the main tool):
- Stock module, stock-item autocomplete/linking, Deduct-from-Stock
- Ledger, customer selection, Old Balance / Advance, Finalize & Send
- Reports, Balance Sheet, Delivery Challan
- Any server, API, or persistence beyond the device-lock token (see below)

This is a **plain, self-contained billing tool** — closer in spirit to the original single-file invoicing tools this workspace started with, before the Node/stock wrapper existed.

## Architecture

A single self-contained `.html` file, no server, no build step, no dependencies beyond what's inlined in the file (matches the pre-Node-wrapper pattern already used for these clients).

- **File:** `Narayani Steels/mobile/index.html`
- **Delivery:** AirDropped or emailed once to the target iPhone, opened in Safari, then "Add to Home Screen." Home-screen behavior (full-screen, no address bar, custom icon) comes from meta tags baked directly into the HTML — `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and an `apple-touch-icon` link pointing at a base64-embedded Narayani logo. No separate `manifest.json` or service worker needed.
- **Updates:** since there's no server to hot-swap, any future change means re-sending the updated `index.html` and re-adding it to the Home Screen (or overwriting the file in Files app if AirDropped there). This is a known, accepted tradeoff of having zero backend.

## Device Lock

A web page cannot verify a specific physical iPhone from a static file with no backend — this is a **casual-copying deterrent**, not real DRM (same framing as the existing trial-lockout pattern used for other single-file client tools).

Flow:
1. **First launch:** the app shows a "Setup Code" screen instead of the menu.
2. User enters the setup code. If correct, the app generates a random token (`crypto.randomUUID()`) and stores it in that installation's `localStorage` under a fixed key, then proceeds straight to the menu.
3. **Every subsequent launch:** the app checks `localStorage` for the token. If present, it skips the Setup Code screen entirely and goes straight to the menu — no PIN re-entry on the bound device.
4. Any other device/browser (no token in its `localStorage`) is stuck at the Setup Code screen unless someone enters the correct code there too.

**Setup code:** `NARAYANI2026` (hardcoded in the file). This is a working default — change it before delivery if a different code is wanted; it's a single string constant near the top of the script, trivial to edit.

Wrong-code attempts show a plain "Incorrect code" message with no lockout/attempt-counting (this is a deterrent, not a security system — no need to over-engineer it).

## Quotation Section

Ported as-is from the current `final-invoice-NS.html` Quotation implementation:
- Doc-format picker: Basic / Including / Local (`#s9` equivalent)
- Item table: Particulars, WT/PC, Pcs, Qty(kg) auto-calculated, Rate (label flips Rate/Kg vs Rate/MT), Amount
- Format-specific charge/GST logic exactly as today: Basic (GST@18% on gross), Including (GST-inclusive rate, no GST line), Local (per-MT pricing, no GST)
- Loading (auto ₹400/1000kg), Kanta, Transport, Unloading charges
- Terms And Condition + Note (multi-line, wraps) + Bank Details (shown on all 3 formats)
- Customer Address + GSTIN fields
- A4 print template with the real Narayani Steels letterhead background image (same embedded PNG technique as the main tool)

No functional changes to this section's math or layout — it's a direct port, just stripped of anything that referenced stock or the app's other modules (there wasn't any; Quotation was always independent).

## Chitti (Invoice) Section

Fields ported from the current Chitti implementation, **minus** anything stock/ledger-linked:
- Customer details: Name, Address, Mobile No., Lorry No.
- Item table (Particulars free-text — no stock autocomplete/linking, no ⚠/🔗 badges)
- Charges: Loading, Kanta, Bending, Freight, Unloading, Others
- "Apply GST @ 18%" toggle (computed on subtotal + all charges, matching the current bugfixed behavior)
- Note (multi-line textarea, wraps in print)

**Print layout — swapped to single A6**, not Narayani's current A5 dual-tear-copy:
- Port Vansh Iron's `@page{size:105mm 148.5mm;margin:0!important}` print CSS and `buildFirstSlip()`/`buildContSlip()` structure from `final-invoice-VI.html` (single slip, no tear line, no second copy)
- Fixed-row padding behavior (blank rows to a consistent slip height) carried over from whichever source (VI or NS) already handles it cleanly for a single A6 slip
- Continuation slips (once item count exceeds VI's first-page row capacity, `mp1` in `final-invoice-VI.html`) print "M/s. \<name\> (contd.)" per VI's existing pattern, using the same `CONT_TOTAL` blank-row padding

No Old Balance / Advance / customer-select — those are ledger features already removed from the main tool org-wide (2026-08-05) and don't belong here regardless.

## Output / Share Flow

The two sections already use different print mechanisms in the source tool, and both are kept as-is (no need to unify them):

- **Chitti:** renders directly into `#print-area` on the main page and already has a "🖨 Print / Save PDF" button calling `window.print()` directly. No change needed — on iOS Safari this opens the native Print Preview immediately, and the Share icon there gives Save to Files / WhatsApp / Mail as PDF.
- **Quotation:** `qOpen()` opens the rendered `PAGE_TEMPLATE` in a new tab via `window.open(blobUrl,'_blank')`, with no built-in print trigger — today the user has to manually invoke print from there. This tool adds one small enhancement: the blob template's own script calls `window.print()` automatically once its background letterhead image has loaded, so the Print Preview (and from it, the Share-as-PDF option) appears immediately instead of requiring an extra manual step. If auto-print doesn't fire for any reason, the tab is still fully usable — the user can trigger print manually via Safari's own share/print UI, same as today.

No PDF-generation library needed either way.

## Menu

Home screen after unlock: 2 tiles only — **Quotation** and **Chitti (Invoice)**. No other tiles, no nav links to Stock/Reports/Balance Sheet/Ledger/Delivery Challan (those pages don't exist in this file at all).

## Testing / Verification

No unit-test framework applies to a single static HTML file (consistent with how the source Quotation/Chitti code has always been verified in this workspace). Verification is:
1. `node -c`-equivalent sanity (valid HTML/JS, no console errors) via a local static server + Claude-in-Chrome or headless Chrome.
2. Manually drive both doc types end-to-end (fill form → Generate → confirm print-tab renders correctly, correct math, correct branding) via headless Chrome screenshots, same technique used for prior Narayani print-layout changes.
3. Device-lock flow (wrong code rejected, correct code unlocks, `localStorage` token persists across a simulated "reopen," a cleared-`localStorage` session goes back to the Setup Code screen) — verified via `javascript_tool` manipulating `localStorage` directly.
4. **Real iPhone/Safari verification is out of my reach** (no physical device access) — Vansh should do a final on-device pass after delivery: Add to Home Screen, unlock, generate one Quotation and one Chitti, confirm the iOS Share-as-PDF flow actually surfaces correctly from the print preview.

## Out of Scope (explicit, for future reference)

- No offline service worker / true PWA caching — the file works offline once loaded since everything is inlined, but there's no explicit cache-first strategy. Not needed since nothing is fetched over network.
- No mechanism to sync anything generated here back into the shop PC's stock/ledger — by design, per the "no stock connectivity needed" requirement.
- No multi-user / multi-device support — this is intentionally single-device.
