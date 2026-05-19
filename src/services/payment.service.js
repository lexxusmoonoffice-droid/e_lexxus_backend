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
  // ── H-1 FIX: atomic check-and-set — prevents duplicate emails on concurrent webhooks ──
  const resolvedProvider = provider || order.payment?.provider || 'zoho';
  const downloadToken   = uuidv4();
  const ttlDays         = appConfig.get('limits.downloadTokenTtlDays') || 30;
  const tokenExpiresAt  = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const limit           = appConfig.get('limits.downloadLimitPerOrder') || 5;

  // Build provider-specific payment field updates.
  const paymentUpdate = {
    'payment.provider': resolvedProvider,
    'payment.method':   method || null,
    'payment.paidAt':   new Date(),
  };

  if (resolvedProvider === 'stripe') {
    if (sessionId) paymentUpdate['payment.stripeSessionId']  = sessionId;
    if (paymentId) paymentUpdate['payment.stripePaymentId']  = paymentId;
  } else if (resolvedProvider === 'razorpay') {
    if (sessionId) paymentUpdate['payment.razorpayOrderId']   = sessionId;
    if (paymentId) paymentUpdate['payment.razorpayPaymentId'] = paymentId;
  } else {
    if (paymentId) paymentUpdate['payment.zohoPaymentId'] = paymentId;
    if (sessionId) paymentUpdate['payment.zohoOrderId']   = sessionId;
  }

  // Atomic: only update if still pending — guards against concurrent webhook delivery.
  const result = await Order.updateOne(
    { _id: order._id, status: { $ne: 'paid' } },
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

  // modifiedCount === 0 means another concurrent request already paid this order.
  if (result.modifiedCount === 0) {
    return Order.findById(order._id).populate('buyer');
  }

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

/* ────────── FX rates (static — Phase 11 will add live API) ────────── */

const FX_RATES = { INR: 1, USD: 0.012 }; // multiply INR by rate → target currency
const SUPPORTED_CURRENCIES = new Set(Object.keys(FX_RATES));

/**
 * Convert an INR amount to the requested currency.
 * @param {number} amountInr  — raw price from DB (always INR)
 * @param {string} currency   — 'INR' | 'USD'
 * @returns {number}          — amount in target currency (decimal major units)
 */
function convertFromInr(amountInr, currency) {
  const rate = FX_RATES[currency] ?? FX_RATES.INR;
  const converted = amountInr * rate;
  // USD → round to 2 decimal places; INR → integer
  return currency === 'INR' ? Math.round(converted) : Math.round(converted * 100) / 100;
}

async function createOrder({ user, billing, ip, userAgent, idempotencyKey, provider: requestedProvider, currency: requestedCurrency }) {
  // Idempotency cache.
  const cacheKey = idempotencyKey ? `idem:create-order:${user._id}:${idempotencyKey}` : null;
  if (cacheKey) {
    const hit = await cache.get(cacheKey);
    if (hit) return hit;
  }

  const { items, subtotal, creators } = await buildItemsFromCart(user._id);

  // Validate and resolve currency.
  // Only INR and USD are accepted. Stripe is the only gateway that supports
  // USD; Razorpay and Zoho always use INR.
  const provider = requestedProvider || getDefaultProvider();
  if (!isProviderEnabled(provider)) {
    throw new AppError(`Payment provider "${provider}" is not enabled`, 503, 'PROVIDER_DISABLED');
  }

  // Stripe supports both INR and USD. Razorpay / Zoho → always INR.
  const allowedCurrency =
    provider === 'stripe' && requestedCurrency === 'USD' ? 'USD' : 'INR';

  // Amount the gateway will actually charge (in the gateway's currency).
  const gatewayAmount = convertFromInr(subtotal, allowedCurrency);

  logger.info('createOrder currency', {
    requestedCurrency,
    allowedCurrency,
    subtotalInr: subtotal,
    gatewayAmount,
    provider,
  });

  // C-1 FIX: use nested object — dot-notation keys are NOT supported in create()
  const order = await Order.create({
    buyer: user._id,
    items,
    creators,
    subtotal,                   // always in INR (our canonical unit)
    total: subtotal,
    currency: allowedCurrency,  // what the customer will be charged in
    status: 'pending',
    billing: {
      name: billing.name || user.name,
      email: billing.email || user.email,
      country: billing.country,
    },
    payment: { provider },
    ipAtCheckout: ip,
    userAgentAtCheckout: userAgent,
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
      result = await _createStripeOrder(order, user, gatewayAmount, allowedCurrency);
    } else if (provider === 'razorpay') {
      result = await _createRazorpayOrder(order, gatewayAmount);
    } else {
      result = await _createZohoOrder(order, user, gatewayAmount);
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

async function _createStripeOrder(order, user, amount, currency = 'INR') {
  // `amount` is already converted to the target currency by createOrder().
  // stripe.service.createCheckoutSession converts it to the smallest unit (paise / cents).
  const session = await stripeService.createCheckoutSession({
    amount,
    currency: currency.toLowerCase(), // stripe expects lowercase iso code
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
 * buyerUserId is passed from the controller (req.user._id).
 */
async function verifyRazorpayPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature, lexxusOrderId, buyerUserId }) {
  // 1. Verify Razorpay HMAC signature first — fast rejection path.
  const valid = razorpayService.verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) {
    throw new AppError('Invalid Razorpay signature', 400, 'INVALID_SIGNATURE');
  }

  // 2. Find the order.
  const order = lexxusOrderId && mongoose.isValidObjectId(lexxusOrderId)
    ? await Order.findById(lexxusOrderId)
    : await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });

  if (!order) throw AppError.notFound('Order not found');

  // C-2 FIX: buyer ownership guard — prevents payment spoofing across users.
  if (buyerUserId && String(order.buyer) !== String(buyerUserId)) {
    throw AppError.forbidden('Order does not belong to you');
  }

  // C-2 FIX: razorpayOrderId cross-check — the stored ID must match the signed ID.
  if (order.payment?.razorpayOrderId && order.payment.razorpayOrderId !== razorpayOrderId) {
    throw new AppError('Razorpay order ID mismatch', 400, 'ORDER_MISMATCH');
  }

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

async function getOrderStatus(user, orderId, { stripeSessionId } = {}) {
  const order = await Order.findOne({ _id: orderId, buyer: user._id });
  if (!order) throw AppError.notFound('Order not found');

  // ── Stripe fallback for local dev (webhooks don't reach localhost) ──
  // If the order is still pending AND we have a Stripe session ID (either
  // stored on the order or passed as a query param from the success URL),
  // verify the session status directly with Stripe and auto-mark as paid.
  if (order.status === 'pending' && order.payment?.provider === 'stripe') {
    const sessionId = stripeSessionId || order.payment?.stripeSessionId;
    if (sessionId) {
      try {
        const session = await stripeService.retrieveSession(sessionId);
        if (session?.payment_status === 'paid') {
          logger.info('stripe: session paid (fallback verify)', { orderId, sessionId });
          await markPaid(order, {
            provider: 'stripe',
            paymentId: session.payment_intent,
            sessionId,
          });
          // Re-fetch the updated order
          const updated = await Order.findById(order._id);
          return {
            id: updated._id.toString(),
            status: updated.status,
            provider: updated.payment?.provider || 'stripe',
            paidAt: updated.payment?.paidAt,
            downloadToken: updated.status === 'paid' ? updated.downloadToken : null,
            tokenExpiresAt: updated.tokenExpiresAt,
          };
        }
      } catch (e) {
        logger.warn('stripe: fallback session verify failed', { err: e.message, sessionId });
      }
    }
  }

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
