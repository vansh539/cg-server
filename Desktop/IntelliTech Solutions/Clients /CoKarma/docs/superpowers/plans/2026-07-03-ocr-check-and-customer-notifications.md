# OCR Amount Check + Customer Confirmation Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OCR-based amount cross-check (customer-typed amount vs. what's visible in their screenshot proof, admin-facing warning only) and customer-facing confirm/reject notifications to the already-working CoKarma payment reconciliation bridge.

**Architecture:** One new nullable column on `payment_claims` for the OCR-read amount; one new pure, unit-tested function (`extractAmountMatch`) alongside the existing pure parsing functions in `src/whatsapp/flows.js`; a new `customers.findById` lookup; `claims.createClaim` extended to accept and store the OCR result; `src/whatsapp/bot.js` wired to run OCR on screenshots and to message customers when an admin confirms/rejects their claim. The human admin remains the final decision-maker — OCR only adds a warning line, never blocks or auto-rejects a claim.

**Tech Stack:** Adds `tesseract.js` (free, runs locally, no subscription) to the existing Node.js + PostgreSQL + `whatsapp-web.js` stack.

## Global Constraints

- No paid OCR API or subscription — `tesseract.js` only, consistent with why `whatsapp-web.js` was chosen over the Cloud API originally.
- OCR is a second signal for the admin, never a gate: it must never block claim creation, never auto-confirm, never auto-reject.
- When OCR finds no confident amount at all, behavior must be identical to today (no warning, no delay message, no error visible to the customer) — a customer must never be penalized for OCR's limitations.
- `ocr_extracted_amount` is purely informational and must never be used in any balance/ledger calculation (`customer_balances` and all existing `dues`/`amount_claimed`-based math are unchanged).
- Money values stay `numeric(12,2)`.
- Fully separate from any other project in this repo — only files under `Desktop/IntelliTech Solutions/Clients /CoKarma/` are touched.
- No hardcoded phone numbers anywhere in code.
- The project's test script is `node --test --test-concurrency=1` (run via `npm test`) — concurrency must stay forced to 1, since all test files share one real Postgres test database (`cokarma_bridge_test`) reset via `resetDb()`.

---

### Task 1: Migration for `ocr_extracted_amount`

**Files:**
- Create: `src/db/migrations/002_add_ocr_extracted_amount.sql`

**Interfaces:**
- Produces: `payment_claims.ocr_extracted_amount` (nullable `numeric(12,2)` column). Task 4's `createClaim` writes to it; no other task reads or writes it directly.

- [ ] **Step 1: Create the migration file**

```sql
ALTER TABLE payment_claims ADD COLUMN ocr_extracted_amount numeric(12,2);
```

- [ ] **Step 2: Apply the migration to both databases**

Run:
```bash
DB_NAME=cokarma_bridge npm run migrate
DB_NAME=cokarma_bridge_test npm run migrate
```
Expected: `Applying migration: 002_add_ocr_extracted_amount.sql` then `Migrations complete.` for both. The existing `scripts/migrate.js` requires no changes — it already discovers and applies any new `.sql` file in `src/db/migrations/` in filename order, tracking applied files in `schema_migrations`.

- [ ] **Step 3: Verify the column exists**

