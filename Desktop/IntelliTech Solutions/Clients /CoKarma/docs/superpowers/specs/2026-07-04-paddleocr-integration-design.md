# PaddleOCR Integration — Design

## Problem

Tesseract (via `tesseract.js`), the OCR engine used since this system's first build, has been conclusively proven — through direct testing against a real payment screenshot, not assumption — structurally unable to recognize the ₹ (Indian Rupee, U+20B9) symbol. It always misreads it as a phantom leading digit fused onto the amount (e.g. ₹3,500 → "23,500"), regardless of character whitelisting, page-segmentation mode, image upscaling, or swapping in Tesseract's official higher-accuracy "best" model — all four were tried live and ruled out. The existing "strip a phantom leading digit" heuristic in `extractAmountMatch` works around this, but it's a guess: when a genuine mismatch also happens to look like it could be OCR corruption, the system can't tell which reading is real.

PaddleOCR, tested live against the same real screenshot, correctly read "₹3,500" — the actual symbol, the actual amount, no correction needed. This spec replaces Tesseract with PaddleOCR.

## Approach

**Full replacement, not a fallback pair.** PaddleOCR becomes the only OCR engine. `tesseract.js` is removed from the project entirely. No dual-engine cross-checking — PaddleOCR read the real screenshot correctly with no workaround, so there's no demonstrated need for the complexity of running two engines and reconciling disagreements.

**A self-contained Python worker, isolated under this project.** PaddleOCR is a Python package (`paddleocr` + `paddlepaddle`) with no Node.js equivalent. It lives entirely under a new `ocr-service/` subdirectory inside this project:

```
ocr-service/
  venv/                  (gitignored — created by setup, not committed)
  requirements.txt       (pinned: paddlepaddle, paddleocr, flask)
  server.py              (the Flask app)
```

Nothing here touches any other Python installation, virtualenv, or project on the machine — the venv is created inside `ocr-service/venv/` and only ever activated from there. This follows the same isolation principle applied throughout this whole project.

**Python version: 3.11, not the system default.** `paddlepaddle` has no published wheels for Python 3.14 (confirmed live — `pip install paddlepaddle` fails outright on 3.14 with "no matching distribution"). The setup step explicitly uses `python3.11` (available via Homebrew: `brew install python@3.11` if not already present) to create the venv, not whatever `python3` resolves to on a given machine.

