async function notify(phone, message) {
  const url = process.env.NOTIFY_SERVICE_URL || 'http://127.0.0.1:5002';
  try {
    const res = await fetch(`${url}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.sent === true;
  } catch (err) {
    console.error('[Notify] Failed to reach bot notify service:', err.message);
    return false;
  }
}

module.exports = { notify };
