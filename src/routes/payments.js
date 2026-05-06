/**
 * Payment routes.
 *
 * NB: the `/webhook` route is registered with its own `express.raw()`
 * body parser **inside** this router because the global `express.json()`
 * in app.js consumes the body before we get a chance at the raw bytes.
 * The HMAC must verify against the original bytes Zoho sent.
 */

const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/payment.controller');
const v = require('../validators/payment.validator');

const router = express.Router();

// Webhook FIRST (raw body); skip auth + json parsing.
router.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), ctrl.webhook);

// Public availability probe — the checkout page hits this to decide
// whether to show the Pay button or a "temporarily unavailable" card.
router.get('/available', ctrl.available);

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

module.exports = router;
