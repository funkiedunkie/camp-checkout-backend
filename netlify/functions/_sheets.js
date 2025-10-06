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
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Registrations!A:Z',
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  const idx = header.indexOf('SessionID');
  if (idx === -1) return { rowIndex: -1, headerIndex: -1 };
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idx] || '') === sessionId) return { rowIndex: i + 1, headerIndex: idx };
  }
  return { rowIndex: -1, headerIndex: idx };
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

module.exports = { appendRow, findRowBySessionId, updateRow };
