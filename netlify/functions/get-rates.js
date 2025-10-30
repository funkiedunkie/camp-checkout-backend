// netlify/functions/get-rates.js
const { google } = require('googleapis');

exports.handler = async () => {
  try {
    const {
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_PRIVATE_KEY,
      GOOGLE_SHEET_ID,
    } = process.env;

    if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
      return resp(500, { error: 'Missing Google env vars' });
    }

    const auth = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({ version: 'v4', auth });

    const ranges = ['Rates!A2:B200', 'Rates!A1:Z50'];
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: GOOGLE_SHEET_ID,
      ranges,
    });

    const kvRows = (res.data.valueRanges?.[0]?.values || []);
    const rates = {};
    for (const [k, v] of kvRows) {
      if (!k) continue;
      rates[k.trim()] = Number(v ?? '') || v;
    }

    const allRows = (res.data.valueRanges?.[1]?.values || []);
    let dayLabels = '';
    for (const row of allRows) {
      if ((row[0] || '').toLowerCase() === 'day labels') {
        dayLabels = row.slice(1).filter(Boolean).join(', ');
        break;
      }
    }
    rates.DAY_LABELS = dayLabels;

    return resp(200, rates);
  } catch (err) {
    console.error('get-rates error', err);
    return resp(500, { error: String(err?.message || err) });
  }
};

function resp(code, body) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
