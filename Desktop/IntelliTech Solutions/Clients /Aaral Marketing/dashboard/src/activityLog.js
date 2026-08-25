const { query } = require('payment-ledger-core/db');

// Fire-and-forget audit trail for Personnel Tracking -- records who did what
// and when, so a mistake in the ledger can be traced back to a specific
// person instead of "someone, at some point." Never blocks or fails the
// action it's logging: a broken audit trail is a smaller problem than a
// broken invoice save.
async function logActivity(req, action, detail) {
  const user = req.session && req.session.user;
  if (!user) return;
  try {
    await query(
      `INSERT INTO activity_log (user_id, username, display_name, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.username, user.displayName, action, detail || null]
    );
  } catch (err) {
    console.error('[ActivityLog] Failed to record activity:', err.message);
  }
}

module.exports = { logActivity };
