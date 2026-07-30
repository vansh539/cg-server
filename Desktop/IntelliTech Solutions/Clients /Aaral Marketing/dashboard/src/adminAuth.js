'use strict';
const crypto = require('crypto');

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function verifyPin(suppliedPin) {
  const expectedHash = process.env.ADMIN_PIN_HASH;
  if (!expectedHash || !suppliedPin) return false;
  const suppliedHash = hashPin(suppliedPin);
  const a = Buffer.from(suppliedHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requirePin(req, res, next) {
  if (!verifyPin(req.body && req.body.pin)) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  next();
}

module.exports = { hashPin, verifyPin, requirePin };
