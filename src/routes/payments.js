/**
 * Payment routes — multi-provider.
 *
 * Webhook routes use express.raw() so the HMAC can be verified against
 * the raw bytes. Each provider gets its own webhook path.
 *
 * Backward-compat: /webhook still routes to Zoho.
 */

const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/payment.controller');
const v = require('../validators/payment.validator');

const router = express.Router();

/* ── Webhooks (raw body — must come BEFORE any json middleware) ── */
router.post('/webhook',           express.raw({ type: '*/*', limit: '1mb' }), ctrl.webhookZoho);
router.post('/webhook/zoho',      express.raw({ type: '*/*', limit: '1mb' }), ctrl.webhookZoho);
router.post('/webhook/stripe',    express.raw({ type: '*/*', limit: '1mb' }), ctrl.webhookStripe);
router.post('/webhook/razorpay',  express.raw({ type: '*/*', limit: '1mb' }), ctrl.webhookRazorpay);

/* ── Public availability probe ── */
router.get('/available', ctrl.available);

/* ── Authenticated endpoints ── */
router.post(
  '/create-order',
  requireAuth,
  paymentLimiter,
  validate(v.createOrderSchema),
  ctrl.createOrder,
);

router.get(
  '/order/:id/status',
  requireAuth,
  validate(v.orderIdParam, 'params'),
  ctrl.orderStatus,
);

router.post(
  '/order/:id/cancel',
  requireAuth,
  validate(v.orderIdParam, 'params'),
  ctrl.cancelOrder,
);

/* ── Razorpay widget callback verify ── */
router.post(
  '/razorpay/verify',
  requireAuth,
  paymentLimiter,
  validate(v.verifyRazorpaySchema),
  ctrl.verifyRazorpay,
);

module.exports = router;
