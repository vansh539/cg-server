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

const STOPWORDS = new Set([
  'received', 'payment', 'paid', 'pay', 'from', 'today', 'yesterday', 'cash',
  'gpay', 'g', 'pay', 'upi', 'bank', 'transfer', 'rs', 'inr', 'rupees',
  'rupee', 'of', 'the', 'a', 'an', 'via', 'on', 'for', 'amount', 'balance',
  'ledger', 'got', 'payments', 'money', 'sent', 'and', 'with', 'him', 'her',
  'them', 'done', 'settled', 'tomorrow', 'morning', 'evening', 'neft',
  'imps', 'rtgs', 'phonepe', 'paytm',
]);

function extractNameCandidatePhrases(text) {
  const words = String(text || '')
    .replace(/[₹,]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(Boolean)
    .filter((w) => !/^\d+$/.test(w))
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));

  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    phrases.push(words[i]);
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  // Longest phrases first, so a two-word match is preferred over its
  // single-word substring resolving to the same or a different customer.
  return [...new Set(phrases)].sort((a, b) => b.length - a.length);
}

// Tries the most specific (most words) candidate phrases first -- e.g.
// "Shyam miyapur" before the bare "Shyam" it contains. As soon as any
// phrase at a given specificity level resolves to at least one customer,
// that level's matches are returned outright and shorter, vaguer phrases
// are never consulted -- otherwise a two-word phrase that uniquely
// resolves would still end up looking ambiguous just because its
// first-word substring also happens to match someone else.
async function resolveCustomerFromText(candidatePhrases, findByNameOrPhone) {
  const byWordCount = new Map();
  for (const phrase of candidatePhrases) {
    if (phrase.length < 2) continue;
    const wordCount = phrase.trim().split(/\s+/).length;
    if (!byWordCount.has(wordCount)) byWordCount.set(wordCount, []);
    byWordCount.get(wordCount).push(phrase);
  }

  const tiers = [...byWordCount.keys()].sort((a, b) => b - a);

  for (const wordCount of tiers) {
    const seen = new Map();
    for (const phrase of byWordCount.get(wordCount)) {
      const matches = await findByNameOrPhone(phrase);
      for (const customer of matches) seen.set(customer.id, customer);
    }
    if (seen.size > 0) return [...seen.values()];
  }
  return [];
}

function parsePaymentMessage(text, referenceDate = new Date()) {
  const raw = String(text || '');
  const dateInfo = extractDateInfo(raw, referenceDate);
  const masked = dateInfo.matchedText ? raw.replace(dateInfo.matchedText, ' ') : raw;
  return {
    amount: extractAmount(masked),
    date: dateInfo.iso,
    method: extractMethod(masked),
    candidatePhrases: extractNameCandidatePhrases(masked),
  };
}

module.exports = {
  extractAmount, extractDateInfo, extractMethod,
  extractNameCandidatePhrases, resolveCustomerFromText, parsePaymentMessage,
  toIsoDate,
};
