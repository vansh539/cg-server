function parseAdminCommand(text) {
  const trimmed = (text || '').trim();
  let m;

  if ((m = trimmed.match(/^balance\s+(.+)$/i))) return { command: 'BALANCE', query: m[1].trim() };
  if ((m = trimmed.match(/^ledger\s+(.+)$/i))) return { command: 'LEDGER', query: m[1].trim() };
  if (/^import\s+force$/i.test(trimmed)) return { command: 'IMPORT', force: true };
  if (/^import$/i.test(trimmed)) return { command: 'IMPORT', force: false };

  return { command: 'UNKNOWN' };
}

function toWhatsAppChatId(phoneNumber) {
  let digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return `${digits}@c.us`;
}

function formatBalanceLine(balance) {
  if (Number(balance) <= 0) return "You're all settled up!";
  return `Remaining balance: ₹${balance}`;
}

module.exports = { parseAdminCommand, toWhatsAppChatId, formatBalanceLine };
