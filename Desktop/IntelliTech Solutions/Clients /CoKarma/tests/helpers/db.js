require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { pool } = require('../../src/db/db');

async function resetDb() {
  await pool.query(
    'TRUNCATE payment_claims, dues, dues_imports, customers, admins RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, pool };
