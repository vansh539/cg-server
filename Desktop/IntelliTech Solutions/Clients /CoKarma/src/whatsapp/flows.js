function handleRegistrationName(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length < 2) {
    return { ok: false, error: 'Please tell me your name (at least 2 characters).' };
  }
  return { ok: true, name: trimmed };
}

function handleAmountReply(text) {
  const cleaned = (text || '').trim().replace(/[₹,]/g, '');
  const amount = parseFloat(cleaned);
  if (Number.isNaN(amount) || amount <= 0) {
    return { ok: false, error: 'Please reply with a valid amount, e.g. 5000' };
  }
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

function handleProofReply(text, hasMedia) {
  if (hasMedia) {
    return { ok: true, proofType: 'screenshot', proofReference: null };
  }
  const trimmed = (text || '').trim();
  if (/^cash$/i.test(trimmed)) {
    return { ok: true, proofType: 'cash', proofReference: null };
  }
  if (/^[a-zA-Z0-9]{6,30}$/.test(trimmed)) {
    return { ok: true, proofType: 'utr_text', proofReference: trimmed.toUpperCase() };
  }
  return { ok: false, error: 'Please send a screenshot, type your UPI reference/UTR number, or reply CASH.' };
}

function parseAdminCommand(text) {
  const trimmed = (text || '').trim();
  let m;

  if ((m = trimmed.match(/^confirm\s+(\S+)$/i))) return { command: 'CONFIRM', claimId: m[1] };
  if ((m = trimmed.match(/^reject\s+(\S+)\s+(.+)$/i))) return { command: 'REJECT', claimId: m[1], reason: m[2].trim() };
  if ((m = trimmed.match(/^reject\s+(\S+)$/i))) return { command: 'REJECT', claimId: m[1], reason: null };
  if (/^pending links$/i.test(trimmed)) return { command: 'PENDING_LINKS' };
  if (/^pending$/i.test(trimmed)) return { command: 'PENDING' };
  if ((m = trimmed.match(/^balance\s+(.+)$/i))) return { command: 'BALANCE', query: m[1].trim() };
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT' };

  return { command: 'UNKNOWN' };
}

function toWhatsAppChatId(phoneNumber) {
  let digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return `${digits}@c.us`;
}

function extractAmountMatch(ocrText, claimedAmount) {
  const text = String(ocrText || '');
  const numPattern = '\\d[\\d,]*(?:\\.\\d{1,2})?';
  const toNumber = (s) => parseFloat(s.replace(/,/g, ''));
  const currencyMarker = '(?:₹|(?<![a-zA-Z])rs\\.?(?![a-zA-Z])|(?<![a-zA-Z])inr(?![a-zA-Z]))';

  const found = [];
  const prefixRe = new RegExp(`${currencyMarker}\\s*(${numPattern})`, 'gi');
  let m;
  while ((m = prefixRe.exec(text))) {
    found.push({ index: m.index, value: toNumber(m[1]) });
  }
  const suffixRe = new RegExp(`(${numPattern})\\s*${currencyMarker}`, 'gi');
  while ((m = suffixRe.exec(text))) {
    found.push({ index: m.index, value: toNumber(m[1]) });
  }

  // A number sitting completely alone on its own line is also treated as a
  // candidate. UPI apps typically show the payment amount by itself on its
  // own line; transaction IDs and dates almost always appear next to a
  // label ("UPI txn ID:", "Paid via") on the same line, so this stays
  // fairly safe. It also compensates for OCR frequently misreading the ₹
  // symbol (often as a stray digit fused to the number, e.g. "₹4,000" read
  // as "24,000"), which means no currency-marker match ever fires even
  // though the amount is right there in the text.
  const standaloneLineRe = new RegExp(`^\\s*(${numPattern})\\s*$`);
  const strippedNumRe = new RegExp(`^(${numPattern})$`);
  let offset = 0;
  for (const line of text.split('\n')) {
    const lm = line.match(standaloneLineRe);
    if (lm && lm[1].replace(/[.,]/g, '').length >= 3) {
      const matchIndex = offset + line.indexOf(lm[1]);
      found.push({ index: matchIndex, value: toNumber(lm[1]) });

      // Also try the same number with its first character stripped. The ₹
      // symbol consistently fuses onto the number as one extra leading
      // digit rather than being dropped or read as a separate token (e.g.
      // "₹4,000" read as "24,000") — confirmed against a real screenshot,
      // and unaffected by tessedit_char_whitelist tuning, so this is a
      // training-data-level OCR limitation, not something a config change
      // fixes. Without this, a correctly-reported payment would get
      // wrongly flagged as a mismatch purely because of the OCR glitch.
      // Only added when the remainder still looks like a real number
      // (starts with a digit), so a clean, uncorrupted reading like
      // "4,000" doesn't spawn a bogus extra candidate from ",000".
      const strippedRemainder = lm[1].slice(1);
      if (strippedNumRe.test(strippedRemainder)) {
        found.push({ index: matchIndex, value: toNumber(strippedRemainder) });
      }
    }
    offset += line.length + 1;
  }

  found.sort((a, b) => a.index - b.index);
  const candidates = found.map((f) => f.value);

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

function extractTxnId(ocrText) {
  const text = String(ocrText || '');
  const patterns = [
    /(?:upi\s*)?(?:txn|transaction)\s*id\b\s*[:.]?\s*(\d{6,20})/i,
    /(?:upi\s*)?ref(?:erence)?\b\.?\s*(?:no\.?|number)?\s*[:.]?\s*(\d{6,20})/i,
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

  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function isScreenshotDateStale(extractedDateIso, referenceIso, thresholdDays = 3) {
  return screenshotAgeDays(extractedDateIso, referenceIso) > thresholdDays;
}

function screenshotAgeDays(extractedDateIso, referenceIso) {
  if (!extractedDateIso) return -Infinity;
  const extracted = new Date(`${extractedDateIso}T00:00:00Z`);
  const reference = new Date(referenceIso);
  if (Number.isNaN(extracted.getTime()) || Number.isNaN(reference.getTime())) return -Infinity;

  return (reference.getTime() - extracted.getTime()) / (1000 * 60 * 60 * 24);
}

module.exports = {
  handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand,
  toWhatsAppChatId, extractAmountMatch, extractTxnId, extractPaymentDate,
  isScreenshotDateStale, screenshotAgeDays,
};
