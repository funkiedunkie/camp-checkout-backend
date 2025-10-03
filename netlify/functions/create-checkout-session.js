// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { appendRow } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body || '{}');

    // ---- form fields coming from your front-end ----
    const {
      camperFirst, camperLast, parentName, parentEmail, phone,
      week, options, siblings, subtotal, discounts, total
    } = data.form || {};

    // you already build these on the client; pass them through
    const line_items = data.line_items || [];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${data.success_url || (process.env.URL || 'https://bimcampcheckout.netlify.app')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.cancel_url || (process.env.URL || 'https://bimcampcheckout.netlify.app')}/cancel`,
      customer_email: parentEmail || undefined,
      allow_promotion_codes: true,
    });

    // ---- one-time header (run once to seed headers, then delete) ----
    // await appendRow([
    //   'Timestamp','Status','SessionID','CamperFirst','CamperLast','ParentName','ParentEmail','Phone',
    //   'Week','Options(Lunch/Care)','Siblings','Subtotal','Discounts','Total','PaymentIntent','CheckoutURL','Notes'
    // ]);

    // ---- write PENDING row keyed by Stripe session.id ----
    const timestamp = new Date().toISOString();
    await appendRow([
      timestamp,
      'PENDING',
      session.id,
      camperFirst || '',
      camperLast || '',
      parentName || '',
      parentEmail || '',
      phone || '',
      week || '',
      Array.isArray(options) ? options.join(', ') : (options || ''),
      siblings ?? '',
      subtotal ?? '',
      discounts ?? '',
      total ?? '',
      '',                 // PaymentIntent (filled by webhook)
      session.url || '',  // CheckoutURL
      ''                  // Notes
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id, url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
