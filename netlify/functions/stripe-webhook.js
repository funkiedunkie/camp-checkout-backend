// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { updateStatusBySessionId } = require('./_sheets.js');

function decodeBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook secret not configured.' }) };
  }

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!signature) {
    return { statusCode: 400, body: 'Missing Stripe signature header.' };
  }

  const rawBody = decodeBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('WEBHOOK_SIGNATURE_ERROR', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = stripeEvent.data.object;
        const sessionId = session.id;
        const result = await updateStatusBySessionId(sessionId, 'PAID');
        if (!result.ok) {
          console.warn('Failed to update sheet status for session', sessionId, result.reason);
        }
        break;
      }
      case 'checkout.session.async_payment_failed': {
        const session = stripeEvent.data.object;
        const sessionId = session.id;
        const result = await updateStatusBySessionId(sessionId, 'FAILED');
        if (!result.ok) {
          console.warn('Failed to mark session as FAILED', sessionId, result.reason);
        }
        break;
      }
      case 'checkout.session.expired': {
        const session = stripeEvent.data.object;
        const sessionId = session.id;
        const result = await updateStatusBySessionId(sessionId, 'EXPIRED');
        if (!result.ok) {
          console.warn('Failed to mark session as EXPIRED', sessionId, result.reason);
        }
        break;
      }
      default:
        console.log('Unhandled Stripe event type', stripeEvent.type);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('WEBHOOK_PROCESSING_ERROR', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
