const asyncHandler = require('../utils/asyncHandler');
const paymentService = require('../services/payment.service');
const zoho = require('../services/zoho.service');
const stripeService = require('../services/stripe.service');
const razorpayService = require('../services/razorpay.service');
const appConfig = require('../services/appConfig.service');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/* ────────── public availability probe ────────── */

/**
 * Returns which provider is active and whether it's configured.
 * The checkout page uses this to decide whether to show Pay button.
 * Never exposes credential material.
 */
const available = asyncHandler(async (_req, res) => {
  const env = require('../config/env');
  if (env.PAYMENT_MOCK) {
    return res.json({ enabled: true, provider: 'mock', reason: 'ok' });
  }

  const provider = paymentService.getDefaultProvider();

  if (provider === 'stripe') {
    const sk = appConfig.get('stripe.secretKey');
    const enabled = !!sk && paymentService.isProviderEnabled('stripe');
    return res.json({ enabled, provider: 'stripe', reason: enabled ? 'ok' : 'CREDENTIALS_MISSING' });
  }

  if (provider === 'razorpay') {
    const keyId = appConfig.get('razorpay.keyId');
    const keySecret = appConfig.get('razorpay.keySecret');
    const enabled = !!(keyId && keySecret) && paymentService.isProviderEnabled('razorpay');
    return res.json({
      enabled,
      provider: 'razorpay',
      reason: enabled ? 'ok' : 'CREDENTIALS_MISSING',
      // Public keyId is safe to expose — needed by frontend widget.
      ...(enabled ? { keyId } : {}),
    });
  }

  // Default: Zoho
  const z = appConfig.get('zoho') || {};
  const ready = !!(z.clientId && z.clientSecret && z.refreshToken);
  return res.json({
    enabled: ready,
    provider: 'zoho',
    reason: ready
      ? 'ok'
      : !z.clientId || !z.clientSecret
        ? 'CREDENTIALS_MISSING'
        : 'NOT_CONNECTED',
  });
});

/* ────────── create-order ────────── */

const createOrder = asyncHandler(async (req, res) => {
  const out = await paymentService.createOrder({
    user: req.user,
    billing: req.body.billing,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    idempotencyKey: req.headers['idempotency-key'] || req.headers['x-idempotency-key'],
    provider: req.body.provider || null,   // optional override; defaults to appConfig
    currency: req.body.currency || 'INR',  // 'INR' | 'USD' — auto-detected by frontend
  });
  res.status(201).json(out);
});

/* ────────── order status / cancel ────────── */

const orderStatus = asyncHandler(async (req, res) => {
  // session_id is appended by Stripe to the success_url redirect.
  // Pass it through so getOrderStatus can verify the session directly
  // when webhooks can't reach localhost (local dev fallback).
  const stripeSessionId = req.query.session_id || null;
  res.json(await paymentService.getOrderStatus(req.user, req.params.id, { stripeSessionId }));
});

const cancelOrder = asyncHandler(async (req, res) => {
  await paymentService.cancelPendingOrder(req.user, req.params.id);
  res.json({ message: 'Cancelled' });
});

/* ────────── Zoho webhook ────────── */

const webhookZoho = asyncHandler(async (req, res) => {
  const signature =
    req.headers['x-zoho-signature'] ||
    req.headers['x-webhook-signature'] ||
    req.headers['x-signature'];

  const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!raw) throw AppError.badRequest('No raw body available', 'NO_BODY');

  const ok = await zoho.verifyWebhookSignature(raw, signature);
  if (!ok) {
    logger.warn('zoho webhook: bad signature', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' });
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { throw AppError.badRequest('Invalid JSON in webhook body', 'BAD_JSON'); }

  const result = await paymentService.handleZohoWebhookEvent(event);
  res.status(200).json(result);
});

/* Backward-compat alias — /api/payments/webhook still routes to Zoho */
const webhook = webhookZoho;

/* ────────── Stripe webhook ────────── */

const webhookStripe = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!raw) throw AppError.badRequest('No raw body available', 'NO_BODY');

  let event;
  try {
    event = stripeService.verifyWebhookSignature(raw, signature);
  } catch (err) {
    logger.warn('stripe webhook: bad signature', { ip: req.ip, err: err.message });
    return res.status(401).json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' });
  }

  const result = await paymentService.handleStripeWebhookEvent(event);
  res.status(200).json(result);
});

/* ────────── Razorpay webhook ────────── */

const webhookRazorpay = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!raw) throw AppError.badRequest('No raw body available', 'NO_BODY');

  const ok = razorpayService.verifyWebhookSignature(raw, signature);
  if (!ok) {
    logger.warn('razorpay webhook: bad signature', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' });
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { throw AppError.badRequest('Invalid JSON in webhook body', 'BAD_JSON'); }

  const result = await paymentService.handleRazorpayWebhookEvent(event);
  res.status(200).json(result);
});

/* ────────── Razorpay client-side verify ────────── */

/**
 * POST /api/payments/razorpay/verify
 * Called by the frontend after the Razorpay widget succeeds.
 * Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId }
 */
const verifyRazorpay = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;
  const result = await paymentService.verifyRazorpayPayment({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    lexxusOrderId: orderId,
    buyerUserId: req.user._id, // C-2 FIX: pass buyer for ownership check
  });
  res.json(result);
});

module.exports = {
  available,
  createOrder,
  orderStatus,
  cancelOrder,
  webhook,
  webhookZoho,
  webhookStripe,
  webhookRazorpay,
  verifyRazorpay,
};
