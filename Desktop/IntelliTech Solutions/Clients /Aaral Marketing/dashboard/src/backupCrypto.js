// Passphrase-based encryption for the manual "Backup Now" feature. AES-256-GCM,
// same authenticated-cipher choice as the SMSA sibling project's backup system
// -- but keyed from a fixed passphrase (server config), not a random per-machine
// key file, per how this client's backup was scoped: one passphrase, reused for
// every backup, known to whoever needs to restore one.

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
// Node's own defaults for scryptSync (N=16384, r=8, p=1) -- fine for a
// manual, human-triggered operation with no throughput requirement.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEY_BYTES, SCRYPT_OPTIONS);
}

// Output layout: [16-byte salt][12-byte IV][ciphertext][16-byte GCM tag] --
// self-contained, so decrypting later needs nothing but the passphrase and
// this file. The salt is fresh per backup (not derived from the fixed
// passphrase alone) so two backups never reuse the same derived key+nonce
// pair, even though the passphrase itself is reused across all of them.
function encryptBuffer(plaintext, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, ciphertext, tag]);
}

function decryptBuffer(payload, passphrase) {
  if (payload.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('Backup file is too short to be valid');
  }
  const salt = payload.subarray(0, SALT_BYTES);
  const iv = payload.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = payload.subarray(SALT_BYTES + IV_BYTES, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // Wrong passphrase -> wrong key -> GCM auth tag check fails here and
  // throws, rather than silently returning garbage plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
