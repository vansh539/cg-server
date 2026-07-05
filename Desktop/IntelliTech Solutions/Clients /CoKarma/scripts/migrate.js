require('dotenv').config();
const { pool } = require('payment-ledger-core/db');
const { migrate } = require('payment-ledger-core/migrate');

migrate(pool)
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
