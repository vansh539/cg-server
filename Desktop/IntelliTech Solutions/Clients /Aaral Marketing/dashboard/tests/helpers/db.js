require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { pool } = require('payment-ledger-core/db');

async function resetDb() {
  await pool.query(
    'TRUNCATE invoice_items, invoices, payment_claims, dues, dues_imports, customers, admins, dashboard_users, steel_movements, steel_items RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, pool };
