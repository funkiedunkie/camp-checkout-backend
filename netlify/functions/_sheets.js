// netlify/functions/_sheets.js
const { google } = require('googleapis');

function getSheetsClient() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth: jwt });
}

function normalizeHeaderValue(value) {
  return (value || '').toString().trim();
}

function normalizeCellValue(value) {
  return (value || '').toString().trim();
}

function normalizeForComparison(value) {
  return normalizeHeaderValue(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function headerMatches(headerValue, target) {
  return normalizeForComparison(headerValue) === normalizeForComparison(target);
}

function headerMatchesSuffix(headerValue, suffix) {
  const normalized = normalizeForComparison(headerValue);
  return normalized === normalizeForComparison(suffix) || normalized.endsWith(normalizeForComparison(suffix));
}

function findHeaderIndex(headerRow, target) {
  if (!Array.isArray(headerRow)) return -1;

  const targets = Array.isArray(target) ? target : [target];

  // First pass: look for exact matches against the provided targets.
  for (const candidate of targets) {
    const idx = headerRow.findIndex(h => headerMatches(h, candidate));
    if (idx !== -1) return idx;
  }

  // Second pass: allow suffix matches so "Stripe Session Id" resolves to "SessionID".
  for (const candidate of targets) {
    const idx = headerRow.findIndex(h => headerMatchesSuffix(h, candidate));
    if (idx !== -1) return idx;
  }

  return -1;
}

function columnNumberToLetter(num) {
  let result = '';
  let n = num;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || 'A';
}

async function fetchSheetValues() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Registrations!A:Z',
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  return { header, rows };
}

async function appendRow(values) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Registrations!A:Z',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
  return res.data;
}

async function findRowBySessionId(sessionId) {
  const { header, rows } = await fetchSheetValues();
  const idx = findHeaderIndex(header, 'SessionID');
  if (idx === -1) return { rowIndex: -1, headerIndex: -1, header, rows };
  for (let i = 1; i < rows.length; i++) {
    const cellValue = normalizeCellValue(rows[i][idx]);
    if (cellValue && cellValue === normalizeCellValue(sessionId)) {
      return { rowIndex: i + 1, headerIndex: idx, header, rows };
    }
  }
  return { rowIndex: -1, headerIndex: idx, header, rows };
}

async function updateRow(rowIndex, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Registrations!A${rowIndex}:Z${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

async function getSheet() {
  const { header, rows } = await fetchSheetValues();
  if (rows.length <= 1) return [];
  const normalizedHeader = header.map(normalizeHeaderValue);
  return rows.slice(1).map(row => {
    const obj = {};
    for (let i = 0; i < normalizedHeader.length; i++) {
      const key = normalizedHeader[i] || `Column${i + 1}`;
      obj[key] = normalizeCellValue(row[i]);
    }
    return obj;
  });
}

async function listRegistrationsWithRowIndex() {
  const { header, rows } = await fetchSheetValues();
  if (rows.length <= 1) return [];
  const normalizedHeader = header.map(normalizeHeaderValue);
  return rows.slice(1).map((row, idx) => {
    const data = {};
    for (let i = 0; i < normalizedHeader.length; i++) {
      const key = normalizedHeader[i] || `Column${i + 1}`;
      data[key] = normalizeCellValue(row[i]);
    }
    return { rowIndex: idx + 2, data };
  });
}

async function updateStatusBySessionId(sessionId, status, extraFields = {}) {
  const { rowIndex, headerIndex, header, rows } = await findRowBySessionId(sessionId);
  if (rowIndex === -1) {
    return { ok: false, reason: headerIndex === -1 ? 'SESSION_COLUMN_MISSING' : 'SESSION_NOT_FOUND' };
  }

  const statusIdx = findHeaderIndex(header, ['Status', 'PaymentStatus']);
  if (statusIdx === -1) {
    return { ok: false, reason: 'STATUS_COLUMN_MISSING' };
  }

  const rowArrayLength = Math.max(header.length, rows[rowIndex - 1]?.length || 0);
  const normalizedRow = new Array(rowArrayLength).fill('');
  const existingRow = rows[rowIndex - 1] || [];
  for (let i = 0; i < rowArrayLength; i++) {
    normalizedRow[i] = existingRow[i] ?? '';
  }

  normalizedRow[statusIdx] = status;

  for (const [fieldName, fieldValue] of Object.entries(extraFields)) {
    const idx = findHeaderIndex(header, fieldName);
    if (idx !== -1) {
      normalizedRow[idx] = fieldValue;
    }
  }

  const lastColumn = columnNumberToLetter(rowArrayLength || 1);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Registrations!A${rowIndex}:${lastColumn}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [normalizedRow] },
  });

  return { ok: true, rowIndex };
}

module.exports = {
  appendRow,
  findRowBySessionId,
  updateRow,
  getSheet,
  updateStatusBySessionId,
  listRegistrationsWithRowIndex,
};
