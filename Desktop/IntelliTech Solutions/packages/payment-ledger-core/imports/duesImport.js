const fs = require('fs');
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
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

function cellToPlainValue(cellValue) {
  if (cellValue === undefined || cellValue === null) return '';
  if (cellValue instanceof Date) return cellValue.toISOString().slice(0, 10);
  if (typeof cellValue === 'object') {
    if (Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((fragment) => fragment.text).join('');
    }
    if ('result' in cellValue) return cellValue.result;
    if ('text' in cellValue) return cellValue.text;
  }
  return cellValue;
}

async function parseDuesXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  let headers = [];
  const records = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = row.values.map((v) => (v === undefined || v === null ? '' : String(v).trim()));
      return;
    }

    const record = {};
    headers.forEach((header, i) => {
      if (!header) return;
      record[header] = cellToPlainValue(row.values[i]);
    });
    records.push(record);
  });

  return records.map(normalizeDuesRow);
}

async function importDuesFromFile(filePath, adminPhone) {
  const buffer = fs.readFileSync(filePath);
  const isXlsx = filePath.toLowerCase().endsWith('.xlsx');
  const rows = isXlsx ? await parseDuesXlsx(buffer) : parseDuesCsv(buffer.toString('utf8'));

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
