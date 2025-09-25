// netlify/functions/create-checkout-session.js
// Simple test function - replace your 500-line file with JUST this

exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify({
      message: 'Function is alive ✅',
      method: event.httpMethod,
      timestamp: new Date().toISOString()
    })
  };
};
