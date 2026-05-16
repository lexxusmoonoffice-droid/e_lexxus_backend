/**
 * Payment service — provider-agnostic router.
 *
 * Supported providers: zoho | stripe | razorpay
 *
 * createOrder       → picks the active provider, creates a pending Order,
 *                     calls the right gateway, returns paymentUrl (or
 *                     razorpayOrder details for the widget flow).
 * verifyRazorpayPayment → server-side HMAC verify for the Razorpay widget.
 * handleZohoWebhookEvent    → idempotent state machine for Zoho events.
 * handleStripeWebhookEvent  → idempotent state machine for Stripe events.
 * handleRazorpayWebhookEvent → idempotent state machine for Razorpay events.
 * getOrderStatus / cancelPendingOrder / refundOrder.
 *
 * markPaid / markFailed / markRefunded are exported for tests and
 * provider webhook handlers.
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const zoho = require('./zoho.service');
const stripeService = require('./stripe.service');
const razorpayService = require('./razorpay.service');
const appConfig = require('./appConfig.service');
const email = require('./email.service');
const { notify } = require('./notification.service');
const { Cart, Order, Product, Bundle } = require('../models');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 h

/* ────────── provider availability ────────── */

function getDefaultProvider() {
  return appConfig.get('payments.defaultProvider') || 'zoho';
}

function isProviderEnabled(provider) {
  switch (provider) {
    case 'zoho':      return appConfig.get('payments.zohoEnabled')      !== false;
    case 'stripe':    return appConfig.get('payments.stripeEnabled')    === true;
    case 'razorpay':  return appConfig.get('payments.razorpayEnabled')  === true;
    default:          return false;
  }
}

/* ────────── cart helpers ────────── */

async function buildItemsFromCart(userId) {
  const cart = await Cart.findOne({ user: userId }).populate(['items.product', 'items.bundle']);
  if (!cart || cart.items.length === 0) {
    throw AppError.badRequest('Cart is empty', 'EMPTY_CART');
  }

  const items = [];
  const creators = new Set();
  let subtotal = 0;
  for (const it of cart.items) {
    if (it.product) {
      if (it.product.status !== 'published') {
        throw AppError.badRequest(`"${it.product.title}" is no longer available`, 'PRODUCT_GONE');
      }
      const lineTotal = it.product.price * it.qty;
      subtotal += lineTotal;
      items.push({
        type: 'product',
        product: it.product._id,
        qty: it.qty,
        priceAtPurchase: it.product.price,
        title: it.product.title,
      });
      creators.add(String(it.product.creator));
    } else if (it.bundle) {
      if (it.bundle.status !== 'published') {
        throw AppError.badRequest(`Bundle "${it.bundle.name}" is no longer available`, 'BUNDLE_GONE');
      }
      const lineTotal = it.bundle.bundlePrice * it.qty;
      subtotal += lineTotal;
      items.push({
        type: 'bundle',
        bundle: it.bundle._id,
        qty: it.qty,
        priceAtPurchase: it.bundle.bundlePrice,
        title: it.bundle.name,
      });
    }
  }
  return { items, subtotal, creators: [...creators] };
}

/* ────────── order state helpers ────────── */

/**
 * Mark an order as paid. Provider-agnostic.
 * @param {object} order  - Mongoose Order document (pre-loaded).
 * @param {object} opts
 * @param {string} opts.provider         - 'zoho' | 'stripe' | 'razorpay'
 * @param {string} [opts.paymentId]      - Provider-specific payment ID.
 * @param {string} [opts.sessionId]      - Provider-specific session/order ID (Stripe/Razorpay).
 * @param {string} [opts.method]         - Payment method label (optional).
 */
