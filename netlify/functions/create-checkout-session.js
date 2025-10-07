// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch'); // v2

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { line_items = [], form = {}, success_url, cancel_url } = JSON.parse(event.body || '{}');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: success_url || 'https://bimcampcheckout.netlify.app/camp/success/',
      cancel_url:  cancel_url  || 'https://bimcampcheckout.netlify.app/camp/cancelled/'
    });

    // fire-and-forget log to Google Apps Script (no private key needed)
    try {
      await fetch(process.env.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'PENDING',
          sessionId: session.id,
          checkoutUrl: session.url,
          camperFirst: form.camperFirst || '',
          camperLast:  form.camperLast  || '',
          parentName:  form.parentName  || '',
          parentEmail: form.parentEmail || '',
          phone:       form.phone       || '',
          week:        form.week        || '',
          options:     form.options     || [],
          siblings:    form.siblings    || 0,
          subtotal:    form.subtotal    || 0,
          discounts:   form.discounts   || 0,
          total:       form.total       || 0
        })
      });
    } catch (e) {
      // don't block checkout if sheet logging fails
      console.error('Apps Script logging error:', e);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
