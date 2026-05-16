/**
 * Stripe service — Checkout Sessions (hosted-page redirect, similar to Zoho flow).
 *
 * Flow:
 *   1. createCheckoutSession → returns { sessionId, paymentUrl }
 *   2. User is redirected to Stripe-hosted page, pays, redirected back.
 *   3. Stripe fires `checkout.session.completed` webhook → verifyWebhookSignature
 *      + extractRefId give us the order to mark paid.
 *
 * Credentials are read from appConfig (DB wins, .env fallback). Never
 * cache the Stripe instance — re-read on each call so hot-reloaded
 * settings take effect without a restart.
 */

const crypto = require('crypto');
const logger  = require('../config/logger');
const appConfig = require('./appConfig.service');

/* ────────── helpers ────────── */

function getStripe() {
  const secretKey = appConfig.get('stripe.secretKey');
  if (!secretKey) throw new Error('Stripe secret key not configured (set STRIPE_SECRET_KEY in .env)');
  // Lazy-require to avoid loading stripe if it's never used.
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  return new Stripe(secretKey, { apiVersion: '2024-04-10', telemetry: false });
}

function getCurrency() {
  return (appConfig.get('stripe.currency') || 'inr').toLowerCase();
}

/* ────────── Checkout Sessions ────────── */

/**
 * Create a Stripe Checkout Session.
 * @param {object} opts
 * @param {number}  opts.amount       - Amount in rupees (decimal). Converted to paise internally.
 * @param {string}  opts.currency     - ISO 4217 lowercase, defaults to appConfig setting.
 * @param {string}  opts.description  - Line-item description shown on Stripe page.
 * @param {string}  opts.referenceId  - Lexxus Order._id — stored in metadata so webhook can find it.
 * @param {string}  opts.redirectUrl  - success_url (Stripe appends ?session_id={CHECKOUT_SESSION_ID})
 * @param {string}  opts.cancelUrl    - cancel_url
 * @param {object}  [opts.customer]   - { name, email }
 * @returns {{ sessionId: string, paymentUrl: string }}
 */
async function createCheckoutSession({ amount, currency, description, referenceId, redirectUrl, cancelUrl, customer }) {
  const stripe = getStripe();
  const cur = (currency || getCurrency()).toLowerCase();

  // Stripe amounts are in the smallest currency unit (paise for INR).
  // For zero-decimal currencies (JPY etc.) keep as-is; INR is 2-decimal.
  const unitAmount = Math.round(amount * 100);

  const successUrl = redirectUrl.includes('?')
    ? `${redirectUrl}&session_id={CHECKOUT_SESSION_ID}`
    : `${redirectUrl}?session_id={CHECKOUT_SESSION_ID}`;

  const sessionParams = {
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: cur,
          unit_amount: unitAmount,
          product_data: { name: description || 'Lexxus purchase' },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { lexxusOrderId: referenceId },
    // Pre-fill customer details if provided.
    ...(customer?.email ? { customer_email: customer.email } : {}),
  };

  logger.info('stripe.createCheckoutSession request', { referenceId, unitAmount, cur });
  const session = await stripe.checkout.sessions.create(sessionParams);
  logger.info('stripe.createCheckoutSession response', { sessionId: session.id, url: session.url });

  return {
    sessionId: session.id,
    paymentUrl: session.url,
  };
}

/* ────────── Webhook signature ────────── */

/**
 * Verify a Stripe webhook signature using stripe.webhooks.constructEvent.
 * `rawBody` must be the raw Buffer from express (no JSON.parse).
 * `signature` is the value of the `stripe-signature` header.
 *
 * Returns the verified event object, or throws if invalid.
 */
function verifyWebhookSignature(rawBody, signature) {
  const stripe = getStripe();
  const webhookSecret = appConfig.get('stripe.webhookSecret');
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret not configured (set STRIPE_WEBHOOK_SECRET in .env)');
  }
  // constructEvent throws on invalid signature — let it propagate.
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/* ────────── Extract Order reference from event ────────── */

/**
 * Extract the Lexxus order ID from a Stripe event.
 * checkout.session.completed: session.metadata.lexxusOrderId
 * payment_intent.succeeded: not directly used but supported via lookup.
 */
function extractRefId(event) {
  const obj = event.data?.object || {};
  return (
    obj.metadata?.lexxusOrderId ||
    obj.metadata?.orderId ||
    null
  );
}

/**
 * Extract Stripe payment IDs from an event for storage.
 */
function extractPaymentIds(event) {
  const obj = event.data?.object || {};
  return {
    stripeSessionId: obj.id || null,
    stripePaymentId: obj.payment_intent || null,
  };
}

/* ────────── Refunds ────────── */

/**
 * Refund a Stripe payment intent.
 * @param {string} paymentIntentId - The stripe payment_intent id.
 * @param {number} amount          - Amount in rupees (decimal).
 * @param {string} [reason]        - 'duplicate' | 'fraudulent' | 'requested_by_customer'
 */
async function refundPayment({ paymentIntentId, amount, reason }) {
  const stripe = getStripe();
  const unitAmount = Math.round(amount * 100);
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: unitAmount,
    ...(reason ? { reason } : {}),
  });
  logger.info('stripe.refundPayment', { paymentIntentId, refundId: refund.id, status: refund.status });
  return refund;
}

module.exports = {
  createCheckoutSession,
  verifyWebhookSignature,
  extractRefId,
  extractPaymentIds,
  refundPayment,
};
