// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // CORS + preflight for browser calls
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { line_items = [], metadata = {} } = JSON.parse(event.body || '{}');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      // point to the pages you actually created
      success_url: 'https://bimcampcheckout.netlify.app/camp/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://bimcampcheckout.netlify.app/camp/cancelled',
      metadata
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url }) // return URL, not just id
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
