# Capital Gains Automation — Setup Guide

Runs **entirely on your computer**. No internet required. No data ever leaves your machine.

---

## First Time Setup (do this once)

**Step 1 — Install Python**
Download from: https://www.python.org/downloads/
During installation, check **"Add Python to PATH"** before clicking Install Now.

**Step 2 — Run Install.bat**
Double-click `Install.bat` in this folder.
It installs all required packages automatically. Takes 2–5 minutes.

**Step 3 — Get your License**
Double-click `Start Capital Gains Tool.bat`.
It will show a **Machine ID** on screen — send this to your provider.
Your provider will send back a `license.lic` file.
Place `license.lic` in this folder (same folder as this README).

**Step 4 — Launch the tool**
Double-click `Start Capital Gains Tool.bat` again.
Your browser opens automatically with the tool ready to use.

---

## Using the Tool (every time)

1. Double-click **`Start Capital Gains Tool.bat`**
2. Browser opens — drag and drop broker/MF statements onto the page
3. Click **Process** — download the Excel output
4. When done for the day, double-click **`Stop Capital Gains Tool.bat`**

---

## Supported Formats

Works with PDFs and Excel files from:
CAMS, Zerodha, Upstox, Nirmal Bang, HDFC Securities, Motilal Oswal,
Anand Rathi, Mirae Asset, Purnartha, Axis Bank MF, Canara Robeco MF,
Franklin MF, SBI MF, Kuvera, and 20+ other brokers.

Unknown formats are automatically handled using built-in table extraction.

---

## If Something Goes Wrong

| Problem | Fix |
|---|---|
| Browser doesn't open | Open `capital_gains_portal.html` manually |
| "License error" on startup | Check `license.lic` is in this folder |
| File processes but 0 rows | See error report inside the portal |
| CID-encoded PDF (unreadable) | Open in Adobe Acrobat → Save As new PDF |
| Password-protected PDF | Rename file to `filename.PASSWORD.pdf` |

For any other issue, send the contents of `server_log.txt` (in this folder) to your provider.

---

## License

This software is licensed for use on this machine only.
License is valid for 1 year from activation date.
Contact your provider before expiry to renew.
