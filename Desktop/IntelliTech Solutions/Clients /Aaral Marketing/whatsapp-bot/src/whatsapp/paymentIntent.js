// Parses a free-text staff message ("Received 15000 payment from Shyam
// miyapur today") into amount/date/method/customer-name-candidates. Pure
// functions only -- no DB, no I/O -- so bot.js is the only place that talks
// to Postgres or WhatsApp. Mirrors flows.js's existing pure/impure split.

function extractAmount(text) {
  const cleaned = String(text || '');

  const currencyMarked = cleaned.match(
    /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr|rupees?)/i
  );
  if (currencyMarked) {
    const raw = (currencyMarked[1] || currencyMarked[2]).replace(/,/g, '');
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }

  // No currency marker -- fall back to the largest bare number with at
  // least 3 digits. Payment amounts in this business are never single- or
  // double-digit, so this floor keeps stray small numbers (a customer's
  // door number, a quantity) out of consideration.
  const bareNumbers = cleaned.match(/\d[\d,]*(?:\.\d{1,2})?/g) || [];
  const candidates = bareNumbers
    .map((n) => parseFloat(n.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 100);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

const chrono = require('chrono-node');

function toIsoDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractDateInfo(text, referenceDate = new Date()) {
  const results = chrono.parse(String(text || ''), referenceDate, { forwardDate: false });
  if (results.length === 0) {
    return { iso: toIsoDate(referenceDate), matchedText: null };
  }
  const best = results[0];
  return { iso: toIsoDate(best.date()), matchedText: best.text };
}

const METHOD_KEYWORDS = [
  { method: 'gpay', pattern: /\b(g\s*pay|gpay|upi|phonepe|paytm)\b/i },
  { method: 'bank_transfer', pattern: /\b(bank\s*transfer|neft|imps|rtgs|bank)\b/i },
  { method: 'cash', pattern: /\bcash\b/i },
];

function extractMethod(text) {
  const cleaned = String(text || '');
  for (const { method, pattern } of METHOD_KEYWORDS) {
    if (pattern.test(cleaned)) return method;
  }
  return null;
}

module.exports = { extractAmount, extractDateInfo, extractMethod, toIsoDate };
