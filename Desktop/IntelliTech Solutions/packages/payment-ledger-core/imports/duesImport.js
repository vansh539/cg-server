const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { query } = require('../db');
const { findByPhone } = require('../ledger/customers');

function parseDuesCsv(csvContent) {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((r) => ({
    phoneNumber: r.phone_number || r.phone || '',
    name: r.name || '',
    externalRefId: r.membership_id || r.external_ref_id || null,
    description: r.description || '',
    amountDue: parseFloat(r.amount_due || r.amount || '0'),
    dueDate: r.due_date || null,
  }));
}

async function importDuesFromFile(filePath, adminPhone) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parseDuesCsv(content);

  const { rows: importRows } = await query(
    `INSERT INTO dues_imports (filename, imported_by, row_count) VALUES ($1, $2, $3) RETURNING id`,
    [filePath, adminPhone, rows.length]
  );
  const importBatchId = importRows[0].id;

  let unmatchedCount = 0;
  const unmatched = [];

  for (const row of rows) {
    if (!row.phoneNumber || !row.description || Number.isNaN(row.amountDue) || row.amountDue <= 0) {
      unmatchedCount++;
      unmatched.push(row);
      continue;
    }

    let customer = await findByPhone(row.phoneNumber);
    if (!customer) {
      const { rows: created } = await query(
        `INSERT INTO customers (name, phone_number, external_ref_id) VALUES ($1, $2, $3) RETURNING *`,
        [row.name || 'Unknown', row.phoneNumber, row.externalRefId]
      );
      customer = created[0];
    } else if (row.externalRefId && !customer.external_ref_id) {
      await query(`UPDATE customers SET external_ref_id = $2 WHERE id = $1`, [customer.id, row.externalRefId]);
    }

    await query(
      `INSERT INTO dues (customer_id, description, amount_due, due_date, import_batch_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [customer.id, row.description, row.amountDue, row.dueDate, importBatchId]
    );
  }

  await query(`UPDATE dues_imports SET unmatched_count = $2 WHERE id = $1`, [importBatchId, unmatchedCount]);

  return { importBatchId, totalRows: rows.length, unmatchedCount, unmatched };
}

module.exports = { parseDuesCsv, importDuesFromFile };
