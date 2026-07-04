# OCR Transaction ID + Date Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing OCR amount check to also extract and report a screenshot's UPI transaction ID and payment date, flagging duplicate transaction IDs and stale dates to the admin.

**Architecture:** Two more pure, unit-tested extraction functions alongside `extractAmountMatch` in `src/whatsapp/flows.js`, a pure staleness-check function, a new duplicate-lookup in `src/ledger/claims.js` mirroring the existing UTR duplicate check, and `src/whatsapp/bot.js` wired to call all of this on the OCR text it already extracts (no second Tesseract call).

**Tech Stack:** Same as the existing OCR feature — `tesseract.js`, Node.js, PostgreSQL. No new dependencies.

## Global Constraints

- OCR findings here are informational/advisory only — never block claim creation, never auto-confirm/auto-reject.
- When nothing is found (no transaction ID, no date), behavior is silently identical to today — no reference line, no warning, nothing visible to the customer.
- `ocr_extracted_txn_id` and `ocr_extracted_date` are purely informational and must never be used in any balance/ledger calculation.
- Fully separate from any other project in this repo — only files under `Desktop/IntelliTech Solutions/Clients /CoKarma/` are touched.
- No hardcoded phone numbers anywhere in code.
- The project's test script is `node --test --test-concurrency=1` (run via `npm test`) — concurrency must stay forced to 1.

---

### Task 1: Migration for `ocr_extracted_txn_id` and `ocr_extracted_date`

**Files:**
- Create: `src/db/migrations/003_add_ocr_txn_id_and_date.sql`

**Interfaces:**
- Produces: `payment_claims.ocr_extracted_txn_id` (nullable `text`) and `payment_claims.ocr_extracted_date` (nullable `date`). Task 4's `createClaim` writes to both; no other task reads or writes them directly.

- [ ] **Step 1: Create the migration file**

```sql
ALTER TABLE payment_claims ADD COLUMN ocr_extracted_txn_id text;
ALTER TABLE payment_claims ADD COLUMN ocr_extracted_date date;
```

- [ ] **Step 2: Apply the migration to both databases**

Run:
```bash
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
```
Expected: `Applying migration: 003_add_ocr_txn_id_and_date.sql` then `Migrations complete.` for both.

- [ ] **Step 3: Verify both columns exist**

Run:
```bash
node -e "
require('dotenv').config({ path: '.env.test' });
const { pool } = require('./src/db/db');
pool.query(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payment_claims' AND column_name IN ('ocr_extracted_txn_id', 'ocr_extracted_date') ORDER BY column_name\")
  .then(r => { console.log(r.rows); pool.end(); });
"
```
Expected: two rows — `{ column_name: 'ocr_extracted_date', data_type: 'date' }` and `{ column_name: 'ocr_extracted_txn_id', data_type: 'text' }`.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/003_add_ocr_txn_id_and_date.sql
git commit -m "feat: add ocr_extracted_txn_id and ocr_extracted_date columns"
```

---

### Task 2: `extractTxnId` and `extractPaymentDate` pure functions

**Files:**
- Modify: `src/whatsapp/flows.js`
- Test: `tests/flows.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no I/O, no DB).
- Produces:
  - `extractTxnId(ocrText: string): string|null` — returns the first UPI transaction ID / reference number found via a common label pattern, or `null`.
  - `extractPaymentDate(ocrText: string): string|null` — returns an ISO `YYYY-MM-DD` string for a "DD Mon YYYY" style date found in the text, or `null`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/flows.test.js`:

```js
test('extractTxnId finds a UPI txn ID label', () => {
  assert.equal(flows.extractTxnId('UPI txn ID : 002926693520'), '002926693520');
});

test('extractTxnId finds a UPI Ref No label', () => {
  assert.equal(flows.extractTxnId('UPI Ref No: 123456789012'), '123456789012');
});

test('extractTxnId finds a bare Transaction ID label', () => {
  assert.equal(flows.extractTxnId('Transaction ID: 987654321098'), '987654321098');
});

test('extractTxnId returns null when no recognizable label is present', () => {
  assert.equal(flows.extractTxnId('Payment successful\nto PREETI AGARWAL'), null);
});

