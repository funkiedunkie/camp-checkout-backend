// netlify/functions/capacity.js
const { getSheet } = require('./_sheets.js');

exports.handler = async () => {
  try {
    const rows = await getSheet();

    const normalizeKey = value => (value || '').toString().replace(/[^a-z0-9]/gi, '').toLowerCase();
    const matchesColumn = (key, targets) => {
      const normalizedKey = normalizeKey(key);
      const list = Array.isArray(targets) ? targets : [targets];
      return list.some(target => {
        const normalizedTarget = normalizeKey(target);
        return normalizedKey === normalizedTarget || normalizedKey.endsWith(normalizedTarget);
      });
    };

    const statusValue = row => {
      for (const [key, value] of Object.entries(row || {})) {
        if (matchesColumn(key, ['Status', 'PaymentStatus'])) {
          return (value || '').toString().trim().toUpperCase();
        }
      }
      return '';
    };

    const paid = rows.filter(r =>
      ['PAID', 'PENDING'].includes(statusValue(r))
    ).length;

    const capacity = Number(process.env.CAPACITY) || 40;

    return {
      statusCode: 200,
      body: JSON.stringify({ paid, capacity }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.toString() };
  }
};
