require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { hashPin } = require('../src/adminAuth');

const pin = process.argv[2];
if (!pin || !/^\d{4,8}$/.test(pin)) {
  console.error('Usage: node scripts/set-admin-pin.js <4-8 digit PIN>');
  process.exit(1);
}

const hash = hashPin(pin);
const envPath = path.join(__dirname, '..', '.env');
let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (/^ADMIN_PIN_HASH=/m.test(contents)) {
  contents = contents.replace(/^ADMIN_PIN_HASH=.*$/m, `ADMIN_PIN_HASH=${hash}`);
} else {
  contents += `${contents === '' || contents.endsWith('\n') ? '' : '\n'}ADMIN_PIN_HASH=${hash}\n`;
}
fs.writeFileSync(envPath, contents);
console.log('Admin PIN updated. Restart aaral-dashboard for it to take effect.');
