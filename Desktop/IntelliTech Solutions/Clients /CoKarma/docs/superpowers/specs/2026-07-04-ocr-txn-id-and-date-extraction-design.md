# OCR Transaction ID + Date Extraction — Design

## Problem

The OCR check currently only extracts and cross-checks the payment amount. The client wants more out of each screenshot: the UPI transaction ID and the payment date, both shown to the admin for reference, with the transaction ID also used to catch a reused/duplicate screenshot and the date used to flag a stale one.

## Approach

Extend the existing OCR pipeline (built in `docs/superpowers/specs/2026-07-03-ocr-check-and-customer-notifications-design.md`) with two more pure, tested extraction functions, following the exact same pattern as `extractAmountMatch`: informational by default, only ever adding a warning line for the admin, never blocking or delaying anything for the customer, and completely silent when nothing recognizable is found.

### Transaction ID extraction

UPI apps label the transaction ID differently (GPay: "UPI transaction ID", PhonePe/Paytm/Navi: "UPI Ref No", "Transaction ID", "Ref No."). `extractTxnId(ocrText)` tries a short list of common label patterns, each followed by a 6-20 digit number, and returns the first one found or `null`. This is purely a label-based lookup — no attempt to validate the number itself.

### Date extraction

`extractPaymentDate(ocrText)` looks for the "DD Mon YYYY" format used consistently across GPay/PhonePe/Paytm/Navi (e.g. "19 Jun 2026, 11:07 PM" — only the date portion is extracted, time is ignored since it doesn't matter for staleness). Returns an ISO `YYYY-MM-DD` string or `null`. Other date formats (DD/MM/YYYY, "Jun 19, 2026") are not attempted in this version — if this format doesn't cover enough real screenshots in practice, that's a follow-up, not blocking this one.

### Staleness check

`isScreenshotDateStale(extractedDateIso, referenceDateIso, thresholdDays = 3)` — pure function, returns `true` if the screenshot's date is more than `thresholdDays` before the reference time (when the claim was reported). Default threshold is 3 days: a payment reported same-day or next-day is normal; a screenshot dated a week or more before the report is a real signal worth a human glance, without being so tight that a slightly-delayed report (e.g. reported the next morning) triggers a false alarm.

### Duplicate transaction ID detection

A new `claims.findDuplicateTxnId(txnId)`, structurally identical to the existing `findDuplicateUtr` — checks other non-rejected claims for the same OCR-extracted transaction ID. Catches a reused screenshot (same payment claimed by two different people, or the same person claiming it twice).

## Data model

Two more nullable columns on `payment_claims`, same treatment as `ocr_extracted_amount` (informational only, never used in balance/ledger math):
```sql
ALTER TABLE payment_claims ADD COLUMN ocr_extracted_txn_id text;
ALTER TABLE payment_claims ADD COLUMN ocr_extracted_date date;
```

## Core flow (screenshot branch, extended)

After the existing amount OCR check runs:
1. `extractTxnId(ocrText)` and `extractPaymentDate(ocrText)` run against the same OCR text already extracted for the amount check (no second Tesseract call).
2. If a transaction ID was found: check `findDuplicateTxnId` against it.
3. If a date was found: check `isScreenshotDateStale` against it.
4. `claims.createClaim` is extended to accept and store `ocrExtractedTxnId`/`ocrExtractedDate`, and its duplicate check for transaction ID happens inside `createClaim` (same place the existing UTR duplicate check lives), returning a third field (`duplicateTxnIdOf`) alongside the existing `claim`/`duplicateOf`.
5. The admin notification gets:
   - An always-shown reference line when either was found: `UPI Ref: <txnId>` and/or `Date: <date>`.
   - A warning line if the transaction ID is a duplicate.
   - A warning line if the date is stale.
   - The existing amount-mismatch warning, unchanged.

## Error handling

- No transaction ID or date found → both stay `null`, no warning, no reference line, identical behavior to today.
- Any extraction function throwing is not expected (pure string parsing, no I/O) — if it somehow did, it would be caught by the same existing OCR try/catch that already wraps the whole extraction step in `bot.js`, degrading to "no OCR info at all" for that claim, same as an OCR failure today.

## Testing

- `extractTxnId` and `extractPaymentDate` get full unit test coverage in `tests/flows.test.js`: each label variant, no-match case, and the real screenshot's actual OCR text used as a regression fixture (same pattern as the existing amount-extraction tests).
- `isScreenshotDateStale` gets unit tests: within threshold, past threshold, exactly at threshold, `null` extracted date (never stale).
- `claims.findDuplicateTxnId` gets unit tests mirroring the existing `findDuplicateUtr` tests (duplicate found, no duplicate, rejected claims excluded).
- `claims.createClaim`'s extended parameters get tests confirming both new columns store correctly and stay `null` when omitted, and that `duplicateTxnIdOf` is populated correctly.
- The `bot.js` wiring itself has no automated test, consistent with the existing convention for that file.

## Out of scope

- Any date format beyond "DD Mon YYYY" (DD/MM/YYYY, YYYY-MM-DD, etc.) — add later if real screenshots need it.
- Any cross-check of the transaction ID against a real bank/UPI record (there is no such record available to this system) — it's purely a same-system duplicate check.
- Any automatic action (auto-reject, auto-block) based on a duplicate or stale-date finding — same human-in-the-loop principle as the rest of this system.