async function markPaid(order, { provider, paymentId, sessionId, method } = {}) {
  if (order.status === 'paid') return order; // idempotent

  const downloadToken = uuidv4();
  const ttlDays = appConfig.get('limits.downloadTokenTtlDays') || 30;
  const tokenExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const limit = appConfig.get('limits.downloadLimitPerOrder') || 5;

  // Build provider-specific payment field updates.
  const paymentUpdate = {
    'payment.provider': provider || 'zoho',
    'payment.method': method || null,
    'payment.paidAt': new Date(),
  };

  if (provider === 'stripe') {
    if (sessionId)  paymentUpdate['payment.stripeSessionId']  = sessionId;
    if (paymentId)  paymentUpdate['payment.stripePaymentId']  = paymentId;
  } else if (provider === 'razorpay') {
    if (sessionId)  paymentUpdate['payment.razorpayOrderId']   = sessionId;
    if (paymentId)  paymentUpdate['payment.razorpayPaymentId'] = paymentId;
  } else {
    // Zoho (default — keep backward-compat field names)
    if (paymentId)  paymentUpdate['payment.zohoPaymentId'] = paymentId;
    if (sessionId)  paymentUpdate['payment.zohoOrderId']   = sessionId;
  }

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'paid',
        downloadToken,
        tokenExpiresAt,
        downloadLimit: limit,
        ...paymentUpdate,
      },
    },
  );

  // Bump downloadCount on product items.
  const productIds = order.items.filter((i) => i.product).map((i) => i.product);
  if (productIds.length > 0) {
    await Product.updateMany({ _id: { $in: productIds } }, { $inc: { downloadCount: 1 } });
  }

  const fresh = await Order.findById(order._id).populate('buyer');
  await email.sendOrderConfirmationEmail(fresh.buyer, fresh).catch(() => {});
  await email.sendDownloadEmail(fresh.buyer, fresh, downloadToken).catch(() => {});
  await notify(fresh.buyer._id, {
    type: 'order.paid',
    title: 'Payment received',
    body: `Order ${String(fresh._id).slice(-8).toUpperCase()} is paid — your downloads are ready.`,
    link: `/account/orders/${fresh._id}`,
  });
  return fresh;
}

/**
 * Mark an order as failed. Provider-agnostic.
 */
async function markFailed(order, { provider, paymentId } = {}) {
  if (order.status !== 'pending') return order;

  const paymentUpdate = { 'payment.provider': provider || order.payment?.provider || 'zoho' };
  if (provider === 'stripe')   paymentUpdate['payment.stripePaymentId']  = paymentId || null;
  else if (provider === 'razorpay') paymentUpdate['payment.razorpayPaymentId'] = paymentId || null;
  else paymentUpdate['payment.zohoPaymentId'] = paymentId || null;

  await Order.updateOne({ _id: order._id }, { $set: { status: 'failed', ...paymentUpdate } });

  const fresh = await Order.findById(order._id).populate('buyer');
  await email.sendPaymentFailedEmail(fresh.buyer, fresh).catch(() => {});
  await notify(fresh.buyer._id, {
    type: 'order.failed',
    title: 'Payment failed',
    body: `Payment for order ${String(fresh._id).slice(-8).toUpperCase()} failed.`,
    link: `/account/orders/${fresh._id}`,
  });
  return fresh;
}

/**
 * Mark an order as refunded. Provider-agnostic.
 */
async function markRefunded(order) {
  if (order.status === 'refunded') return order;
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'refunded',
        'payment.refundedAt': new Date(),
        downloadToken: null,
        tokenExpiresAt: null,
      },
    },
  );
  const fresh = await Order.findById(order._id).populate('buyer');
  await email.sendRefundEmail(fresh.buyer, fresh).catch(() => {});
  await notify(fresh.buyer._id, {
    type: 'order.refunded',
    title: 'Refund processed',
    body: `Order ${String(fresh._id).slice(-8).toUpperCase()} has been refunded.`,
    link: `/account/orders/${fresh._id}`,
  });
  return fresh;
}

/* ────────── create-order (provider router) ────────── */

async function createOrder({ user, billing, ip, userAgent, idempotencyKey, provider: requestedProvider }) {
  // Idempotency cache.
  const cacheKey = idempotencyKey ? `idem:create-order:${user._id}:${idempotencyKey}` : null;
  if (cacheKey) {
    const hit = await cache.get(cacheKey);
    if (hit) return hit;
  }

  const { items, subtotal, creators } = await buildItemsFromCart(user._id);
  const total = subtotal;

  // Determine provider: caller may request one; fall back to configured default.
  const provider = requestedProvider || getDefaultProvider();
  if (!isProviderEnabled(provider)) {
    throw new AppError(`Payment provider "${provider}" is not enabled`, 503, 'PROVIDER_DISABLED');
  }

  const order = await Order.create({
    buyer: user._id,
    items,
    creators,
    subtotal,
    total,
    currency: 'INR',
    status: 'pending',
    billing: {
      name: billing.name || user.name,
      email: billing.email || user.email,
      country: billing.country,
    },
    ipAtCheckout: ip,
    userAgentAtCheckout: userAgent,
    'payment.provider': provider,
  });

  // ── Dev mock: skip all gateways, mark order paid immediately ──────────
  if (env.PAYMENT_MOCK) {
    logger.warn('PAYMENT_MOCK=true — marking order paid without gateway');
    await markPaid(order, { provider, paymentId: `mock-${order._id}`, method: 'mock' });
    const result = {
      orderId: order._id.toString(),
      paymentUrl: `${env.FRONTEND_URL}/checkout/success?orderId=${order._id}`,
      provider: 'mock',
    };
    if (cacheKey) await cache.set(cacheKey, result, IDEMPOTENCY_TTL);
    return result;
  }

  let result;
  try {
    if (provider === 'stripe') {
      result = await _createStripeOrder(order, user, total);
    } else if (provider === 'razorpay') {
      result = await _createRazorpayOrder(order, total);
    } else {
      result = await _createZohoOrder(order, user, total);
    }
  } catch (err) {
    logger.error(`${provider}.createOrder failed`, { message: err.message });
    await Order.deleteOne({ _id: order._id }).catch(() => {});
    if (/not configured/i.test(err.message)) {
      throw new AppError('Payments are not configured yet. Please contact support.', 503, 'PAYMENTS_UNAVAILABLE');
    }
    const detail = env.NODE_ENV === 'development' ? ` (${err.message})` : '';
    throw new AppError(`We could not start your payment. Please try again.${detail}`, 502, 'PAYMENT_GATEWAY_ERROR');
  }

  if (cacheKey) await cache.set(cacheKey, result, IDEMPOTENCY_TTL);
  return result;
}

