const fs = require('fs');
const path = require('path');

async function applyAaralMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations_aaral (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, '..', '..', 'migrations-aaral');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations_aaral WHERE filename = $1', [file]);
    if (rows.length) {
      console.log(`Skipping already-applied Aaral migration: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying Aaral migration: ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations_aaral (filename) VALUES ($1)', [file]);
  }

  console.log('Aaral migrations complete.');
}

module.exports = { applyAaralMigrations };
