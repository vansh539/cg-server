# PaddleOCR Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tesseract with a local PaddleOCR-based Python worker so the OCR check can actually read the ₹ symbol correctly, instead of relying on a "strip a phantom leading digit" heuristic.

**Architecture:** A self-contained Python/Flask service (`ocr-service/`) runs PaddleOCR and exposes it over localhost-only HTTP. The Node bot spawns this service as a child process at its own startup, waits for it to report ready, and talks to it per-screenshot instead of calling `Tesseract.recognize()`. Everything downstream of "we now have an OCR text string" (`src/whatsapp/flows.js`'s pure functions) is unchanged.

**Tech Stack:** Python 3.11, Flask, `paddleocr`/`paddlepaddle` (Python side); Node's built-in `fetch` and `child_process.spawn` (Node side, no new npm dependency).

## Global Constraints

- Full replacement of Tesseract, not a fallback pair — `tesseract.js` is removed from the project entirely once this plan is done.
- The Python worker binds to `127.0.0.1` only, on a configurable port (env var `OCR_SERVICE_PORT`, default `5001`) — never exposed externally.
- Node spawns the Python worker as a child process at its own startup and kills it on its own shutdown (`SIGINT`/`SIGTERM` handling already in `bot.js`, plus a `process.on('exit')` backstop) — one `npm start` brings up everything, no second terminal.
- Health-check polling: every 500ms for up to 30 seconds at startup. If it never becomes ready in that window, the bot logs a warning and continues running with OCR disabled for that session — this is not a fatal startup error.
- Every OCR call failure mode (worker never started, request times out, request errors, non-200 response) must be caught by the exact same try/catch that already wraps the OCR call in `bot.js`'s screenshot branch, degrading to "claim created with no OCR info at all" — never blocking claim creation.
- A 10-second client-side timeout on the `/ocr` HTTP call itself (separate from the 30-second startup health-check timeout), so a stuck OCR call can never hang message processing.
- `ocr-service/server.py` has no automated tests (established project convention for I/O/glue code wrapping a third-party engine against real images) — verified manually with real screenshots instead.
- No changes to `src/whatsapp/flows.js`, its tests, or the database schema.
- Python version must be 3.11 specifically — `paddlepaddle` has no published wheels for newer Python versions (confirmed: `pip install paddlepaddle` fails outright on Python 3.14 with "no matching distribution found").

---

### Task 1: Python OCR worker service

**Files:**
- Create: `ocr-service/requirements.txt`
- Create: `ocr-service/server.py`
- Create: `ocr-service/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from this project's existing code — a standalone Python service.
- Produces: an HTTP API other tasks depend on — `GET /health` → `200 {"status": "ready"}` once the server process is up and the model is loaded; `POST /ocr` with JSON body `{"imagePath": "<absolute path>"}` → `200 {"text": "line1\nline2\n..."}` on success, or a non-200 status with `{"error": "..."}` on failure (missing/invalid `imagePath`, file not found, or any PaddleOCR exception).

This task has no automated tests (see Global Constraints) — its own step 2 below is the verification, run directly against a real screenshot already sitting in this project's `proofs/` directory from prior testing.

- [ ] **Step 1: Create the Python virtual environment**

Python 3.11 is required (not the system default `python3`, which may be a newer version with no `paddlepaddle` wheels available). On this machine, Python 3.11 is available via Homebrew (`brew install python@3.11` if not already installed) at `/opt/homebrew/bin/python3.11`. On a different machine, install Python 3.11 first, then run:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/ocr-service"
python3.11 -m venv venv
```

(If `ocr-service/` doesn't exist yet, create it first: `mkdir -p "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/ocr-service"`.)

- [ ] **Step 2: Write `requirements.txt`**

```
flask==3.1.3
paddlepaddle==3.3.1
paddleocr==3.7.0
```

These are the exact versions already confirmed working in this session against a real payment screenshot — pin them exactly rather than using open-ended ranges, since PaddleOCR/PaddlePaddle compatibility across versions is not something to discover the hard way later.

- [ ] **Step 3: Install dependencies**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/ocr-service"
source venv/bin/activate
pip install -r requirements.txt
```

Expected: completes without error (this will download several hundred MB of PaddlePaddle/PaddleOCR packages and, on first run, PaddleOCR's own model weights — this can take a few minutes).

- [ ] **Step 4: Write `server.py`**

```python
import os
from flask import Flask, request, jsonify
from paddleocr import PaddleOCR

app = Flask(__name__)

# Loaded once, at process startup — not per-request. Model loading takes
# several seconds; doing it here means /health only starts responding
# once the model is actually usable (Flask can't accept connections
# until this line finishes), so the health-check polling on the Node
# side just needs to detect "the server responded at all" as proof of
# readiness, with no separate loading/ready state to track.
ocr = PaddleOCR(use_textline_orientation=False, lang='en')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ready'})


@app.route('/ocr', methods=['POST'])
def ocr_endpoint():
    data = request.get_json(silent=True) or {}
    image_path = data.get('imagePath')
    if not image_path:
        return jsonify({'error': 'imagePath is required'}), 400
    if not os.path.isfile(image_path):
        return jsonify({'error': f'file not found: {image_path}'}), 500
    try:
        result = ocr.predict(image_path)
        lines = []
        for res in result:
            lines.extend(res.get('rec_texts', []))
        return jsonify({'text': '\n'.join(lines)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('OCR_SERVICE_PORT', 5001))
    app.run(host='127.0.0.1', port=port)
```

Note: use `ocr.predict(image_path)` and read `res['rec_texts']` from each result item — this is the current, non-deprecated API. The older `ocr.ocr(image_path)` method is deprecated in this paddleocr version and returns a different, unusable structure for this purpose.

- [ ] **Step 5: Manually verify the server against a real screenshot**

Start the server (default port 5001):

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/ocr-service"
source venv/bin/activate
python server.py
```

Expected console output: no errors, and the process stays running (Flask's default startup banner appears).

In a second terminal, check health:

```bash
curl -s http://127.0.0.1:5001/health
```

Expected: `{"status":"ready"}`

Then run OCR against a real screenshot already in this project (adjust the filename if this exact one no longer exists — any `.jpg` under `proofs/` works):

```bash
curl -s -X POST http://127.0.0.1:5001/ocr \
  -H "Content-Type: application/json" \
  -d '{"imagePath": "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/proofs/1783153190836-918121007420.jpg"}'
```

Expected: a JSON response with a `text` field whose content includes a line with the correct ₹ amount from that screenshot (e.g. `₹3,500`, not a phantom-digit-prefixed number like `23,500`). Also confirm the failure path — call the endpoint with a nonexistent path:

```bash
curl -s -X POST http://127.0.0.1:5001/ocr \
  -H "Content-Type: application/json" \
  -d '{"imagePath": "/tmp/does-not-exist.jpg"}'
```

Expected: a 500 response with `{"error": "file not found: /tmp/does-not-exist.jpg"}`.

Stop the server (Ctrl+C in the first terminal) once both checks pass.

- [ ] **Step 6: Write `README.md`**

```markdown
# OCR Service

A local Python worker that runs PaddleOCR, used by the WhatsApp bot to read
payment amounts, UPI transaction IDs, and dates off screenshots. Runs as a
child process of the bot (`../src/whatsapp/bot.js` spawns and manages it) —
you don't normally start this by hand.

## One-time setup

Requires Python 3.11 specifically (`paddlepaddle` has no wheels for newer
Python versions as of this writing).

**macOS/Linux:**
```bash
cd ocr-service
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Windows:**
```bat
cd ocr-service
python3.11 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

After this, `npm start` in the project root will automatically start this
service alongside the WhatsApp bot.

## Manual testing (without the bot)

```bash
source venv/bin/activate   # or venv\Scripts\activate on Windows
python server.py
```

Then in another terminal:
```bash
curl http://127.0.0.1:5001/health
curl -X POST http://127.0.0.1:5001/ocr -H "Content-Type: application/json" \
  -d '{"imagePath": "/absolute/path/to/an/image.jpg"}'
```
```

- [ ] **Step 7: Update `.gitignore`**

Current contents of `/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/.gitignore`:

```
node_modules/
.env
.env.test
wa-sessions/
proofs/
logs/
*.log
.DS_Store
ruvector.db
.wwebjs_cache/
```

Add two lines at the end:

```
ocr-service/venv/
ocr-service/__pycache__/
```

- [ ] **Step 8: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add ocr-service/requirements.txt ocr-service/server.py ocr-service/README.md .gitignore
git commit -m "feat: add PaddleOCR Python worker service"
```

(Do not `git add` the `venv/` directory — it's gitignored per Step 7 and should not be committed.)

---

### Task 2: Node-side process lifecycle management

**Files:**
- Modify: `src/whatsapp/bot.js`

**Interfaces:**
- Consumes: `ocr-service/server.py` and its `venv/` (Task 1) — via the paths `OCR_VENV_PYTHON` and `OCR_SERVER_SCRIPT` this task defines.
- Produces: `OCR_SERVICE_URL` (string, e.g. `http://127.0.0.1:5001`), `startOcrService()`, `waitForOcrService()`, `stopOcrService()` — Task 3 calls `OCR_SERVICE_URL` when making the actual per-screenshot HTTP request.

This task has no automated tests (see Global Constraints) — `bot.js` is the untested I/O layer by established project convention. Its verification is Step 4 below and the full end-to-end manual check in Task 4.

- [ ] **Step 1: Add `spawn` to the existing `child_process` import**

In `src/whatsapp/bot.js`, line 6 currently reads:

```js
const { execSync } = require('child_process');
```

Change to:

```js
const { execSync, spawn } = require('child_process');
```

- [ ] **Step 2: Add the OCR service lifecycle section**

In `src/whatsapp/bot.js`, find these lines (currently lines 35-39):

```js
const TEST_MODE_ALLOWED_NUMBERS = (process.env.TEST_MODE_ALLOWED_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/\D/g, '').slice(-10))
  .filter(Boolean);
```

Immediately after that block (and before the `// ── Chrome Cleanup ──` comment that follows it), insert:

```js

// ── OCR Service (Python/PaddleOCR) ────────────────────────────
// A small local Python worker (ocr-service/) runs PaddleOCR, which reads
// the ₹ symbol correctly — Tesseract cannot (confirmed live: it always
// misreads ₹ as a phantom leading digit fused onto the amount, e.g.
// ₹3,500 → "23,500", regardless of character whitelisting, image
// upscaling, or Tesseract's own official "best" quality model). Node
// spawns this worker once at startup and talks to it over localhost
// HTTP; screenshots skip OCR entirely if it never comes up, same
// graceful-degradation philosophy as any other OCR failure.
const OCR_SERVICE_PORT = process.env.OCR_SERVICE_PORT || 5001;
const OCR_SERVICE_URL = `http://127.0.0.1:${OCR_SERVICE_PORT}`;
const OCR_SERVICE_DIR = path.join(__dirname, '..', '..', 'ocr-service');
const OCR_VENV_PYTHON = process.platform === 'win32'
  ? path.join(OCR_SERVICE_DIR, 'venv', 'Scripts', 'python.exe')
  : path.join(OCR_SERVICE_DIR, 'venv', 'bin', 'python');
const OCR_SERVER_SCRIPT = path.join(OCR_SERVICE_DIR, 'server.py');

let ocrServiceProcess = null;

function startOcrService() {
  if (!fs.existsSync(OCR_VENV_PYTHON)) {
    logger.warn('[OCR] venv not found, skipping OCR service startup — see ocr-service/README.md', { expected: OCR_VENV_PYTHON });
    return;
  }
  ocrServiceProcess = spawn(OCR_VENV_PYTHON, [OCR_SERVER_SCRIPT], {
    env: { ...process.env, OCR_SERVICE_PORT: String(OCR_SERVICE_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ocrServiceProcess.stdout.on('data', (d) => logger.info(`[OCR] ${d.toString().trim()}`));
  ocrServiceProcess.stderr.on('data', (d) => logger.warn(`[OCR] ${d.toString().trim()}`));
  ocrServiceProcess.on('exit', (code) => {
    logger.warn('[OCR] Python OCR service exited', { code });
    ocrServiceProcess = null;
  });
}

async function waitForOcrService(timeoutMs = 30000, intervalMs = 500) {
  if (!ocrServiceProcess) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OCR_SERVICE_URL}/health`);
      if (res.ok) {
        logger.info('[OCR] Python OCR service ready');
        return;
      }
    } catch (e) {
      // Not up yet — keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  logger.warn('[OCR] Python OCR service did not become ready in time — screenshots will skip OCR this session');
}

function stopOcrService() {
  if (ocrServiceProcess) {
    ocrServiceProcess.kill();
    ocrServiceProcess = null;
  }
}
```

- [ ] **Step 3: Wire startup and shutdown into the existing `require.main` blocks**

In `src/whatsapp/bot.js`, find this block (currently lines 71-76):

```js
if (require.main === module) {
  chromeCleanup();
  process.on('exit', chromeCleanup);
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
}
```

Replace it with:

```js
if (require.main === module) {
  chromeCleanup();
  startOcrService();
  process.on('exit', () => { chromeCleanup(); stopOcrService(); });
  process.on('SIGTERM', () => { logger.info('[WhatsApp] SIGTERM — clean exit'); process.exit(0); });
  process.on('SIGINT', () => { logger.info('[WhatsApp] SIGINT — clean exit'); process.exit(0); });
}
```

Then find this block, near the end of the file (currently lines 499-501):

```js
if (require.main === module) {
  client.initialize();
}
```

Replace it with:

```js
if (require.main === module) {
  waitForOcrService().then(() => client.initialize());
}
```

This starts the Python worker as early as possible (right alongside the existing Chrome cleanup, before the slower WhatsApp/Puppeteer startup even begins) so the two are warming up in parallel, then waits for the OCR worker to be ready immediately before bringing up the WhatsApp client.

- [ ] **Step 4: Manually verify the lifecycle in isolation**

This step only checks that the Node process can start/stop the Python worker correctly — it does not yet check the actual OCR call (that's Task 3). The lifecycle code only runs when `bot.js` is executed directly (`require.main === module`), so verify by starting the bot for real and watching the log output:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm run migrate
npm start
```

Expected log lines, in order, within the first ~30 seconds:
```
[OCR]  * Serving Flask app 'server'
[OCR]  * Running on http://127.0.0.1:5001
[OCR] Python OCR service ready
```
(Flask's own startup banner lines will appear prefixed with `[OCR]` since they're captured from the child process's stdout/stderr.)

Then stop the bot (Ctrl+C) and confirm no orphaned Python process is left running:

```bash
ps aux | grep "ocr-service/venv" | grep -v grep
```

Expected: no output (the process was killed cleanly).

- [ ] **Step 5: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/bot.js
git commit -m "feat: spawn and manage the PaddleOCR worker process lifecycle"
```

---

### Task 3: Replace the Tesseract call with the PaddleOCR HTTP call

**Files:**
- Modify: `src/whatsapp/bot.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `OCR_SERVICE_URL` (Task 2); `flows.extractAmountMatch`, `flows.extractTxnId`, `flows.extractPaymentDate`, `flows.isScreenshotDateStale` (all pre-existing, unchanged).
- Produces: nothing new for later tasks — this is the last code change.

This task has no automated tests (see Global Constraints). Its verification is Step 5 below and the full end-to-end manual check in Task 4.

- [ ] **Step 1: Remove the Tesseract import**

In `src/whatsapp/bot.js`, delete line 15:

```js
const Tesseract = require('tesseract.js');
```

- [ ] **Step 2: Replace the OCR call inside the screenshot branch**

In `src/whatsapp/bot.js`, find this exact block inside the `awaiting_proof` branch of `handlePendingReply` (currently lines 357-380):

```js
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
```

Replace it with:

```js
      try {
        const ocrResponse = await fetch(`${OCR_SERVICE_URL}/ocr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imagePath: path.resolve(screenshotPath) }),
          signal: AbortSignal.timeout(10000),
        });
        if (!ocrResponse.ok) {
          throw new Error(`OCR service returned ${ocrResponse.status}`);
        }
        const { text: ocrText } = await ocrResponse.json();
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
        logger.warn('[WhatsApp] OCR failed, skipping OCR checks', { error: e.message });
      }
```

(The only wording change outside the OCR call itself: the log message now says "skipping OCR checks" instead of "skipping amount check", since this catch block has covered more than just the amount check since the transaction-ID/date extraction work was added — the old wording predates that and was never updated.)

- [ ] **Step 3: Remove the `tesseract.js` dependency**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm uninstall tesseract.js
```

Expected: `package.json` no longer lists `tesseract.js` under `dependencies`, and `package-lock.json` is updated accordingly.

- [ ] **Step 4: Run the full Node test suite**

```bash
npm test
```

Expected: PASS, same test count as before this task (this task touches no test files — this only confirms removing `tesseract.js` and editing `bot.js` didn't break module loading or any pure-function test).

- [ ] **Step 5: Manually verify the OCR call end-to-end (without the full bot)**

With the OCR service running (from Task 1's Step 5, or start it again the same way), run:

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
node -e "
(async () => {
  const flows = require('./src/whatsapp/flows');
  const res = await fetch('http://127.0.0.1:5001/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: '/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma/proofs/1783153190836-918121007420.jpg' }),
  });
  const { text } = await res.json();
  console.log('OCR text:', text);
  console.log('Amount match (claimed 3500):', JSON.stringify(flows.extractAmountMatch(text, 3500)));
})();
"
```

Expected: `Amount match (claimed 3500)` shows `{"extractedAmount":3500,"matched":true}` — the real ₹ amount, matched directly, no phantom digit.

Stop the OCR service (Ctrl+C) once this passes.

- [ ] **Step 6: Commit**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
git add src/whatsapp/bot.js package.json package-lock.json
git commit -m "feat: replace Tesseract with PaddleOCR for screenshot OCR"
```

---

### Task 4: End-to-end manual verification with the live bot

**Files:** none (verification only)

**Interfaces:** none — this task exercises the fully wired system from Tasks 1-3.

- [ ] **Step 1: Start the full bot**

```bash
cd "/Users/vanshjalan/Desktop/IntelliTech Solutions/Clients /CoKarma"
npm start
```

Confirm the `[OCR] Python OCR service ready` log line appears (per Task 2, Step 4) before the WhatsApp QR/ready flow completes.

- [ ] **Step 2: Send a real payment screenshot with a ₹ amount from a test number**

Reply `PAID`, enter an amount, then send a screenshot whose visible amount matches what you typed. Confirm the admin notification does NOT show an amount-mismatch warning, and does show the `UPI Ref: ..., Date: ...` line if the screenshot has a recognizable transaction ID/date.

- [ ] **Step 3: Send a screenshot with a genuine mismatch**

Type a different amount than what the screenshot actually shows. Confirm the admin notification's mismatch warning names the *correct* amount from the screenshot (e.g. "screenshot appears to show ₹3,500"), not a phantom-digit-corrupted number — this is the specific bug this whole plan exists to fix.

- [ ] **Step 4: Confirm graceful degradation if the OCR service is down**

Stop the bot, manually delete or rename `ocr-service/venv` temporarily (or just don't run Task 1's setup on a fresh checkout), start the bot again, and confirm:
- The bot logs a warning (`venv not found, skipping OCR service startup`) but starts normally.
- Sending a screenshot still creates a claim successfully — just without any OCR info/warnings, no crash, no delay beyond normal message processing.

Restore `ocr-service/venv` (re-run Task 1 Step 1 and Step 3 if you deleted it) afterward.

- [ ] **Step 5: Report results**

No commit for this task — it's verification only. If any step fails, treat it as a bug in the relevant prior task and fix it there (with a new commit on top), not by adding workaround code in this task.