async function _createZohoOrder(order, user, total) {
  const session = await zoho.createCheckoutSession({
    amount: total,
    currency: 'INR',
    description: `Order ${String(order._id)}`,
    referenceId: String(order._id),
    redirectUrl: `${env.FRONTEND_URL}/checkout/success?orderId=${order._id}`,
    cancelUrl: `${env.FRONTEND_URL}/checkout/cancel?orderId=${order._id}`,
    customer: { email: order.billing.email, name: order.billing.name },
  });
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.zohoOrderId': session.sessionId } });
  return { orderId: order._id.toString(), paymentUrl: session.paymentUrl, provider: 'zoho' };
}

async function _createStripeOrder(order, user, total) {
  const session = await stripeService.createCheckoutSession({
    amount: total,
    description: `Order ${String(order._id)}`,
    referenceId: String(order._id),
    redirectUrl: `${env.FRONTEND_URL}/checkout/success?orderId=${order._id}`,
    cancelUrl: `${env.FRONTEND_URL}/checkout/cancel?orderId=${order._id}`,
    customer: { email: order.billing.email, name: order.billing.name },
  });
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.stripeSessionId': session.sessionId } });
  return { orderId: order._id.toString(), paymentUrl: session.paymentUrl, provider: 'stripe' };
}

async function _createRazorpayOrder(order, total) {
  const rzpOrder = await razorpayService.createOrder({
    amount: total,
    referenceId: String(order._id),
    description: `Order ${String(order._id)}`,
  });
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.razorpayOrderId': rzpOrder.razorpayOrderId } });
  // For Razorpay widget flow: no redirect URL — frontend opens the widget.
  return {
    orderId: order._id.toString(),
    paymentUrl: null, // widget flow — frontend handles UI
    provider: 'razorpay',
    razorpay: {
      orderId: rzpOrder.razorpayOrderId,
      keyId: rzpOrder.keyId,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
    },
  };
}

/* ────────── Razorpay widget verify endpoint ────────── */

/**
 * Verify the Razorpay widget callback and mark the order paid.
 * Called by POST /api/payments/razorpay/verify.
 */
async function verifyRazorpayPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature, lexxusOrderId }) {
  const valid = razorpayService.verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) {
    throw new AppError('Invalid Razorpay signature', 400, 'INVALID_SIGNATURE');
  }

  // Find order by lexxusOrderId (passed from frontend) or by razorpayOrderId stored on the order.
  const order = lexxusOrderId && mongoose.isValidObjectId(lexxusOrderId)
    ? await Order.findById(lexxusOrderId)
    : await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });

  if (!order) throw AppError.notFound('Order not found');
  if (order.status === 'paid') return { status: 'ok', orderId: order._id.toString(), alreadyPaid: true };

  await markPaid(order, {
    provider: 'razorpay',
    paymentId: razorpayPaymentId,
    sessionId: razorpayOrderId,
  });

  return { status: 'ok', orderId: order._id.toString() };
}

/* ────────── Zoho webhook event handler ────────── */

function _zohoExtractRefId(event) {
  if (event.reference_id) return event.reference_id;
  if (event.data?.reference_id) return event.data.reference_id;
  const obj = event.event_object || {};
  return (
    obj.payment?.reference_number ||
    obj.payment?.reference_id ||
    obj.payment_links?.reference_id ||
    obj.payment_links?.reference_number ||
    obj.virtual_account?.reference_number ||
    null
  );
}

