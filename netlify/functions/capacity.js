// netlify/functions/capacity.js
const { getSheet } = require('./_sheets.js');

exports.handler = async () => {
  try {
    // This now reads Winter2025 via _sheets.js
    const rows = await getSheet();

    // helper to normalize column keys
    const normalizeKey = value => (value || '').toString().replace(/[^a-z0-9]/gi, '').toLowerCase();

    const statusFromRow = row => {
      for (const [key, value] of Object.entries(row || {})) {
        const k = normalizeKey(key);
        if (k === 'status' || k.endsWith('status')) {
          return (value || '').toString().trim().toUpperCase();
        }
      }
      return '';
    };

    // count PAID + PENDING rows in Winter2025
    const paid = rows.filter(r => {
      const s = statusFromRow(r);
      return s === 'PAID' || s === 'PENDING';
    }).length;

    const capacity = Number(process.env.CAPACITY) || 40;

    return {
      statusCode: 200,
      body: JSON.stringify({ paid, capacity }),
    };
  } catch (err) {
    console.error('capacity error', err);
    return { statusCode: 500, body: err.toString() };
  }
};
