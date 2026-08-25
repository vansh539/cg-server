// Gathers every real business table into one JSON snapshot for the manual
// backup. The table list is discovered from information_schema rather than
// hardcoded, so a future migration's new table is included automatically
// instead of silently missing from every backup until someone remembers to
// update a list here.

const { pool } = require('payment-ledger-core/db');

// Not business data: migration bookkeeping (meaningless to restore) and
// express-session's own login-session store (restoring it would just plant
// stale session cookies, and mailing it out is a mild token leak for no
// benefit).
const EXCLUDED_TABLES = new Set(['schema_migrations', 'schema_migrations_aaral', 'session']);

async function listBackupTables() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name).filter((name) => !EXCLUDED_TABLES.has(name));
}

async function exportAllData() {
  const tableNames = await listBackupTables();
  const tables = {};
  for (const name of tableNames) {
    // Table names come only from information_schema, never from user input,
    // so interpolating here is not a SQL-injection surface.
    const { rows } = await pool.query(`SELECT * FROM "${name}" ORDER BY 1`);
    tables[name] = rows;
  }
  return { exportedAt: new Date().toISOString(), tables };
}

module.exports = { exportAllData, listBackupTables, EXCLUDED_TABLES };