function _zohoFlattenPayload(event) {
  const p = event.event_object?.payment || event.event_object?.payment_links?.payments?.[0] || {};
  return {
    payment_id: p.payment_id || p.id || event.payment_id,
    id: p.payment_id || p.id || event.id,
    amount: p.amount || p.amount_paid,
    currency: p.currency,
    status: p.status,
    ...event,
  };
}

async function _zohoFindOrderByRefundEvent(event) {
  const r = event.event_object?.refund || {};
  const paymentId = r.payment_id;
  if (!paymentId) return null;
  return Order.findOne({ 'payment.zohoPaymentId': paymentId });
}

async function handleZohoWebhookEvent(event) {
  const type = event.event_type || event.type;
  if (!type) return { status: 'ignored', reason: 'no event_type' };

  if (type === 'refund.succeeded' || type === 'refund.processed' || type === 'payment.refunded') {
    const order = await _zohoFindOrderByRefundEvent(event);
    if (!order) return { status: 'ignored', reason: 'unknown order (refund)' };
    await markRefunded(order);
    return { status: 'ok', orderStatus: 'refunded' };
  }
  if (type === 'refund.failed') {
    return { status: 'ok', note: 'refund.failed logged — admin action required' };
  }
  if (type.startsWith('payout.')) {
    return { status: 'ok', note: `payout event ${type} acknowledged` };
  }
  if (type === 'virtual_account.closed') {
    return { status: 'ok', note: 'virtual_account.closed acknowledged' };
  }

  const refId = _zohoExtractRefId(event);
  if (!refId) return { status: 'ignored', reason: 'no reference_id' };
  if (!mongoose.isValidObjectId(refId)) return { status: 'ignored', reason: 'invalid reference_id' };

  const order = await Order.findById(refId);
  if (!order) return { status: 'ignored', reason: 'unknown order' };
  const payload = _zohoFlattenPayload(event);

  switch (type) {
    case 'payment.succeeded':
    case 'payment.success':
    case 'payment.captured':
    case 'payment.completed':
    case 'payment_link.paid':
    case 'virtual_account.paid':
      await markPaid(order, {
        provider: 'zoho',
        paymentId: payload.payment_id || payload.id || null,
        method: payload.method || null,
      });
      return { status: 'ok', orderStatus: 'paid' };
    case 'payment.failed':
    case 'payment.cancelled':
    case 'payment_link.expired':
    case 'payment_link.canceled':
      await markFailed(order, {
        provider: 'zoho',
        paymentId: payload.payment_id || payload.id || null,
      });
      return { status: 'ok', orderStatus: 'failed' };
    default:
      return { status: 'ignored', reason: `unknown event ${type}` };
  }
}

/* Keep backward-compatible alias for existing route files. */
const handleWebhookEvent = handleZohoWebhookEvent;

/* ────────── Stripe webhook event handler ────────── */

async function handleStripeWebhookEvent(event) {
  const type = event.type;
  if (!type) return { status: 'ignored', reason: 'no event type' };

  const refId = stripeService.extractRefId(event);
  const ids   = stripeService.extractPaymentIds(event);

  switch (type) {
    case 'checkout.session.completed': {
      if (!refId || !mongoose.isValidObjectId(refId)) {
        return { status: 'ignored', reason: 'no/invalid lexxusOrderId in metadata' };
      }
      const order = await Order.findById(refId);
      if (!order) return { status: 'ignored', reason: 'unknown order' };
      await markPaid(order, {
        provider: 'stripe',
        paymentId: ids.stripePaymentId,
        sessionId: ids.stripeSessionId,
      });
      return { status: 'ok', orderStatus: 'paid' };
    }
    case 'checkout.session.expired': {
      if (!refId || !mongoose.isValidObjectId(refId)) {
        return { status: 'ignored', reason: 'no/invalid lexxusOrderId in metadata' };
      }
      const order = await Order.findById(refId);
      if (!order) return { status: 'ignored', reason: 'unknown order' };
      await markFailed(order, { provider: 'stripe', paymentId: ids.stripePaymentId });
      return { status: 'ok', orderStatus: 'failed' };
    }
    case 'charge.refunded': {
      // Find order by stripePaymentId stored on the order.
      const paymentIntentId = event.data?.object?.payment_intent;
      if (!paymentIntentId) return { status: 'ignored', reason: 'no payment_intent in charge.refunded' };
      const order = await Order.findOne({ 'payment.stripePaymentId': paymentIntentId });
      if (!order) return { status: 'ignored', reason: 'unknown order (refund)' };
      await markRefunded(order);
      return { status: 'ok', orderStatus: 'refunded' };
    }
    default:
      return { status: 'ignored', reason: `unhandled stripe event ${type}` };
  }
}

