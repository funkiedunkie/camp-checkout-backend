// netlify/functions/_sheets.js
const { google } = require('googleapis');

// HARD-CODED for Winter 2025
const SHEET_ID = '1h4CeyR0wIt59HUDhXvMPQfLpAydfytJYRc9tjAXatkw';
const TAB_NAME = 'Winter2025';        // matches your tab name in the Winter 2025 sheet

function getSheetsClient() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth: jwt });
}

// ---------- normalizers ----------

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
  const tgt = normalizeForComparison(suffix);
  return normalized === tgt || normalized.endsWith(tgt);
}

function findHeaderIndex(headerRow, target) {
  if (!Array.isArray(headerRow)) return -1;
  const targets = Array.isArray(target) ? target : [target];

  // exact match first
  for (const t of targets) {
    const idx = headerRow.findIndex(h => headerMatches(h, t));
    if (idx !== -1) return idx;
  }
  // then suffix match
  for (const t of targets) {
    const idx = headerRow.findIndex(h => headerMatchesSuffix(h, t));
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

// ---------- core helpers ----------

async function fetchSheetValues() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:AD`,   // covers your 30 columns
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  return { header, rows };
}

async function appendRow(values) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:AD`,
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
      // rowIndex is 1-based in Sheets
      return { rowIndex: i + 1, headerIndex: idx, header, rows };
    }
  }
  return { rowIndex: -1, headerIndex: idx, header, rows };
}

async function updateRow(rowIndex, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${rowIndex}:AD${rowIndex}`,
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
      // rows shorter than header just get '' for missing cells
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
    return { rowIndex: idx + 2, data }; // +2 because header + 1-based
  });
}

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

  // flip status
  normalizedRow[statusIdx] = status;

  // optional extra fields (like Parent Email)
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