test('extractTxnId finds the ID in a full real screenshot OCR dump', () => {
  const ocrText = 'Paid securely on\nn\' navi =r\nGet up to @1,000 on every payment | @100 = 1\nPayment successful\nto PREETI AGARWAL\n& preetiagrwal1982@okhdfcbank\n4,000\nPaid via Navi UPI\n19 Jun 2026, 11:07 PM\nfrom Mr YAPRALA SHIVA SHANKAR\n% CITY UNION BANK LTD - 3743\nUPI txn ID : 002926693520';
  assert.equal(flows.extractTxnId(ocrText), '002926693520');
});

test('extractPaymentDate finds a DD Mon YYYY date with a time suffix', () => {
  assert.equal(flows.extractPaymentDate('19 Jun 2026, 11:07 PM'), '2026-06-19');
});

test('extractPaymentDate finds a full month name', () => {
  assert.equal(flows.extractPaymentDate('Payment successful\n15 December 2026'), '2026-12-15');
});

test('extractPaymentDate returns null when no date is present', () => {
  assert.equal(flows.extractPaymentDate('No date here at all'), null);
});

test('extractPaymentDate returns null for an unrecognizable month name', () => {
  assert.equal(flows.extractPaymentDate('19 Zzz 2026'), null);
});

test('extractPaymentDate finds the date in a full real screenshot OCR dump', () => {
  const ocrText = 'Paid securely on\nn\' navi =r\nGet up to @1,000 on every payment | @100 = 1\nPayment successful\nto PREETI AGARWAL\n& preetiagrwal1982@okhdfcbank\n4,000\nPaid via Navi UPI\n19 Jun 2026, 11:07 PM\nfrom Mr YAPRALA SHIVA SHANKAR\n% CITY UNION BANK LTD - 3743\nUPI txn ID : 002926693520';
  assert.equal(flows.extractPaymentDate(ocrText), '2026-06-19');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "flows.extractTxnId is not a function" (and similarly for `extractPaymentDate` once the first is added)

- [ ] **Step 3: Implement both functions in `src/whatsapp/flows.js`**

Add above the `module.exports` line:

```js
function extractTxnId(ocrText) {
  const text = String(ocrText || '');
  const patterns = [
    /(?:upi\s*)?(?:txn|transaction)\s*id\s*[:.]?\s*(\d{6,20})/i,
    /(?:upi\s*)?ref(?:erence)?\.?\s*(?:no\.?|number)?\s*[:.]?\s*(\d{6,20})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function extractPaymentDate(ocrText) {
  const text = String(ocrText || '');
  const m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!month || day < 1 || day > 31) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
```

Update the `module.exports` line to:

```js
module.exports = {
  handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand,
  toWhatsAppChatId, extractAmountMatch, extractTxnId, extractPaymentDate,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 10 new tests, plus every existing test in `tests/flows.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: add extractTxnId and extractPaymentDate pure functions"
```

---

### Task 3: `isScreenshotDateStale` pure function

**Files:**
- Modify: `src/whatsapp/flows.js`
- Test: `tests/flows.test.js`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `isScreenshotDateStale(extractedDateIso: string|null, referenceIso: string, thresholdDays?: number): boolean` — defaults `thresholdDays` to `3`. Returns `false` whenever `extractedDateIso` is falsy, either date fails to parse, or the gap is `thresholdDays` or less.

- [ ] **Step 1: Write the failing tests**

Add to `tests/flows.test.js`:

```js
test('isScreenshotDateStale returns false within the threshold', () => {
  assert.equal(flows.isScreenshotDateStale('2026-07-01', '2026-07-02T10:00:00Z'), false);
});

test('isScreenshotDateStale returns true past the threshold', () => {
  assert.equal(flows.isScreenshotDateStale('2026-06-01', '2026-07-04T10:00:00Z'), true);
});

test('isScreenshotDateStale returns false exactly at the threshold boundary', () => {
  assert.equal(flows.isScreenshotDateStale('2026-07-01', '2026-07-04T00:00:00Z'), false);
});

test('isScreenshotDateStale returns false when no date was extracted', () => {
  assert.equal(flows.isScreenshotDateStale(null, '2026-07-04T10:00:00Z'), false);
});

test('isScreenshotDateStale respects a custom threshold', () => {
  assert.equal(flows.isScreenshotDateStale('2026-07-01', '2026-07-03T10:00:00Z', 1), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "flows.isScreenshotDateStale is not a function"

- [ ] **Step 3: Implement `isScreenshotDateStale` in `src/whatsapp/flows.js`**

Add above the `module.exports` line:

```js
function isScreenshotDateStale(extractedDateIso, referenceIso, thresholdDays = 3) {
  if (!extractedDateIso) return false;
  const extracted = new Date(`${extractedDateIso}T00:00:00Z`);
  const reference = new Date(referenceIso);
  if (Number.isNaN(extracted.getTime()) || Number.isNaN(reference.getTime())) return false;

  const diffDays = (reference.getTime() - extracted.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > thresholdDays;
}
```

Update the `module.exports` line to:

```js
module.exports = {
  handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand,
  toWhatsAppChatId, extractAmountMatch, extractTxnId, extractPaymentDate, isScreenshotDateStale,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 5 new tests, plus every existing test)

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: add isScreenshotDateStale pure function"
```

---

### Task 4: `claims.findDuplicateTxnId` and extend `createClaim`

**Files:**
- Modify: `src/ledger/claims.js`
- Test: `tests/claims.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`; `payment_claims.ocr_extracted_txn_id`/`ocr_extracted_date` columns from Task 1.
- Produces:
  - `findDuplicateTxnId(txnId: string|null): Promise<Claim|null>` — mirrors `findDuplicateUtr`, but matches on `ocr_extracted_txn_id` with no `proof_type` restriction (a transaction ID can only ever come from a screenshot, so no type filter is needed).
  - `createClaim({..., ocrExtractedTxnId?, ocrExtractedDate? })` — both optional, stored on the two new columns.
  - `createClaim(...)`'s return shape gains a third field: `{ claim, duplicateOf, duplicateTxnIdOf }`. `duplicateTxnIdOf` is the result of `findDuplicateTxnId(ocrExtractedTxnId)`, computed only when `ocrExtractedTxnId` is truthy (otherwise `null`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/claims.test.js` (reuse the existing `makeCustomer` helper near the top of the file):

```js
test('findDuplicateTxnId returns null when no other claim has that transaction ID', async () => {
  const result = await claims.findDuplicateTxnId('002926693520');
  assert.equal(result, null);
});

test('findDuplicateTxnId finds a non-rejected claim with the same transaction ID', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 4000, proofType: 'screenshot', proofReference: 'shot.jpg',
    ocrExtractedTxnId: '002926693520',
  });

  const duplicate = await claims.findDuplicateTxnId('002926693520');
  assert.equal(duplicate.id, claim.id);
});

test('findDuplicateTxnId excludes rejected claims', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 4000, proofType: 'screenshot', proofReference: 'shot.jpg',
    ocrExtractedTxnId: '002926693520',
  });
  await claims.rejectClaim(claim.id, '9999900000', 'wrong amount');

  const duplicate = await claims.findDuplicateTxnId('002926693520');
  assert.equal(duplicate, null);
});

test('createClaim stores ocrExtractedTxnId and ocrExtractedDate when provided', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 4000, proofType: 'screenshot', proofReference: 'shot.jpg',
    ocrExtractedTxnId: '002926693520', ocrExtractedDate: '2026-06-19',
  });
  assert.equal(claim.ocr_extracted_txn_id, '002926693520');
  assert.equal(claim.ocr_extracted_date.toISOString().slice(0, 10), '2026-06-19');
});

test('createClaim leaves ocr_extracted_txn_id and ocr_extracted_date null when omitted', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 4000, proofType: 'cash', proofReference: null });
  assert.equal(claim.ocr_extracted_txn_id, null);
  assert.equal(claim.ocr_extracted_date, null);
});

test('createClaim returns duplicateTxnIdOf when the transaction ID was already claimed', async () => {
  const customer = await makeCustomer();
  await claims.createClaim({
    customerId: customer.id, amountClaimed: 4000, proofType: 'screenshot', proofReference: 'shot1.jpg',
    ocrExtractedTxnId: '002926693520',
  });

  const other = await makeCustomer('9111111111');
  const { duplicateTxnIdOf } = await claims.createClaim({
    customerId: other.id, amountClaimed: 4000, proofType: 'screenshot', proofReference: 'shot2.jpg',
    ocrExtractedTxnId: '002926693520',
  });

  assert.ok(duplicateTxnIdOf);
  assert.equal(duplicateTxnIdOf.ocr_extracted_txn_id, '002926693520');
});

test('createClaim returns duplicateTxnIdOf as null when no transaction ID was extracted', async () => {
  const customer = await makeCustomer();
  const { duplicateTxnIdOf } = await claims.createClaim({ customerId: customer.id, amountClaimed: 4000, proofType: 'cash', proofReference: null });
  assert.equal(duplicateTxnIdOf, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "claims.findDuplicateTxnId is not a function"

- [ ] **Step 3: Update `src/ledger/claims.js`**

Add this function after `findDuplicateUtr`:

```js
async function findDuplicateTxnId(txnId) {
  if (!txnId) return null;
  const { rows } = await query(
    `SELECT * FROM payment_claims WHERE ocr_extracted_txn_id = $1 AND status != 'rejected'`,
    [txnId]
  );
  return rows[0] || null;
}
```

Replace the existing `createClaim` function with:

```js
async function createClaim({ customerId, amountClaimed, proofType, proofReference, ocrExtractedAmount, ocrExtractedTxnId, ocrExtractedDate }) {
  const duplicate = proofType === 'utr_text' ? await findDuplicateUtr(proofReference) : null;
  const duplicateTxnId = ocrExtractedTxnId ? await findDuplicateTxnId(ocrExtractedTxnId) : null;

  const { rows } = await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, proof_reference, ocr_extracted_amount, ocr_extracted_txn_id, ocr_extracted_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [customerId, amountClaimed, proofType, proofReference || null, ocrExtractedAmount ?? null, ocrExtractedTxnId ?? null, ocrExtractedDate ?? null]
  );

  return { claim: rows[0], duplicateOf: duplicate, duplicateTxnIdOf: duplicateTxnId };
}
```

Update the `module.exports` block to:

```js
module.exports = {
  createClaim, findDuplicateUtr, findDuplicateTxnId, findClaimByIdPrefix,
  confirmClaim, rejectClaim, listPendingClaims, listStaleClaims,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 7 new tests, plus every existing test in `tests/claims.test.js` — the pre-existing `createClaim` tests all call it without `ocrExtractedTxnId`/`ocrExtractedDate`, which must keep working since both stay optional)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/claims.js tests/claims.test.js
git commit -m "feat: add transaction-ID duplicate detection to payment claims"
```

---

### Task 5: Wire transaction ID + date extraction into the screenshot flow

**Files:**
- Modify: `src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `flows.extractTxnId`, `flows.extractPaymentDate`, `flows.isScreenshotDateStale` (Task 2/3); `claims.createClaim`'s extended parameters and its new `duplicateTxnIdOf` return field (Task 4).
- Produces: nothing new for later tasks.

No automated test — this is I/O wiring around already-tested pure logic, matching the established convention for `bot.js`. Verified manually.

- [ ] **Step 1: Extend the screenshot OCR block in `handlePendingReply`**

In `src/whatsapp/bot.js`, find this exact block inside the `awaiting_proof` branch (it currently declares `ocrExtractedAmount`/`ocrWarning`, runs Tesseract once, and calls `flows.extractAmountMatch`):

```js
    let proofReference = result.proofReference;
    let screenshotPath = null;
    let ocrExtractedAmount = null;
    let ocrWarning = '';
    if (result.proofType === 'screenshot') {
      const media = await msg.downloadMedia();
      const mimeToExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = mimeToExt[media.mimetype] || 'jpg';
      const fileName = `${Date.now()}-${waNumber}.${ext}`;
      screenshotPath = path.join(PROOFS_DIR, fileName);
      fs.writeFileSync(screenshotPath, media.data, 'base64');
      proofReference = fileName;

      try {
        const { data: { text: ocrText } } = await Tesseract.recognize(screenshotPath, 'eng');
        const ocrResult = flows.extractAmountMatch(ocrText, pending.data.amount);
        ocrExtractedAmount = ocrResult.extractedAmount;
        if (ocrResult.matched === false) {
          ocrWarning = `\n⚠️ Typed ₹${pending.data.amount} but screenshot appears to show ₹${ocrResult.extractedAmount} — verify carefully.`;
        }
      } catch (e) {
        logger.warn('[WhatsApp] OCR failed, skipping amount check', { error: e.message });
      }
    }

    const { claim, duplicateOf } = await claims.createClaim({
      customerId: pending.data.customerId,
      amountClaimed: pending.data.amount,
      proofType: result.proofType,
      proofReference,
      ocrExtractedAmount,
    });
    clearPending(waNumber);

    const shortId = claim.id.slice(0, 8);
    await safeSend(msg, `Thanks! Your payment of ₹${pending.data.amount} has been recorded (claim #${shortId}) and is pending verification.`);

    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}${ocrWarning}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`,
      screenshotPath
    );
    return;
```

Replace it with:

```js
    let proofReference = result.proofReference;
    let screenshotPath = null;
    let ocrExtractedAmount = null;
    let ocrExtractedTxnId = null;
    let ocrExtractedDate = null;
    let ocrWarning = '';
    let ocrInfoLine = '';
    if (result.proofType === 'screenshot') {
      const media = await msg.downloadMedia();
      const mimeToExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = mimeToExt[media.mimetype] || 'jpg';
      const fileName = `${Date.now()}-${waNumber}.${ext}`;
      screenshotPath = path.join(PROOFS_DIR, fileName);
      fs.writeFileSync(screenshotPath, media.data, 'base64');
      proofReference = fileName;

      try {
        const { data: { text: ocrText } } = await Tesseract.recognize(screenshotPath, 'eng');
        const ocrResult = flows.extractAmountMatch(ocrText, pending.data.amount);
        ocrExtractedAmount = ocrResult.extractedAmount;
        if (ocrResult.matched === false) {
          ocrWarning += `\n⚠️ Typed ₹${pending.data.amount} but screenshot appears to show ₹${ocrResult.extractedAmount} — verify carefully.`;
        }

        ocrExtractedTxnId = flows.extractTxnId(ocrText);
        ocrExtractedDate = flows.extractPaymentDate(ocrText);

        const refParts = [];
        if (ocrExtractedTxnId) refParts.push(`UPI Ref: ${ocrExtractedTxnId}`);
        if (ocrExtractedDate) refParts.push(`Date: ${ocrExtractedDate}`);
        if (refParts.length > 0) {
          ocrInfoLine = `\n${refParts.join(', ')}`;
        }

        if (flows.isScreenshotDateStale(ocrExtractedDate, new Date().toISOString())) {
          ocrWarning += `\n⚠️ Screenshot date (${ocrExtractedDate}) is more than 3 days old — verify carefully.`;
        }
      } catch (e) {
        logger.warn('[WhatsApp] OCR failed, skipping amount check', { error: e.message });
      }
    }

    const { claim, duplicateOf, duplicateTxnIdOf } = await claims.createClaim({
      customerId: pending.data.customerId,
      amountClaimed: pending.data.amount,
      proofType: result.proofType,
      proofReference,
      ocrExtractedAmount,
      ocrExtractedTxnId,
      ocrExtractedDate,
    });
    clearPending(waNumber);

    const shortId = claim.id.slice(0, 8);
    await safeSend(msg, `Thanks! Your payment of ₹${pending.data.amount} has been recorded (claim #${shortId}) and is pending verification.`);

    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    const dupTxnNote = duplicateTxnIdOf ? `\n⚠️ Same UPI transaction ID already claimed on claim #${duplicateTxnIdOf.id.slice(0, 8)} (status: ${duplicateTxnIdOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}${dupTxnNote}${ocrInfoLine}${ocrWarning}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`,
      screenshotPath
    );
    return;
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (this task touches no test files, so this just confirms the change didn't break module loading)

- [ ] **Step 3: Manual verification**

With the bot running and connected:
1. Send a screenshot that has a clear UPI transaction ID and date (like the real one used as a test fixture in Task 2) → the admin notification should include a `UPI Ref: ..., Date: ...` line.
2. Send the exact same screenshot a second time (as a new claim) → the admin notification should now also include `⚠️ Same UPI transaction ID already claimed on claim #... (status: pending)`.
3. Send a screenshot with no recognizable transaction ID or date at all → no reference line, no crash, no delay message beyond the usual OCR processing time.
4. (Optional, harder to stage) A screenshot whose date is more than 3 days before today should produce the stale-date warning line.

- [ ] **Step 4: Commit**

```bash
git add src/whatsapp/bot.js
git commit -m "feat: extract and report UPI transaction ID and date from screenshots"
```

---

## Post-plan notes

- Date extraction only handles the "DD Mon YYYY" format seen across GPay/PhonePe/Paytm/Navi. If real screenshots turn up other formats (DD/MM/YYYY, "Jun 19, 2026", etc.) often enough to matter, extending `extractPaymentDate` with more patterns is a natural follow-up.
- The 3-day staleness threshold is a starting point, not a measured value — easy to change (it's a named parameter on `isScreenshotDateStale`) if it proves too strict or too loose once used on real submissions.