/* ────────── Razorpay webhook event handler ────────── */

async function handleRazorpayWebhookEvent(event) {
  const event_name = event.event;
  if (!event_name) return { status: 'ignored', reason: 'no event name' };

  const refId = razorpayService.extractRefId(event);
  const ids   = razorpayService.extractPaymentIds(event);

  switch (event_name) {
    case 'payment.captured': {
      if (!refId || !mongoose.isValidObjectId(refId)) {
        return { status: 'ignored', reason: 'no/invalid lexxusOrderId in notes' };
      }
      const order = await Order.findById(refId);
      if (!order) return { status: 'ignored', reason: 'unknown order' };
      await markPaid(order, {
        provider: 'razorpay',
        paymentId: ids.razorpayPaymentId,
        sessionId: ids.razorpayOrderId,
      });
      return { status: 'ok', orderStatus: 'paid' };
    }
    case 'payment.failed': {
      if (!refId || !mongoose.isValidObjectId(refId)) {
        return { status: 'ignored', reason: 'no/invalid lexxusOrderId in notes' };
      }
      const order = await Order.findById(refId);
      if (!order) return { status: 'ignored', reason: 'unknown order' };
      await markFailed(order, { provider: 'razorpay', paymentId: ids.razorpayPaymentId });
      return { status: 'ok', orderStatus: 'failed' };
    }
    case 'refund.processed':
    case 'refund.speed_changed': {
      const paymentId = event.payload?.refund?.entity?.payment_id;
      if (!paymentId) return { status: 'ignored', reason: 'no payment_id in refund event' };
      const order = await Order.findOne({ 'payment.razorpayPaymentId': paymentId });
      if (!order) return { status: 'ignored', reason: 'unknown order (refund)' };
      await markRefunded(order);
      return { status: 'ok', orderStatus: 'refunded' };
    }
    default:
      return { status: 'ignored', reason: `unhandled razorpay event ${event_name}` };
  }
}

/* ────────── status / cancel / refund ────────── */

async function getOrderStatus(user, orderId) {
  const order = await Order.findOne({ _id: orderId, buyer: user._id });
  if (!order) throw AppError.notFound('Order not found');
  return {
    id: order._id.toString(),
    status: order.status,
    provider: order.payment?.provider || null,
    paidAt: order.payment?.paidAt,
    downloadToken: order.status === 'paid' ? order.downloadToken : null,
    tokenExpiresAt: order.tokenExpiresAt,
  };
}

async function cancelPendingOrder(user, orderId) {
  const order = await Order.findOne({ _id: orderId, buyer: user._id });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status !== 'pending') {
    throw AppError.badRequest(`Cannot cancel an order in state "${order.status}"`, 'BAD_STATE');
  }
  order.status = 'cancelled';
  await order.save();
  return order;
}

/**
 * Admin manual refund — routes to the correct provider's refund API
 * based on the provider stored on the order.
 */
async function refundOrder(orderId, { reason } = {}) {
  const order = await Order.findById(orderId);
  if (!order) throw AppError.notFound('Order not found');
  if (order.status !== 'paid') {
    throw AppError.badRequest('Only paid orders can be refunded', 'BAD_STATE');
  }

  const provider = order.payment?.provider || 'zoho';

  if (provider === 'stripe') {
    const paymentIntentId = order.payment?.stripePaymentId;
    if (paymentIntentId) {
      await stripeService.refundPayment({ paymentIntentId, amount: order.total, reason });
    }
  } else if (provider === 'razorpay') {
    const paymentId = order.payment?.razorpayPaymentId;
    if (paymentId) {
      await razorpayService.refundPayment({ paymentId, amount: order.total, notes: reason });
    }
  } else {
    // Zoho (default)
    const paymentId = order.payment?.zohoPaymentId;
    if (paymentId) {
      await zoho.refundPayment({ paymentId, amount: order.total, reason });
    }
  }

  return markRefunded(order);
}

module.exports = {
  createOrder,
  verifyRazorpayPayment,
  handleWebhookEvent,            // backward-compat alias → zoho
  handleZohoWebhookEvent,
  handleStripeWebhookEvent,
  handleRazorpayWebhookEvent,
  getOrderStatus,
  cancelPendingOrder,
  refundOrder,
  // exported for tests:
  markPaid,
  markFailed,
  markRefunded,
  getDefaultProvider,
  isProviderEnabled,
};
