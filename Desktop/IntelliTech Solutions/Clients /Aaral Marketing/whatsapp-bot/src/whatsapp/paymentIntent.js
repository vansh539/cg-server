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

module.exports = { extractAmount };
