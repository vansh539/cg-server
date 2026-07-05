const fs = require('fs');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { query } = require('../db');
const { findByPhone } = require('../ledger/customers');

const MAX_IMPORT_ROWS = 10000;

// Neutralizes CSV/Excel formula injection: a cell value starting with =, +,
// -, or @ is a formula in Excel/Sheets and could run arbitrary lookups or
// shell-outs (via legacy DDE) if an admin later opens exported/reported
// data in a spreadsheet app. Prefixing with a single quote forces it to be
// read back as inert text instead of a formula.
function sanitizeFormulaValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function normalizeDuesRow(r) {
  return {
    phoneNumber: String(r.phone_number || r.phone || '').trim(),
    name: sanitizeFormulaValue(String(r.name || '').trim()),
    externalRefId: sanitizeFormulaValue(String(r.membership_id || r.external_ref_id || '').trim()) || null,
    description: sanitizeFormulaValue(String(r.description || '').trim()),
    amountDue: parseFloat(r.amount_due || r.amount || '0'),
    dueDate: r.due_date || null,
  };
}

function parseDuesCsv(csvContent) {
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  return records.map(normalizeDuesRow);
}

function parseDuesXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return records.map(normalizeDuesRow);
}

async function importDuesFromFile(filePath, adminPhone) {
  const buffer = fs.readFileSync(filePath);
  const isXlsx = filePath.toLowerCase().endsWith('.xlsx');
  const rows = isXlsx ? parseDuesXlsx(buffer) : parseDuesCsv(buffer.toString('utf8'));

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import rejected: ${rows.length} rows exceeds the ${MAX_IMPORT_ROWS}-row cap.`);
  }

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

module.exports = { parseDuesCsv, parseDuesXlsx, importDuesFromFile, sanitizeFormulaValue };
