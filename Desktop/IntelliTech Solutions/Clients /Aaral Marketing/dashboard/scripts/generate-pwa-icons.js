'use strict';
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'aaral-logo-master.png');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets');
const BACKGROUND = '#191048'; // matches --navy in styles.css

async function makeIcon(size, filename) {
  const logo = await sharp(SRC)
    .resize(Math.round(size * 0.72), Math.round(size * 0.72), { fit: 'inside' })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT_DIR, filename));
  console.log(`Wrote ${filename}`);
}

(async () => {
  await makeIcon(180, 'aaral-icon-180.png');
  await makeIcon(512, 'aaral-icon-512.png');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
