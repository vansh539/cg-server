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
