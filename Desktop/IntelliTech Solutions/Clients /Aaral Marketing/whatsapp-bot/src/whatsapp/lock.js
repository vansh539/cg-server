const fs = require('fs');

// A PID lock over the WhatsApp session directory.
//
// Two whatsapp-web.js clients sharing one LocalAuth session is not a benign
// local race — it has caused a real WhatsApp-side forced LOGOUT on a previous
// project (a background test instance and a live campaign instance briefly
// overlapped; WhatsApp invalidated the linked device and demanded a fresh QR).
// This bot had no lock at all: PM2 being the only launcher was the entire
// safety story, so a single manual `node src/whatsapp/bot.js` while PM2 had it
// running was enough to risk the client's number.
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function acquireLock(lockPath, pid = process.pid, fsImpl = fs) {
  if (fsImpl.existsSync(lockPath)) {
    const existingPid = parseInt(String(fsImpl.readFileSync(lockPath, 'utf8')).trim(), 10);
    if (existingPid && existingPid !== pid && isPidAlive(existingPid)) {
      return { ok: false, reason: `already running (pid ${existingPid})` };
    }
  }
  fsImpl.mkdirSync(require('path').dirname(lockPath), { recursive: true });
  fsImpl.writeFileSync(lockPath, String(pid));
  return { ok: true };
}

// Only ever clears a lock this process owns, or one left behind by a process
// that has since died. Releasing unconditionally would let a second instance
// delete the incumbent's lock and attach to the same WhatsApp session — exactly
// the ban scenario above. This matters more than it looks: the teardown path
// runs before every reconnect, so an unconditional release would quietly defeat
// acquireLock on every single self-heal.
function releaseLock(lockPath, pid = process.pid, fsImpl = fs) {
  if (!fsImpl.existsSync(lockPath)) return false;
  const holder = parseInt(String(fsImpl.readFileSync(lockPath, 'utf8')).trim(), 10);
  if (holder && holder !== pid && isPidAlive(holder)) return false;
  fsImpl.unlinkSync(lockPath);
  return true;
}

module.exports = { acquireLock, releaseLock, isPidAlive };
