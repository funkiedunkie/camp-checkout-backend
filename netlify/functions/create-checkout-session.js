
// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const { google } = require('googleapis');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // --- 1. Parse the body ---
    const body = JSON.parse(event.body || '{}');
    console.log('BODY_KEYS', Object.keys(body));
    const form = body.form || body; // handles both old (nested) & new (flat) payloads

    // --- 2. Extract fields safely ---
    const {
      parentFirstName = '',
      parentLastName  = '',
      parentEmail     = '',
      parentPhone     = '',
      camperFirstName = '',
      camperLastName  = '',
      campName        = 'Camp Registration',
      campDate        = '',
      selections      = [],
      subtotal        = '',
      siblingDiscount = '',
      total           = '',
      line_items      = [],
      success_url,
      cancel_url
    } = form;

    const selectionsFlat = Array.isArray(selections)
      ? selections.join(', ')
      : (selections || '');

    // --- 3. Append a row to Google Sheet ---
    try {
      const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
      const sheetId = process.env.GOOGLE_SHEET_ID;

      const jwt = new google.auth.JWT(clientEmail, null, privateKey, [
        'https://www.googleapis.com/auth/spreadsheets',
      ]);
      const sheets = google.sheets({ version: 'v4', auth: jwt });

      const ts = new Date().toISOString();

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:Z', // change to your tab name if needed
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            ts,
            parentFirstName,
            parentLastName,
            parentEmail,
            parentPhone,
            camperFirstName,
            camperLastName,
            campName,
            campDate,
            selectionsFlat,
            subtotal,
            siblingDiscount,
            total,
            'PENDING',
          ]],
        },
      });
    } catch (sheetErr) {
      console.error('SHEETS_APPEND_ERROR', sheetErr?.response?.data || sheetErr?.message || sheetErr);
      // don't block checkout if Sheets write fails
    }

    // --- 4. Create Stripe Checkout Session ---
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: success_url || 'https://bimcampcheckout.netlify.app/camp/success/',
      cancel_url: cancel_url || 'https://bimcampcheckout.netlify.app/camp/cancelled/',
      metadata: {
        parentFirstName,
        parentLastName,
        parentEmail,
        camperName: `${camperFirstName} ${camperLastName}`,
      },
    });

    // --- 5. Return session URL to redirect user ---
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (error) {
    console.error('FUNCTION_FATAL_ERROR', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
