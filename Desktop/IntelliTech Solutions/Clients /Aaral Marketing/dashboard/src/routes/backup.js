// Manual, encrypted, emailed database backup. Admin-only, triggered by a
// button press -- no schedule, no automatic retry, matches how this was
// scoped: a "do it now" button, not a background job.

const express = require('express');
const zlib = require('zlib');
const { requireAdmin } = require('../sessionAuth');
const { exportAllData } = require('../backupExport');
const { encryptBuffer } = require('../backupCrypto');
const { createGmailTransport, sendBackupEmail } = require('../backupEmail');
const { logActivity } = require('../activityLog');

const router = express.Router();

function dateStamp(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.post('/backup/run', requireAdmin, async (req, res) => {
  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;
  const recipient = process.env.BACKUP_RECIPIENT_EMAIL;
  const gmailUser = process.env.BACKUP_GMAIL_USER;
  const gmailAppPassword = process.env.BACKUP_GMAIL_APP_PASSWORD;

  if (!passphrase) {
    return res.status(500).json({ ok: false, error: 'BACKUP_ENCRYPTION_PASSPHRASE is not set on the server.' });
  }
  if (!recipient) {
    return res.status(500).json({ ok: false, error: 'BACKUP_RECIPIENT_EMAIL is not set on the server.' });
  }
  const transport = createGmailTransport({ user: gmailUser, appPassword: gmailAppPassword });
  if (!transport) {
    return res.status(500).json({ ok: false, error: 'Gmail sending is not configured (BACKUP_GMAIL_USER / BACKUP_GMAIL_APP_PASSWORD).' });
  }

  try {
    const data = await exportAllData();
    const json = JSON.stringify(data);
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const encrypted = encryptBuffer(gz, passphrase);
    const stamp = dateStamp(new Date());
    const tableCounts = Object.fromEntries(
      Object.entries(data.tables).map(([name, rows]) => [name, rows.length])
    );

    await sendBackupEmail(transport, {
      from: gmailUser,
      to: recipient,
      subject: `Aaral Marketing backup — ${stamp}`,
      text: `Encrypted database backup for ${stamp}.\n\nTables included: ${Object.keys(tableCounts).join(', ')}.\n\nThis file requires the backup passphrase to open -- ask whoever set it up if you don't have it. It will not open without it.`,
      attachmentName: `aaral-backup-${stamp}.enc`,
      attachmentBuffer: encrypted,
    });

    await logActivity(req, 'sent a manual backup', `to ${recipient}, ${encrypted.length} bytes`);
    res.json({ ok: true, sentTo: recipient, sizeBytes: encrypted.length, tableCounts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
