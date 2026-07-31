const fs = require('fs');
const os = require('os');
const path = require('path');

// Mirrors whatsapp-bot/src/whatsapp/bot.js's findPuppeteerCachedChrome() —
// a fresh Windows box has no system-installed Chrome, only whatever
// puppeteer's own postinstall downloaded into its cache dir. Deliberately
// not puppeteer.executablePath() — see bot.js for why (yargs ESM/CJS crash
// on this Node version, unrelated to anything actually needed here).
function findPuppeteerCachedChrome() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
  const chromeDir = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeDir)) return null;

  const builds = fs.readdirSync(chromeDir)
    .filter((name) => fs.statSync(path.join(chromeDir, name)).isDirectory())
    .sort((a, b) => {
      const va = a.match(/[\d.]+$/)?.[0] || '0';
      const vb = b.match(/[\d.]+$/)?.[0] || '0';
      return vb.localeCompare(va, undefined, { numeric: true });
    });

  const relativeExecutables = [
    'chrome-win64/chrome.exe',
    'chrome-linux64/chrome',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ];
  for (const build of builds) {
    for (const rel of relativeExecutables) {
      const candidate = path.join(chromeDir, build, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const CHROME_EXECUTABLE = process.env.CHROME_PATH || findPuppeteerCachedChrome() || (
  process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
);

module.exports = { CHROME_EXECUTABLE, findPuppeteerCachedChrome };
