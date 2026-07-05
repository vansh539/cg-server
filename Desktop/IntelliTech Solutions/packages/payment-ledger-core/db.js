const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[payment-ledger-core] Unexpected DB pool error:', err.message);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[payment-ledger-core] Query executed in ${Date.now() - start}ms, ${result.rowCount} rows`);
    }
    return result;
  } catch (err) {
    console.error('[payment-ledger-core] DB query error:', err.message, '| query:', text);
    throw err;
  }
};

const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW(), current_database()');
    console.log(`[payment-ledger-core] Database connected: ${result.rows[0].current_database}`);
    return true;
  } catch (err) {
    console.error('[payment-ledger-core] Database connection failed:', err.message);
    return false;
  }
};

module.exports = { pool, query, testConnection };
