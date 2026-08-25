// Sends the encrypted backup file as a Gmail attachment. Gmail's own SMTP
// requires an App Password (myaccount.google.com/apppasswords) -- the normal
// account password will not authenticate here.

const nodemailer = require('nodemailer');

function createGmailTransport({ user, appPassword }) {
  if (!user || !appPassword) return null;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: appPassword },
  });
}

async function sendBackupEmail(transport, { from, to, subject, text, attachmentName, attachmentBuffer }) {
  return transport.sendMail({
    from,
    to,
    subject,
    text,
    attachments: [{ filename: attachmentName, content: attachmentBuffer }],
  });
}

module.exports = { createGmailTransport, sendBackupEmail };
