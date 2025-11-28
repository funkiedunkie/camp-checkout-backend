// netlify/functions/mark-paid.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { updateStatusBySessionId } = require('./_sheets.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const sessionId = body.sessionId || body.session_id;
    if (!sessionId) {
      return { statusCode: 400, body: 'Missing sessionId' };
    }

    // Optional: fetch the session from Stripe to get the payer's email
    let parentEmail = '';
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      parentEmail = session.customer_details?.email || '';
    } catch (err) {
      console.error('stripe retrieve error', err);
    }

    const result = await updateStatusBySessionId(sessionId, 'PAID', {
      'Parent Email': parentEmail,
    });

    if (!result.ok) {
      return {
        statusCode: 404,
        body: JSON.stringify({ ok: false, error: result.reason }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rowIndex: result.rowIndex }),
    };
  } catch (err) {
    console.error('mark-paid error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
 
