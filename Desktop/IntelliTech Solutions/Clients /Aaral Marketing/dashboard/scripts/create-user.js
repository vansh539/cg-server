require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('payment-ledger-core/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

const { username, password, role, name } = parseArgs(process.argv.slice(2));

if (!username || !password || !role || !name) {
  console.error('Usage: node scripts/create-user.js --username <id> --password <pw> --role admin|employee --name "Full Name"');
  process.exit(1);
}
if (!['admin', 'employee'].includes(role)) {
  console.error('--role must be "admin" or "employee"');
  process.exit(1);
}
if (password.length < 6) {
  console.error('--password must be at least 6 characters');
  process.exit(1);
}

(async () => {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO dashboard_users (username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, display_name = $3, role = $4, active = true
     RETURNING username, display_name, role`,
    [username.trim().toLowerCase(), hash, name.trim(), role]
  );
  console.log(`User ready: ${rows[0].username} (${rows[0].display_name}, ${rows[0].role})`);
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
