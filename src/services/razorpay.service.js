/**
 * Razorpay service — Order creation + client-side widget + signature verification.
 *
 * Flow (different from Zoho/Stripe):
 *   1. createOrder → creates a Razorpay order, returns { razorpayOrderId, keyId, amount, currency }
 *   2. Frontend opens the Razorpay checkout widget with these details.
 *   3. On success the widget gives the browser: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *   4. Frontend POSTs these to /api/payments/razorpay/verify
 *   5. Server calls verifyPaymentSignature → marks order paid if valid.
 *   6. Razorpay also fires webhooks — verifyWebhookSignature guards that path.
 *
 * Credentials are read from appConfig (DB wins, .env fallback).
 */

const crypto  = require('crypto');
const logger  = require('../config/logger');
const appConfig = require('./appConfig.service');

/* ────────── helpers ────────── */

function getRazorpay() {
  const keyId     = appConfig.get('razorpay.keyId');
  const keySecret = appConfig.get('razorpay.keySecret');
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not configured (set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in .env)');
  }
  // eslint-disable-next-line global-require
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function getCurrency() {
  return (appConfig.get('razorpay.currency') || 'INR').toUpperCase();
}

/* ────────── Order creation ────────── */

/**
 * Create a Razorpay order (step 1 in the widget flow).
 * @param {object} opts
 * @param {number} opts.amount       - Amount in rupees (decimal). Converted to paise internally.
 * @param {string} [opts.currency]   - ISO 4217 uppercase, defaults to appConfig setting.
 * @param {string} opts.referenceId  - Lexxus Order._id stored in receipt for traceability.
 * @param {string} [opts.description] - Short description stored in notes.
 * @returns {{ razorpayOrderId, keyId, amount, currency, receipt }}
 */
async function createOrder({ amount, currency, referenceId, description }) {
  const rzp = getRazorpay();
  const cur = (currency || getCurrency()).toUpperCase();
  // Razorpay amounts are in smallest currency unit (paise for INR).
  const paise = Math.round(amount * 100);

  const order = await rzp.orders.create({
    amount: paise,
    currency: cur,
    receipt: referenceId,             // max 40 chars; Lexxus ObjectId is 24 chars — fine
    notes: {
      lexxusOrderId: referenceId,
      description: description || 'Lexxus purchase',
    },
  });

  logger.info('razorpay.createOrder', { razorpayOrderId: order.id, paise, cur });

  return {
    razorpayOrderId: order.id,
    keyId: appConfig.get('razorpay.keyId'), // public key — safe to send to browser
    amount: paise,
    currency: cur,
    receipt: order.receipt,
  };
}

/* ────────── Signature verification (widget callback) ────────── */

/**
 * Verify the signature returned by the Razorpay widget after payment.
 * Called server-side on the /verify endpoint.
 *
 * Razorpay generates:
 *   HMAC-SHA256( razorpay_order_id + "|" + razorpay_payment_id, keySecret )
 *
 * @returns {boolean} true if signature is valid
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const keySecret = appConfig.get('razorpay.keySecret');
  if (!keySecret) throw new Error('Razorpay key secret not configured');

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');

  if (!razorpaySignature || expected.length !== razorpaySignature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature));
  } catch {
    return false;
  }
}

/* ────────── Webhook signature ────────── */

/**
 * Verify a Razorpay webhook signature.
 * `rawBody` must be raw Buffer (no JSON.parse).
 * `signature` is the `x-razorpay-signature` header value.
 *
 * Razorpay signs with: HMAC-SHA256(rawBody, webhookSecret)
 *
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  const webhookSecret = appConfig.get('razorpay.webhookSecret');
  if (!webhookSecret) {
    logger.warn('Razorpay webhook secret not configured — rejecting webhook');
    return false;
  }
  if (!signature || typeof signature !== 'string') return false;

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/* ────────── Extract Order reference from webhook event ────────── */

/**
 * Extract the Lexxus order ID from a Razorpay webhook event.
 * payment.captured / payment.failed: event.payload.payment.entity.notes.lexxusOrderId
 * order.paid: event.payload.order.entity.notes.lexxusOrderId
 */
function extractRefId(event) {
  const paymentEntity = event.payload?.payment?.entity || {};
  const orderEntity   = event.payload?.order?.entity   || {};
  return (
    paymentEntity.notes?.lexxusOrderId ||
    orderEntity.notes?.lexxusOrderId   ||
    paymentEntity.receipt               || // fallback: receipt = orderId
    orderEntity.receipt                 ||
    null
  );
}

/**
 * Extract Razorpay payment IDs from a webhook event for storage.
 */
function extractPaymentIds(event) {
  const p = event.payload?.payment?.entity || {};
  return {
    razorpayOrderId:   p.order_id   || null,
    razorpayPaymentId: p.id         || null,
  };
}

/* ────────── Refunds ────────── */

/**
 * Refund a Razorpay payment.
 * @param {string} paymentId - The razorpay payment ID (pay_xxx)
 * @param {number} amount    - Amount in rupees (decimal)
 * @param {string} [notes]   - Optional refund notes
 */
async function refundPayment({ paymentId, amount, notes }) {
  const rzp = getRazorpay();
  const paise = Math.round(amount * 100);
  const refund = await rzp.payments.refund(paymentId, {
    amount: paise,
    speed: 'normal',
    ...(notes ? { notes: { reason: notes } } : {}),
  });
  logger.info('razorpay.refundPayment', { paymentId, refundId: refund.id, status: refund.status });
  return refund;
}

module.exports = {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  extractRefId,
  extractPaymentIds,
  refundPayment,
};
