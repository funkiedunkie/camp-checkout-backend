#!/usr/bin/env node

const Stripe = require('stripe');
const {
  listRegistrationsWithRowIndex,
  updateStatusBySessionId,
} = require('../netlify/functions/_sheets.js');

function normalizeStatus(value) {
  return (value || '').toString().trim().toUpperCase();
}

function normalizeKey(value) {
  return (value || '').toString().replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function matchesColumn(key, target) {
  const normalizedKey = normalizeKey(key);
  const normalizedTarget = normalizeKey(target);
  return (
    normalizedKey === normalizedTarget ||
    normalizedKey.endsWith(normalizedTarget)
  );
}

function getColumnValue(rowData, columnName) {
  const candidates = Array.isArray(columnName) ? columnName : [columnName];

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(rowData)) {
      if (matchesColumn(key, candidate)) {
        return (value || '').toString().trim();
      }
    }
  }

  return '';
}

function mapStripeSessionToStatus(session) {
  if (!session) return null;

  if (session.status === 'expired') {
    return 'EXPIRED';
  }

  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return 'PAID';
  }

  if (session.payment_status === 'unpaid' && session.status === 'complete') {
    return 'FAILED';
  }

  return null;
}

async function backfillPendingRegistrations({ stripeClient } = {}) {
  const client = stripeClient || (() => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('Missing STRIPE_SECRET_KEY environment variable.');
    }
    return new Stripe(secretKey);
  })();

  const registrations = await listRegistrationsWithRowIndex();
  const pending = registrations.filter(({ data }) => {
    const status = normalizeStatus(getColumnValue(data, ['Status', 'PaymentStatus']));
    const sessionId = getColumnValue(data, ['SessionID']);
    if (!sessionId) return false;
    return status === '' || status === 'PENDING';
  });

  if (!pending.length) {
    console.log('No pending registrations with session IDs found.');
    return { total: 0, updated: 0, skipped: 0, errors: 0 };
  }

  console.log(`Found ${pending.length} pending registration(s) with session IDs.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of pending) {
    const sessionId = getColumnValue(entry.data, ['SessionID']);
    const currentStatus = normalizeStatus(getColumnValue(entry.data, ['Status', 'PaymentStatus'])) || 'PENDING';

    try {
      const session = await client.checkout.sessions.retrieve(sessionId);
      const nextStatus = mapStripeSessionToStatus(session);

      if (!nextStatus) {
        console.log(`[skip] ${sessionId} remains in ${currentStatus} on Stripe.`);
        skipped += 1;
        continue;
      }

      if (nextStatus === currentStatus) {
        console.log(`[skip] ${sessionId} already marked as ${currentStatus}.`);
        skipped += 1;
        continue;
      }

      const result = await updateStatusBySessionId(sessionId, nextStatus);
      if (result.ok) {
        console.log(`[update] ${sessionId}: ${currentStatus} -> ${nextStatus}`);
        updated += 1;
      } else {
        console.warn(`[error] ${sessionId}: failed to update sheet (${result.reason}).`);
        errors += 1;
      }
    } catch (err) {
      console.error(`[error] ${sessionId}: ${err.message}`);
      errors += 1;
    }
  }

  console.log(`Backfill complete. Updated: ${updated}, skipped: ${skipped}, errors: ${errors}.`);
  return { total: pending.length, updated, skipped, errors };
}

if (require.main === module) {
  backfillPendingRegistrations().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  backfillPendingRegistrations,
  mapStripeSessionToStatus,
  normalizeStatus,
  getColumnValue,
};
