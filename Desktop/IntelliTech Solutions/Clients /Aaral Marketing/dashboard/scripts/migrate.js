require('dotenv').config();
const { pool } = require('payment-ledger-core/db');
const { migrate } = require('payment-ledger-core/migrate');
const { applyAaralMigrations } = require('../src/db/migrateAaral');

(async () => {
  await migrate(pool);
  await applyAaralMigrations(pool);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