**Communication: localhost-only HTTP.** `server.py` runs a small Flask app bound to `127.0.0.1` on a fixed port (`5001`, configurable via `OCR_SERVICE_PORT` env var to avoid clashing with anything else already running on a given machine). Two endpoints:
- `GET /health` — returns `{"status": "ready"}` once the PaddleOCR model has finished loading (model init takes several seconds; the bot must wait for this before accepting screenshots, so it doesn't get a connection-refused error on the very first claim after startup).
- `POST /ocr` — body `{"imagePath": "<absolute path>"}`, returns `{"text": "line1\nline2\n..."}` (PaddleOCR's detected text lines joined with `\n`, matching the shape of Tesseract's `data.text` output so nothing downstream needs to change) or a 500 with an error message on failure.

**Process lifecycle: Node owns it.** `bot.js` spawns `ocr-service/venv/bin/python server.py` as a child process during its own startup (alongside the existing WhatsApp client init), polls `/health` every 500ms for up to 30 seconds (model loading is slower on the very first run, when PaddleOCR downloads its model files, than on subsequent warm-cache runs). If it never becomes ready within that window, the bot logs a warning and starts anyway — screenshot claims just skip OCR entirely from then on, same graceful-degradation philosophy as any other OCR failure, not a fatal startup error. On the bot's own shutdown (`SIGINT`/`SIGTERM` handlers, plus `process.on('exit')` as a backstop), it kills the child process. One `npm start` still brings up the whole system — no second terminal, no separate command to remember, matching how this bot has always been run.

**Error handling — no change in philosophy.** The existing try/catch around the OCR call in the screenshot branch of `handlePendingReply` stays exactly where it is; only what's inside it changes (an HTTP call instead of a `Tesseract.recognize()` call). Every existing failure mode — worker never started, request times out, request errors, `/ocr` returns non-200 — is caught by the same catch block and logged the same way, degrading to "claim created with no OCR info at all," never blocking the claim.

**No changes needed to `src/whatsapp/flows.js`.** `extractAmountMatch`, `extractTxnId`, `extractPaymentDate`, and `isScreenshotDateStale` all operate on a plain text string; they don't know or care which OCR engine produced it. Once PaddleOCR correctly reads `₹3,500` as one token, the existing currency-marker-adjacent match in `extractAmountMatch` finds it directly — the "strip a phantom leading digit" heuristic simply stops being exercised in the common case (it stays in the code as a harmless fallback, not removed, since PaddleOCR could still occasionally misread a symbol on some other screenshot format not yet seen).

## Data flow (screenshot branch, replacing the current Tesseract call)

1. Customer sends a screenshot; `bot.js` saves it to `proofs/` as it does today.
2. `bot.js` calls the local OCR worker: `POST http://127.0.0.1:5001/ocr` with the saved file's path.
3. On success, the returned `text` string is passed to the exact same `flows.extractAmountMatch`, `flows.extractTxnId`, `flows.extractPaymentDate` calls that exist today — completely unchanged.
4. On any failure (worker down, timeout, non-200, network error), the catch block logs a warning and all three `ocrExtracted*` variables stay `null`, same as today's Tesseract-failure path.

## Setup

A `README.md` inside `ocr-service/` documents the one-time setup:
```bash
cd ocr-service
python3.11 -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```
This also naturally documents the exact commands needed later when this whole system is packaged for the client's server (a separate, not-yet-started effort) — whatever OS that turns out to be, `python3.11 -m venv` + `pip install -r requirements.txt` is the same two commands.

## Error handling

- Python worker fails to start (missing venv, missing Python 3.11, port already in use): the bot logs an error and continues running — WhatsApp messaging, ledger, and all non-OCR functionality work exactly as before. Screenshot claims are created but skip OCR entirely (same as an OCR failure today).
- Python worker crashes mid-session: the next `/ocr` request fails (connection refused), caught by the existing try/catch, degrading that one claim to no-OCR. The bot does not attempt to auto-restart the worker in this version — restarting the whole bot process (which is how you already operate this system) brings it back. Auto-restart logic is a candidate follow-up if crashes turn out to be a real problem in practice, not a speculative one to build now.
- `/ocr` request takes too long (model somehow hangs): a client-side timeout (10 seconds) on the HTTP call ensures a stuck OCR call can never hang the bot's message processing.

## Testing

- `server.py` has no automated tests — it's a thin I/O wrapper around a third-party library, calling a real model on a real image, matching this project's established convention that OCR/I/O glue code (the existing `bot.js` Tesseract call was never unit tested either) is verified manually with real screenshots rather than mocked.
- No changes to any existing test file — `flows.js`'s pure functions are already fully covered against real screenshot OCR text as fixtures, and that coverage remains valid regardless of which engine produced the text.
- Manual verification (post-implementation): send a real payment screenshot with a ₹ amount, confirm the admin notification shows the correct amount with no phantom-digit warning; stop the Python worker process manually and send another screenshot, confirm the claim still gets created with no OCR info and no crash.

## Out of scope

- Auto-restarting the Python worker if it crashes mid-session (see Error handling above).
- Packaging/bundling the Python venv for client handoff (a separate, not-yet-started deployment effort) — this spec only ensures the setup steps are simple and OS-agnostic enough not to complicate that future work.
- Removing the "strip a phantom leading digit" heuristic from `extractAmountMatch` — it stays as an inert fallback, not dead code to delete, since it costs nothing to keep and could still help if PaddleOCR ever misreads a different symbol on a screenshot format not yet seen.
- Any change to how UPI transaction ID or date extraction work beyond the swap in what text they receive as input.
