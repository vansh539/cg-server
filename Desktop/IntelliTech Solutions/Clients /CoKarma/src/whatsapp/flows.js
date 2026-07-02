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

module.exports = { handleRegistrationName, handleAmountReply, handleProofReply, parseAdminCommand, toWhatsAppChatId };
