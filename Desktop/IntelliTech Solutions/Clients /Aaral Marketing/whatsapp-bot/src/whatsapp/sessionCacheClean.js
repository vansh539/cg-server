const fs = require('fs');
const path = require('path');

// WhatsApp Web is a PWA that caches its own JS bundle via a Service Worker.
// Killing Chrome mid-write to that cache (which is what every watchdog
// force-exit and every `taskkill /F` does) can leave it in a state where the
// page loads fully — readyState 'complete', loading_screen even reaching 100% —
// but 'ready' never fires. The library gives no signal at all, because it calls
// page.goto(WhatsWebURL, { timeout: 0 }) internally, so Puppeteer's own
// navigation timeout is explicitly disabled and the hang is silent.
//
// This was the confirmed root cause of a ~90 minute silent-hang saga on this
// very client (2026-07-11) that survived multiple 20-30 minute cooldowns.
// Deleting ONLY these three cache dirs — leaving Cookies / IndexedDB /
// Local Storage, which hold the actual multi-device auth — fixed it in ~12
// seconds without requiring a re-pair.
//
// bot.js's existing chromeCleanup() kills processes and clears Singleton locks,
// but has never touched these dirs; that gap is why the same hang keeps coming
// back on this machine.
const CACHE_DIRS = ['Service Worker', 'Cache', 'Code Cache'];

// Chrome nests these under the profile's Default/ dir; some layouts also have
// them at the profile root. Clear whichever exist — deleting a cache dir that
// isn't there is a no-op, and being wrong in the harmless direction is better
// than leaving a corrupted cache behind.
function clearSessionCache(sessionProfileDir, fsImpl = fs) {
  const cleared = [];
  for (const base of [path.join(sessionProfileDir, 'Default'), sessionProfileDir]) {
    for (const dir of CACHE_DIRS) {
      const full = path.join(base, dir);
      try {
        if (fsImpl.existsSync(full)) {
          fsImpl.rmSync(full, { recursive: true, force: true });
          cleared.push(full);
        }
      } catch (e) {
        // A locked file (Chrome not fully dead yet) must never abort startup —
        // a stale cache is a degraded state, not a fatal one.
      }
    }
  }
  return cleared;
}

module.exports = { clearSessionCache, CACHE_DIRS };