Run:
```bash
node -e "
require('dotenv').config({ path: '.env.test' });
const { pool } = require('./src/db/db');
pool.query(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payment_claims' AND column_name = 'ocr_extracted_amount'\")
  .then(r => { console.log(r.rows); pool.end(); });
"
```
Expected: `[ { column_name: 'ocr_extracted_amount', data_type: 'numeric' } ]`

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/002_add_ocr_extracted_amount.sql
git commit -m "feat: add ocr_extracted_amount column to payment_claims"
```

---

### Task 2: `extractAmountMatch` pure function

**Files:**
- Modify: `src/whatsapp/flows.js`
- Test: `tests/flows.test.js`

**Interfaces:**
- Consumes: nothing (pure function, no I/O, no DB — same convention as every other function in this file).
- Produces: `extractAmountMatch(ocrText: string, claimedAmount: number): { extractedAmount: number|null, matched: boolean|null }`
  - `matched: null` means no currency-adjacent number was found in the OCR text at all — the "skip" case.
  - `matched: true` means some candidate exactly equals `claimedAmount`.
  - `matched: false` means candidates were found but none equal `claimedAmount`; `extractedAmount` is the first candidate found, for use in the admin warning message.
  - **Only numbers adjacent to a currency marker (`₹`, `Rs`/`Rs.`, `INR`, case-insensitive) are ever treated as candidates.** Bare numbers with no currency marker (transaction IDs, dates, reference codes) are deliberately never used as candidates, even as a fallback — a screenshot showing only a transaction ID and a date must return `matched: null`, not misreport the transaction ID as an amount.

- [ ] **Step 1: Write the failing test**

Add to `tests/flows.test.js` (this file has no `require`s beyond `flows.js` itself — add these tests alongside the existing ones):

```js
test('extractAmountMatch finds a currency-prefixed amount that matches', () => {
  const result = flows.extractAmountMatch('Payment Successful\n₹5,000\nTo: CoKarma', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch finds a currency-prefixed amount that does not match', () => {
  const result = flows.extractAmountMatch('Paid Rs 4000 successfully', 5000);
  assert.equal(result.matched, false);
  assert.equal(result.extractedAmount, 4000);
});

test('extractAmountMatch handles a currency-suffixed amount', () => {
  const result = flows.extractAmountMatch('5000 INR received', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});

test('extractAmountMatch handles decimal amounts', () => {
  const result = flows.extractAmountMatch('INR 1,234.50 paid', 1234.5);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 1234.5);
});

test('extractAmountMatch ignores bare numbers with no currency marker', () => {
  const result = flows.extractAmountMatch('Transaction ID 240915001234 on 15/09/2026', 5000);
  assert.equal(result.matched, null);
  assert.equal(result.extractedAmount, null);
});

test('extractAmountMatch returns the skip case for empty OCR text', () => {
  const result = flows.extractAmountMatch('', 5000);
  assert.equal(result.matched, null);
  assert.equal(result.extractedAmount, null);
});

test('extractAmountMatch finds the matching candidate among multiple currency-adjacent numbers', () => {
  const result = flows.extractAmountMatch('Balance ₹9999 Amount Paid ₹5000', 5000);
  assert.equal(result.matched, true);
  assert.equal(result.extractedAmount, 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "flows.extractAmountMatch is not a function"

- [ ] **Step 3: Implement `extractAmountMatch` in `src/whatsapp/flows.js`**

Add this function above the `module.exports` line:

```js
function extractAmountMatch(ocrText, claimedAmount) {
  const text = String(ocrText || '');
  const numPattern = '\\d[\\d,]*(?:\\.\\d{1,2})?';
  const toNumber = (s) => parseFloat(s.replace(/,/g, ''));

  const candidates = [];
  const prefixRe = new RegExp(`(?:₹|rs\\.?|inr)\\s*(${numPattern})`, 'gi');
  let m;
  while ((m = prefixRe.exec(text))) {
    candidates.push(toNumber(m[1]));
  }
  const suffixRe = new RegExp(`(${numPattern})\\s*(?:₹|rs\\.?|inr)`, 'gi');
  while ((m = suffixRe.exec(text))) {
    candidates.push(toNumber(m[1]));
  }

  if (candidates.length === 0) {
    return { extractedAmount: null, matched: null };
  }

  const claimedRounded = Math.round(claimedAmount * 100) / 100;
  const match = candidates.find((c) => Math.round(c * 100) / 100 === claimedRounded);
  if (match !== undefined) {
    return { extractedAmount: match, matched: true };
  }

  return { extractedAmount: candidates[0], matched: false };
}
```

Update the `module.exports` line to:

```js
module.exports = { handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand, toWhatsAppChatId, extractAmountMatch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 7 new tests, plus every existing test in `tests/flows.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp/flows.js tests/flows.test.js
git commit -m "feat: add extractAmountMatch pure function for OCR amount comparison"
```

---

### Task 3: `customers.findById`

**Files:**
- Modify: `src/ledger/customers.js`
- Test: `tests/customers.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js` (already imported in this file).
- Produces: `findById(customerId: string): Promise<Customer|null>` — added to `module.exports`. Task 6 uses this to resolve a claim's `customer_id` back to a phone number.

- [ ] **Step 1: Write the failing test**

Add to `tests/customers.test.js`:

```js
test('findById returns the customer by id', async () => {
  const created = await customers.createCustomer({ name: 'Asha Rao', phoneNumber: '9848358160' });
  const found = await customers.findById(created.id);
  assert.equal(found.name, 'Asha Rao');
});

test('findById returns null for an unknown id', async () => {
  const found = await customers.findById('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "customers.findById is not a function"

- [ ] **Step 3: Implement `findById` in `src/ledger/customers.js`**

Add this function after `findByPhone`:

```js
async function findById(customerId) {
  const { rows } = await query(`SELECT * FROM customers WHERE id = $1`, [customerId]);
  return rows[0] || null;
}
```

Update the `module.exports` line to:

```js
module.exports = { normalizePhone, findByPhone, findById, createCustomer, findByNameOrPhone, linkMembershipId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both new tests, plus every existing test in `tests/customers.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/customers.js tests/customers.test.js
git commit -m "feat: add customers.findById lookup"
```

---

### Task 4: Extend `createClaim` to store the OCR result

**Files:**
- Modify: `src/ledger/claims.js`
- Test: `tests/claims.test.js`

**Interfaces:**
- Consumes: `query` from `src/db/db.js`; `payment_claims.ocr_extracted_amount` column from Task 1.
- Produces: `createClaim({ customerId, amountClaimed, proofType, proofReference, ocrExtractedAmount? })` — `ocrExtractedAmount` is optional; when omitted, the stored column is `null`. Return shape unchanged: `{ claim, duplicateOf }`, where `claim.ocr_extracted_amount` now reflects what was passed in.

- [ ] **Step 1: Write the failing test**

Add to `tests/claims.test.js` (this file already has a `makeCustomer` helper defined near the top — reuse it):

```js
test('createClaim stores ocrExtractedAmount when provided', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({
    customerId: customer.id, amountClaimed: 5000, proofType: 'screenshot', proofReference: 'shot.jpg', ocrExtractedAmount: 4000,
  });
  assert.equal(Number(claim.ocr_extracted_amount), 4000);
});

test('createClaim leaves ocr_extracted_amount null when omitted', async () => {
  const customer = await makeCustomer();
  const { claim } = await claims.createClaim({ customerId: customer.id, amountClaimed: 5000, proofType: 'cash', proofReference: null });
  assert.equal(claim.ocr_extracted_amount, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `createClaim stores ocrExtractedAmount when provided` fails because the column isn't populated (the current `INSERT` doesn't reference it, so `claim.ocr_extracted_amount` is `undefined`/`null` regardless of what's passed in — confirm the failure is specifically the assertion on `Number(claim.ocr_extracted_amount) === 4000`, not a crash).

- [ ] **Step 3: Update `createClaim` in `src/ledger/claims.js`**

Replace the existing `createClaim` function with:

```js
async function createClaim({ customerId, amountClaimed, proofType, proofReference, ocrExtractedAmount }) {
  const duplicate = proofType === 'utr_text' ? await findDuplicateUtr(proofReference) : null;

  const { rows } = await query(
    `INSERT INTO payment_claims (customer_id, amount_claimed, proof_type, proof_reference, ocr_extracted_amount)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [customerId, amountClaimed, proofType, proofReference || null, ocrExtractedAmount ?? null]
  );

  return { claim: rows[0], duplicateOf: duplicate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both new tests, plus every existing test in `tests/claims.test.js` — the earlier tests all call `createClaim` without `ocrExtractedAmount`, which must still work unchanged since it's optional)

- [ ] **Step 5: Commit**

```bash
git add src/ledger/claims.js tests/claims.test.js
git commit -m "feat: store OCR-extracted amount on payment claims"
```

---

### Task 5: Wire OCR check into the screenshot flow

**Files:**
- Modify: `package.json` (add `tesseract.js` dependency)
- Modify: `src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `flows.extractAmountMatch` (Task 2); `claims.createClaim`'s new `ocrExtractedAmount` parameter (Task 4); `Tesseract.recognize` from the new `tesseract.js` dependency.
- Produces: nothing new for later tasks — this is the OCR half of the screenshot flow, independent of Task 6's confirm/reject notifications.

This task has no automated test — running real OCR requires a live WhatsApp connection and an actual image, matching the established convention that `bot.js`'s I/O code (message sending, media downloads) has no unit tests, only the pure logic it calls into does (which Task 2 already covers). Verification here is manual, using the developer's own WhatsApp setup.

- [ ] **Step 1: Add the `tesseract.js` dependency**

In `package.json`, add to the `"dependencies"` object (keep alphabetical order with the existing entries):

```json
    "tesseract.js": "^5.1.0",
```

Run: `npm install`
Expected: `tesseract.js` and its sub-dependencies appear in `node_modules/` and `package-lock.json` is updated.

- [ ] **Step 2: Require `tesseract.js` in `bot.js`**

Add this line near the top of `src/whatsapp/bot.js`, alongside the other `require`s (after `const flows = require('./flows');`):

```js
const Tesseract = require('tesseract.js');
```

- [ ] **Step 3: Run OCR in the screenshot branch and pass the result through**

In `src/whatsapp/bot.js`, find the `awaiting_proof` branch inside `handlePendingReply` (it currently declares `let proofReference` and `let screenshotPath`, then has an `if (result.proofType === 'screenshot') { ... }` block that downloads the media and saves the file, followed by the `claims.createClaim(...)` call). Replace that whole section — from `let proofReference = result.proofReference;` through the `clearPending(waNumber);` line right after the `createClaim` call — with:

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
```

Then find the `notifyAdmins(...)` call right after (it builds a message string ending in `${dupNote}\n\nReply CONFIRM ...`). Insert `${ocrWarning}` into that template, right after `${dupNote}` and before the `\n\nReply CONFIRM` part:

```js
    const customer = await customers.findByPhone(waNumber);
    const dupNote = duplicateOf ? `\n⚠️ Same reference already claimed on claim #${duplicateOf.id.slice(0, 8)} (status: ${duplicateOf.status}).` : '';
    await notifyAdmins(
      `New payment claim #${shortId}\nFrom: ${customer.name} (${waNumber})\nAmount: ₹${claim.amount_claimed}\nProof: ${result.proofType}${proofReference ? ' - ' + proofReference : ''}${dupNote}${ocrWarning}\n\nReply CONFIRM ${shortId} or REJECT ${shortId} <reason>`,
      screenshotPath
    );
    return;
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (this task touches no test files, so this just confirms the new `require`/code didn't introduce a syntax error or break module loading)

- [ ] **Step 5: Manual verification**

With the bot running and connected (`npm start`, or reuse an already-connected session):
1. Send a screenshot showing a clearly different amount than what you typed (e.g. type `5000`, send a screenshot that says ₹4000) → the admin notification should include the `⚠️ Typed ₹5000 but screenshot appears to show ₹4000` line.
2. Send a screenshot showing the matching amount → no warning line appears.
3. Send a screenshot with no visible amount at all (a blank or unrelated image) → no warning line appears, no crash, no delay message to the customer beyond the normal few extra seconds OCR takes.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/whatsapp/bot.js
git commit -m "feat: run OCR amount check on screenshot proofs, warn admins on mismatch"
```

---

### Task 6: Customer confirmation/rejection messages

**Files:**
- Modify: `src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `customers.findById` (Task 3); `flows.toWhatsAppChatId` (already exists); `claims.confirmClaim`/`claims.rejectClaim`'s existing return value (the full claim row, including `customer_id`, `amount_claimed`, `review_note` — unchanged by this plan).
- Produces: nothing new for later tasks.

No automated test for this task either, for the same reason as Task 5 — it's WhatsApp message-sending I/O. Verified manually.

- [ ] **Step 1: Update the CONFIRM/REJECT branch in `handleAdminCommand`**

In `src/whatsapp/bot.js`, find the block inside `handleAdminCommand` that starts with `if (parsed.command === 'CONFIRM' || parsed.command === 'REJECT') {` and handles both commands after resolving `fullId`. Replace the inner `if (parsed.command === 'CONFIRM') { ... } else { ... }` section with:

```js
    if (parsed.command === 'CONFIRM') {
      const updated = await claims.confirmClaim(fullId, waNumber);
      if (updated) {
        await safeSend(msg, `Claim #${parsed.claimId} confirmed.`);
        const customer = await customers.findById(updated.customer_id);
        if (customer) {
          const chatId = flows.toWhatsAppChatId(customer.phone_number);
          try {
            await client.sendMessage(chatId, `✅ Your payment of ₹${updated.amount_claimed} has been confirmed. Thank you!`);
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify customer of confirmation', { customer: customer.phone_number, error: e.message });
          }
        }
      } else {
        await safeSend(msg, `Claim #${parsed.claimId} was already reviewed.`);
      }
    } else {
      const updated = await claims.rejectClaim(fullId, waNumber, parsed.reason);
      if (updated) {
        await safeSend(msg, `Claim #${parsed.claimId} rejected.`);
        const customer = await customers.findById(updated.customer_id);
        if (customer) {
          const chatId = flows.toWhatsAppChatId(customer.phone_number);
          const reasonNote = updated.review_note ? ` Reason: ${updated.review_note}` : '';
          try {
            await client.sendMessage(chatId, `❌ Your payment claim (₹${updated.amount_claimed}) was rejected.${reasonNote}`);
          } catch (e) {
            logger.error('[WhatsApp] Failed to notify customer of rejection', { customer: customer.phone_number, error: e.message });
          }
        }
      } else {
        await safeSend(msg, `Claim #${parsed.claimId} was already reviewed.`);
      }
    }
    return;
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Manual verification**

With the bot running and connected, using two allowlisted test numbers (one acting as the customer, one as admin — see `TEST_MODE_ALLOWED_NUMBERS` in `.env`):
1. Report a payment from the test customer number, then `CONFIRM` it from the admin number → the test customer's number should receive `✅ Your payment of ₹<amount> has been confirmed. Thank you!`.
2. Report another payment, then `REJECT <id> wrong amount` from the admin number → the test customer's number should receive `❌ Your payment claim (₹<amount>) was rejected. Reason: wrong amount`.
3. Try `CONFIRM`-ing the same claim ID again → admin gets "already reviewed", and the customer does **not** get a second confirmation message.

- [ ] **Step 4: Commit**

```bash
git add src/whatsapp/bot.js
git commit -m "feat: notify customers when their claim is confirmed or rejected"
```

---

## Post-plan notes

- If OCR proves unreliable enough in practice to be more noise than signal (e.g., frequent false mismatch warnings from misread digits), the next iteration would be image preprocessing (cropping to the likely amount region, contrast adjustment) before running Tesseract — explicitly out of scope here.
- `ocr_extracted_amount` is queryable later (e.g., via a `BALANCE`-style admin command extension) if the client wants to audit how often OCR and customer-typed amounts disagree, but no such command is built in this plan.
