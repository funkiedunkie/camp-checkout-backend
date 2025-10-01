// netlify/functions/create-checkout-session.js
// Truly minimal version - about 25 lines

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { line_items, metadata } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      success_url: 'https://bimcampcheckout.netlify.app/camp/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://bimcampcheckout.netlify.app/camp/cancelled',
      metadata: metadata
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ id: session.id })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
