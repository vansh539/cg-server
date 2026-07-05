require('dotenv').config();
const { pool } = require('payment-ledger-core/db');

async function main() {
  const [phoneNumber, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ') || 'Admin';

  if (!phoneNumber) {
    console.error('Usage: node scripts/seed-admin.js <phone_number> <name>');
    process.exit(1);
  }

  await pool.query(
    `INSERT INTO admins (phone_number, name, active) VALUES ($1, $2, true)
     ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name, active = true`,
    [phoneNumber, name]
  );
  console.log(`Admin seeded: ${name} (${phoneNumber})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
