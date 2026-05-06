const asyncHandler = require('../utils/asyncHandler');
const paymentService = require('../services/payment.service');
const zoho = require('../services/zoho.service');
const appConfig = require('../services/appConfig.service');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Public health probe for the payment gateway — used by the checkout
 * page to decide whether to enable the "Pay" button. Returns only the
 * boolean + a reason code, never any credential material.
 */
const available = asyncHandler(async (_req, res) => {
  const env = require('../config/env');
  if (env.PAYMENT_MOCK) {
    return res.json({ enabled: true, provider: 'mock', reason: 'ok' });
  }
  const z = appConfig.get('zoho') || {};
  const ready = !!(z.clientId && z.clientSecret && z.refreshToken);
  res.json({
    enabled: ready,
    provider: 'zoho',
    reason: ready
      ? 'ok'
      : !z.clientId || !z.clientSecret
        ? 'CREDENTIALS_MISSING'
        : 'NOT_CONNECTED',
  });
});

const createOrder = asyncHandler(async (req, res) => {
  const out = await paymentService.createOrder({
    user: req.user,
    billing: req.body.billing,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    idempotencyKey: req.headers['idempotency-key'] || req.headers['x-idempotency-key'],
  });
  res.status(201).json(out);
});

const orderStatus = asyncHandler(async (req, res) => {
  res.json(await paymentService.getOrderStatus(req.user, req.params.id));
});

const cancelOrder = asyncHandler(async (req, res) => {
  await paymentService.cancelPendingOrder(req.user, req.params.id);
  res.json({ message: 'Cancelled' });
});

/**
 * Zoho webhook receiver.
 * - Mounted with raw-body capture (see app.js).
 * - Verifies HMAC before parsing JSON.
 * - Always returns 200 on signature failure path? NO — return 401 so
 *   Zoho retries (they retry on 4xx-non-401 too; we use 401 for the
 *   clear "rejected" signal).
 */
const webhook = asyncHandler(async (req, res) => {
  const signature =
    req.headers['x-zoho-signature'] ||
    req.headers['x-webhook-signature'] ||
    req.headers['x-signature'];

  const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!raw) {
    throw AppError.badRequest('No raw body available', 'NO_BODY');
  }

  const ok = await zoho.verifyWebhookSignature(raw, signature);
  if (!ok) {
    logger.warn('zoho webhook: bad signature', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    throw AppError.badRequest('Invalid JSON in webhook body', 'BAD_JSON');
  }

  const result = await paymentService.handleWebhookEvent(event);
  // Always 200 once verified — prevents Zoho from retrying ad infinitum
  // for events we deliberately ignore.
  res.status(200).json(result);
});

module.exports = { createOrder, orderStatus, cancelOrder, webhook, available };
