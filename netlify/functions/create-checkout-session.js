
// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch'); // v2

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // ---- Parse body + accept both shapes (old nested + new flat)
    const body = JSON.parse(event.body || '{}');
    console.log('BODY_KEYS', Object.keys(body));
    const form = body.form || body;

    // ---- Map fields so Apps Script gets what it expects
    const camperFirst = form.camperFirstName || form.camperFirst || '';
    const camperLast  = form.camperLastName  || form.camperLast  || '';
    const parentName  = form.parentName || [form.parentFirstName, form.parentLastName].filter(Boolean).join(' ');
    const parentEmail = form.parentEmail || '';
    const phone       = form.parentPhone || form.phone || '';
    const week        = form.week || form.campDate || '';
    const options     = form.options || form.selections || [];         // array or string ok
    const siblings    = form.siblings ?? 0;
    const subtotal    = form.subtotal ?? '';
    const discounts   = form.discounts ?? form.siblingDiscount ?? '';
    const total       = form.total ?? '';

    // Stripe inputs (kept as-is from body)
    const line_items  = form.line_items || body.line_items || [];
    const success_url = form.success_url || body.success_url || 'https://bimcampcheckout.netlify.app/camp/success/';
    const cancel_url  = form.cancel_url  || body.cancel_url  || 'https://bimcampcheckout.netlify.app/camp/cancelled/';

    // ---- Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url,
      cancel_url,
      metadata: {
        camper: `${camperFirst} ${camperLast}`.trim(),
        parentName,
        parentEmail,
        week
      }
    });

    // ---- Send to Google Apps Script (Sheets logger)
    // NOTE: This is fire-and-forget; we log status to diagnose if it breaks.
    let scriptStatus = 'n/a';
    try {
      const resp = await fetch(process.env.APPS_SCRIPTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'PENDING',
          sessionId: session.id,
          checkoutUrl: session.url,
          camperFirst,
          camperLast,
          parentName,
          parentEmail,
          phone,
          week,
          options,
          siblings,
          subtotal,
          discounts,
          total
        })
      });
      scriptStatus = `${resp.status}`;
      const text = await resp.text();
      console.log('APPS_SCRIPT_STATUS', resp.status, text.slice(0, 300));
    } catch (e) {
      console.error('APPS_SCRIPT_FETCH_ERROR', e?.message || e);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url, appsScript: scriptStatus })
    };

  } catch (error) {
    console.error('FUNCTION_FATAL_ERROR', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
