// netlify/functions/get-rates.js
const fetch = require('node-fetch');

exports.handler = async () => {
  try {
    const url = process.env.APPS_SCRIPTS_URL + '?mode=rates';
    const r = await fetch(url, { method: 'GET' });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (err) {
    console.error('get-rates proxy error', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
