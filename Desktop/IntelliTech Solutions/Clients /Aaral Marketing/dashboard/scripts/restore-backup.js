// Decrypts a .enc file produced by "Backup Now" back to the plain JSON
// snapshot. Does NOT write anything into Postgres -- restoring data into a
// live database risks ID collisions and foreign-key ordering issues that
// deserve a human's judgment, not a script's. This gets you the readable
// data back; loading specific rows back in is a manual, deliberate step.
//
// Usage: node scripts/restore-backup.js <path-to-backup.enc> [output.json]

const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const { decryptBuffer } = require('../src/backupCrypto');

function promptPassphrase() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Backup passphrase: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [, , inputPath, outputPathArg] = process.argv;
  if (!inputPath) {
    console.error('Usage: node scripts/restore-backup.js <path-to-backup.enc> [output.json]');
    process.exit(1);
  }
  const outputPath = outputPathArg || inputPath.replace(/\.enc$/, '') + '.decrypted.json';

  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE || (await promptPassphrase());
  const encrypted = fs.readFileSync(inputPath);

  let json;
  try {
    const gz = decryptBuffer(encrypted, passphrase);
    json = zlib.gunzipSync(gz).toString('utf8');
  } catch (err) {
    console.error(`Could not decrypt: ${err.message}. Wrong passphrase, or the file is corrupted/not a backup produced by this app.`);
    process.exit(1);
  }

  fs.writeFileSync(outputPath, json);
  const data = JSON.parse(json);
  console.log(`Decrypted to ${outputPath}`);
  console.log(`Backup taken at: ${data.exportedAt}`);
  console.log('Row counts:', Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length])));
}

main();
