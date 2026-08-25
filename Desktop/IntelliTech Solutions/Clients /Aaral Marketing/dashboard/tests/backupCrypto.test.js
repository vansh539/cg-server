const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptBuffer, decryptBuffer } = require('../src/backupCrypto');

test('encrypt then decrypt with the right passphrase returns the original bytes', () => {
  const plaintext = Buffer.from(JSON.stringify({ hello: 'world', n: 42 }), 'utf8');
  const encrypted = encryptBuffer(plaintext, 'correct horse battery staple');
  const decrypted = decryptBuffer(encrypted, 'correct horse battery staple');
  assert.deepEqual(decrypted, plaintext);
});

test('the wrong passphrase is rejected, not silently given garbage back', () => {
  const plaintext = Buffer.from('sensitive data', 'utf8');
  const encrypted = encryptBuffer(plaintext, 'the-real-passphrase');
  assert.throws(() => decryptBuffer(encrypted, 'a-guessed-passphrase'));
});

test('two backups with the same passphrase never produce identical ciphertext', () => {
  const plaintext = Buffer.from('same content every time', 'utf8');
  const a = encryptBuffer(plaintext, 'shared-passphrase');
  const b = encryptBuffer(plaintext, 'shared-passphrase');
  assert.notEqual(a.toString('hex'), b.toString('hex'), 'fresh salt+IV per backup must change the ciphertext');
  // But both must still decrypt correctly with that one shared passphrase.
  assert.deepEqual(decryptBuffer(a, 'shared-passphrase'), plaintext);
  assert.deepEqual(decryptBuffer(b, 'shared-passphrase'), plaintext);
});

test('a tampered backup file is rejected rather than silently decrypted wrong', () => {
  const plaintext = Buffer.from('do not modify this backup', 'utf8');
  const encrypted = encryptBuffer(plaintext, 'passphrase');
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 20] ^= 0xff; // flip a byte inside the ciphertext
  assert.throws(() => decryptBuffer(tampered, 'passphrase'));
});

test('an empty buffer round-trips too -- an empty export must not crash the pipeline', () => {
  const encrypted = encryptBuffer(Buffer.alloc(0), 'passphrase');
  const decrypted = decryptBuffer(encrypted, 'passphrase');
  assert.equal(decrypted.length, 0);
});

test('a too-short payload is rejected with a clear error, not a crash on negative-length slicing', () => {
  assert.throws(() => decryptBuffer(Buffer.from('too short'), 'passphrase'), /too short/);
});
