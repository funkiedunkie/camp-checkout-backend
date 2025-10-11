import { getSheet } from './_sheets.js';

export async function handler() {
  try {
    const rows = await getSheet();

    // Count both paid + pending
    const paid = rows.filter(r =>
      ['PAID', 'PENDING'].includes((r.status || '').toUpperCase())
    ).length;

    // Pull capacity from Netlify env or fallback
    const capacity = Number(process.env.CAPACITY) || 40;

    return {
      statusCode: 200,
      body: JSON.stringify({ paid, capacity }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.toString() };
  }
}
