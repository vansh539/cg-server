# OCR Amount Check + Customer Confirmation Messages — Design

## Problem

Two gaps surfaced during live testing of the payment reconciliation bridge:

1. A customer typed `5000` as the amount but the screenshot they attached actually showed `4000`. Nothing in the system flagged this — it relied entirely on the admin noticing during manual review. The client wants a second, automated check.
2. When an admin `CONFIRM`s or `REJECT`s a claim, only the admin gets a WhatsApp confirmation. The customer who reported the payment hears nothing back either way.

## Approach

### OCR amount check

Read the amount off the screenshot using OCR and compare it to what the customer typed, entirely as a **second signal for the admin**, not a replacement for manual verification (verification stays human-in-the-loop, per the original design). Use `tesseract.js` — free, runs locally, no subscription or per-call cost, consistent with why `whatsapp-web.js` was chosen over the paid Cloud API. Its language data downloads once and is cached locally afterward; only the very first OCR call needs internet access for that download (the bot already requires internet for WhatsApp itself, so this adds no new constraint).

Payment screenshots come from many different apps with wildly inconsistent layouts, so OCR will often fail to find a usable amount — that failure must never penalize the customer:

- OCR finds an amount that **matches** what was typed → no visible change, claim proceeds exactly as today.
- OCR finds an amount that **does not match** → the claim is still created as `pending` (never blocked), but the admin's WhatsApp notification gets an extra line: `⚠️ Typed ₹5000 but screenshot appears to show ₹4000 — verify carefully.`
- OCR finds **no** confident amount at all (the common case, given format diversity) → silently skip the check. Claim proceeds exactly as today, no warning, no OCR-related delay message to anyone.

The claimed amount (customer-typed) remains the single source of truth stored in `payment_claims.amount_claimed`; whatever OCR read is stored separately and only ever used as an admin-facing hint.

### Customer confirmation messages

When `confirmClaim`/`rejectClaim` succeeds, the bot now also messages the customer:
- Confirm: `✅ Your payment of ₹5000 has been confirmed. Thank you!`
- Reject: `❌ Your payment claim (₹5000) was rejected.` plus ` Reason: <reason>` if the admin gave one.

## Architecture

**New dependency:** `tesseract.js`.

**Data model:** one migration adding a nullable `ocr_extracted_amount numeric(12,2)` column to `payment_claims` — purely informational, never used in any balance/ledger calculation (those stay based on `amount_claimed` and `status`, unchanged).

**New pure, unit-tested logic** (`src/whatsapp/flows.js`, following the existing pure/impure split in this codebase — OCR itself is I/O and untested, matching how screenshot downloads are already untested; the *matching logic* is pure and tested):
```
extractAmountMatch(ocrText, claimedAmount) → { extractedAmount: number|null, matched: boolean|null }
```
- Scans `ocrText` for currency-like patterns (₹/Rs/INR followed by digits, with optional commas/decimals, or a bare number near one of those markers).
- If no candidate found: `{ extractedAmount: null, matched: null }` (the "skip" case).
- If a candidate found: `{ extractedAmount: <best candidate>, matched: <candidate === claimedAmount> }`.
- When multiple candidates are found, prefer the one adjacent to a currency symbol/keyword over a bare number, since screenshots often contain other numbers (dates, reference IDs, balances).

**Modified, still-impure code:**
- `src/ledger/claims.js`: `createClaim` accepts an optional `ocrExtractedAmount` field, stored on the new column. `confirmClaim`/`rejectClaim` already return the full claim row (customer_id, amount_claimed) — unchanged, just consumed differently by the caller now.
- `src/ledger/customers.js`: add `findById(customerId)` — needed to resolve a claim's `customer_id` back to a phone number when sending the confirm/reject message. (Every existing lookup goes through `findByPhone`/`findByNameOrPhone`; there was no by-id lookup yet.)
- `src/whatsapp/bot.js`:
  - In the `awaiting_proof` screenshot branch: after saving the file, run `Tesseract.recognize(filePath, 'eng')`, feed the resulting text into `flows.extractAmountMatch`, pass the result into `claims.createClaim`, and append the warning line to the existing admin notification text when `matched === false`. Wrapped in try/catch — any OCR failure (bad image, tesseract error) is treated identically to "no confident amount found," never surfaced to the customer, only logged.
  - In `handleAdminCommand`'s `CONFIRM`/`REJECT` branches: after a successful `confirmClaim`/`rejectClaim`, look up the customer via `customers.findById` and `safeSend` them the confirmation/rejection message using `flows.toWhatsAppChatId`.

## Data flow (screenshot path, updated)

1. Customer sends screenshot → bot downloads it, saves to `PROOFS_DIR` (unchanged).
2. Bot runs OCR on the saved file → gets raw text (new).
3. `flows.extractAmountMatch(ocrText, claimedAmount)` → decides match/mismatch/skip (new, pure, tested).
4. `claims.createClaim(...)` stores the claim including `ocrExtractedAmount` (extended).
5. Customer gets the existing "claim recorded, pending verification" message (unchanged) — this happens *after* OCR runs, so the customer's confirmation is delayed by however long OCR takes (typically a few seconds). Accepted tradeoff: simpler sequential flow, and this system is not real-time-critical.
6. Admin notification includes the mismatch warning line when applicable (extended).
7. Admin sends `CONFIRM <id>` or `REJECT <id> [reason]` → claim status updates (unchanged) → **new**: customer is messaged with the outcome.

## Error handling

- OCR throwing (corrupt file, tesseract internal error) → caught, logged, treated as "no confident amount" — claim creation and customer confirmation proceed unaffected.
- `extractAmountMatch` finding no candidates → `matched: null`, no warning line added, nothing stored beyond `null` in `ocr_extracted_amount`.
- Customer confirmation/rejection message failing to send (e.g., `sendMessage` throws) → caught and logged the same way `notifyAdmins` already handles per-recipient failures; does not fail the admin's `CONFIRM`/`REJECT` command itself.

## Testing

- `extractAmountMatch` gets full unit test coverage in `tests/flows.test.js`: matching amount, mismatched amount, no candidate found, multiple candidates (currency-adjacent number preferred over a bare one), common formatting variants (commas, decimals, ₹ vs Rs vs INR).
- `customers.findById` gets a unit test in `tests/customers.test.js` (found and not-found cases), following the exact pattern of the existing `findByPhone` tests.
- `claims.createClaim`'s new optional `ocrExtractedAmount` parameter gets a test confirming it's stored when provided and stays `null` when omitted.
- The actual Tesseract OCR call and the customer-notification `sendMessage` calls in `bot.js` are not unit tested, consistent with the rest of that file's untested, I/O-only convention.

## Out of scope

- Any change to how balances/dues are calculated — `ocr_extracted_amount` is purely informational.
- OCR for anything other than the screenshot proof type (UTR-text and cash claims have no image to read).
- Retrying or improving OCR accuracy beyond a single `tesseract.recognize` call (e.g., image preprocessing/cropping) — if OCR proves too unreliable in practice to be useful, that's a future iteration, not this one.
