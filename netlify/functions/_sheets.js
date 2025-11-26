// netlify/functions/_sheets.js
const { google } = require('googleapis');

// HARD-CODED for Winter 2025
const SHEET_ID = '1h4CeyR0wIt59HUDhXvMPQfLpAydfytJYRc9tjAXatkw';
const TAB_NAME = 'Winter2025';

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
  return (
    normalized === normalizeForComparison(suffix) ||
    normalized.endsWith(normalizeForComparison(suffix))
  );
}

function findHeaderIndex(headerRow, target) {
  if (!Array.isArray(headerRow)) return -1;

  const targets = Array.isArray(target) ? target : [target];

  // First pass: exact matches
  for (const candidate of targets) {
    const idx = headerRow.findIndex(h => headerMatches(h, candidate));
    if (idx !== -1) return idx;
  }

  // Second pass: suffix matches (e.g. "Stripe Session Id" -> "SessionID")
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

/**
 * Read all values from Winter2025!A:Z
 */
async function fetchSheetValues() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:Z`,
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  return { header, rows };
}

/**
 * Append one row to Winter2025
 */
async function appendRow(values) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
  return res.data;
}

/**
 * Find a row by SessionID (in Winter2025)
 */
async function findRowBySessionId(sessionId) {
  const { header, rows } = await fetchSheetValues();
  const idx = findHeaderIndex(header, 'SessionID');
  if (idx === -1) return { rowIndex: -1, headerIndex: -1, header, rows };

  for (let i = 1; i < rows.length; i++) {
    const cellValue = normalizeCellValue(rows[i][idx]);
    if (cellValue && cellValue === normalizeCellValue(sessionId)) {
      // rowIndex is 1-based in Sheets
      return { rowIndex: i + 1, headerIndex: idx, header, rows };
    }
  }
  return { rowIndex: -1, headerIndex: idx, header, rows };
}

/**
 * Update a full row (by 1-based index) in Winter2025
 */
async function updateRow(rowIndex, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${rowIndex}:Z${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

/**
 * Return all rows as array of objects keyed by header
 */
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

/**
 * Same as getSheet but also returns the actual row index in the sheet
 */
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

/**
 * Flip Status / PaymentStatus for a given Stripe session
 */
async function updateStatusBySessionId(sessionId, status, extraFields = {}) {
  const { rowIndex, headerIndex, header, rows } = await findRowBySessionId(sessionId);
  if (rowIndex === -1) {
    return {
      ok: false,
      reason: headerIndex === -1 ? 'SESSION_COLUMN_MISSING' : 'SESSION_NOT_FOUND',
    };
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

  // set status
  normalizedRow[statusIdx] = status;

  // apply any extraFields (e.g. parentEmail)
  for (const [fieldName, fieldValue] of Object.entries(extraFields)) {
    const idx = findHeaderIndex(header, fieldName);
    if (idx !== -1) {
      normalizedRow[idx] = fieldValue;
    }
  }

  const lastColumn = columnNumberToLetter(rowArrayLength || 1);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${rowIndex}:${lastColumn}${rowIndex}`,
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
