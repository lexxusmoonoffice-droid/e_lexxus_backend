/**
 * Payment service.
 *
 *   createOrder  → builds Order(pending) from cart, hits Zoho, returns paymentUrl.
 *   handleWebhookEvent → idempotent state machine driven by Zoho webhook events.
 *   getOrderStatus / cancelOrder / refundOrder.
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const zoho = require('./zoho.service');
const appConfig = require('./appConfig.service');
const email = require('./email.service');
const { notify } = require('./notification.service');
const { Cart, Order, Product, Bundle } = require('../models');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 h

/* ────────── helpers ────────── */

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

/* ────────── create-order ────────── */

async function createOrder({ user, billing, ip, userAgent, idempotencyKey }) {
  // Idempotency cache — same key returns the same paymentUrl/orderId.
  if (idempotencyKey) {
    const cacheKey = `idem:create-order:${user._id}:${idempotencyKey}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  const { items, subtotal, creators } = await buildItemsFromCart(user._id);
  const total = subtotal; // tax-inclusive; future: discount/tax fields

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
  });

  // ── Dev mock: skip Zoho, mark order paid immediately ──────────────────
  if (env.PAYMENT_MOCK) {
    logger.warn('PAYMENT_MOCK=true — marking order paid without Zoho');
    await markPaid(order, { payment_id: `mock-${order._id}`, method: 'mock' });
    const result = {
      orderId: order._id.toString(),
      paymentUrl: `${env.FRONTEND_URL}/checkout/success?orderId=${order._id}`,
    };
    if (idempotencyKey) {
      const cacheKey = `idem:create-order:${user._id}:${idempotencyKey}`;
      await cache.set(cacheKey, result, IDEMPOTENCY_TTL);
    }
    return result;
  }

  let session;
  try {
    session = await zoho.createCheckoutSession({
      amount: total,
      currency: 'INR',
      description: `Order ${String(order._id)}`,
      referenceId: String(order._id),
      redirectUrl: `${env.FRONTEND_URL}/checkout/success?orderId=${order._id}`,
      cancelUrl: `${env.FRONTEND_URL}/checkout/cancel?orderId=${order._id}`,
      customer: { email: order.billing.email, name: order.billing.name },
    });
  } catch (err) {
    logger.error('zoho.createCheckoutSession failed', { message: err.message });
    // Clean up the pending order so it doesn't clog the buyer's dashboard.
    await Order.deleteOne({ _id: order._id }).catch(() => {});
    if (/credentials not configured/i.test(err.message)) {
      throw new AppError(
        'Payments are not configured yet. Please contact support.',
        503,
        'PAYMENTS_UNAVAILABLE',
      );
    }
    const detail = env.NODE_ENV === 'development' ? ` (${err.message})` : '';
    throw new AppError(
      `We could not start your payment. Please try again.${detail}`,
      502,
      'PAYMENT_GATEWAY_ERROR',
    );
  }

  await Order.updateOne(
    { _id: order._id },
    { $set: { 'payment.zohoOrderId': session.sessionId } },
  );

  const result = { orderId: order._id.toString(), paymentUrl: session.paymentUrl };
  if (idempotencyKey) {
    const cacheKey = `idem:create-order:${user._id}:${idempotencyKey}`;
    await cache.set(cacheKey, result, IDEMPOTENCY_TTL);
  }
  return result;
}

/* ────────── webhook ────────── */

async function markPaid(order, eventPayload) {
  if (order.status === 'paid') return order; // idempotent
  const downloadToken = uuidv4();
  const ttlDays = appConfig.get('limits.downloadTokenTtlDays') || 30;
  const tokenExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const limit = appConfig.get('limits.downloadLimitPerOrder') || 5;

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'paid',
        downloadToken,
        tokenExpiresAt,
        downloadLimit: limit,
        'payment.zohoPaymentId': eventPayload.payment_id || eventPayload.id || null,
        'payment.method': eventPayload.method || null,
        'payment.paidAt': new Date(),
      },
    },
  );

  // Bump downloadCount on every product item (not bundles — those are aggregates).
  const productIds = order.items.filter((i) => i.product).map((i) => i.product);
  if (productIds.length > 0) {
    await Product.updateMany(
      { _id: { $in: productIds } },
      { $inc: { downloadCount: 1 } },
    );
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

async function markFailed(order, eventPayload) {
  if (order.status !== 'pending') return order;
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'failed',
        'payment.zohoPaymentId': eventPayload.payment_id || eventPayload.id || null,
      },
    },
  );
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

async function markRefunded(order) {
  if (order.status === 'refunded') return order;
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'refunded',
        'payment.refundedAt': new Date(),
        downloadToken: null, // revoke
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

/**
 * Extract the Lexxus order reference from a Zoho webhook payload.
 * Zoho nests it differently per event type: payment.* under
 * event_object.payment.reference_number, payment_link.* under
 * event_object.payment_links.reference_id, refund.* requires looking
 * up by payment_id, etc.
 */
function extractRefId(event) {
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

/**
 * Extract a flat payload that markPaid/markFailed can consume — these
 * helpers expect `payment_id` and `id` at the top level, but Zoho nests
 * them inside event_object.payment.
 */
function flattenPaymentPayload(event) {
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

/**
 * Resolve the order linked to a refund event by looking up the
 * payment_id. Refund webhooks don't carry the original reference_number.
 */
async function findOrderByRefundEvent(event) {
  const r = event.event_object?.refund || {};
  const paymentId = r.payment_id;
  if (!paymentId) return null;
  return Order.findOne({ 'payment.zohoPaymentId': paymentId });
}

/**
 * Handle a verified webhook payload. Returns `{ status: 'ok'|'ignored' }`.
 * Supports the full Zoho event matrix:
 *   payment.succeeded / payment.failed
 *   payment_link.paid / payment_link.expired / payment_link.canceled
 *   refund.succeeded / refund.failed
 *   virtual_account.paid / virtual_account.closed
 *   payout.initiated / payout.paid / payout.failed
 */
async function handleWebhookEvent(event) {
  const type = event.event_type || event.type;
  if (!type) return { status: 'ignored', reason: 'no event_type' };

  // Refund events use payment_id, not reference_id, to find the order.
  if (type === 'refund.succeeded' || type === 'refund.processed' || type === 'payment.refunded') {
    const order = await findOrderByRefundEvent(event);
    if (!order) return { status: 'ignored', reason: 'unknown order (refund)' };
    await markRefunded(order);
    return { status: 'ok', orderStatus: 'refunded' };
  }

  if (type === 'refund.failed') {
    // Refund failed — log it but don't change order state. Admin needs to retry.
    return { status: 'ok', note: 'refund.failed logged — admin action required' };
  }

  // Payout events are platform-level, not per-order. Acknowledge and skip.
  if (type.startsWith('payout.')) {
    return { status: 'ok', note: `payout event ${type} acknowledged` };
  }

  // Virtual account close has no order — acknowledge.
  if (type === 'virtual_account.closed') {
    return { status: 'ok', note: 'virtual_account.closed acknowledged' };
  }

  const refId = extractRefId(event);
  if (!refId) return { status: 'ignored', reason: 'no reference_id' };
  if (!mongoose.isValidObjectId(refId)) {
    return { status: 'ignored', reason: 'invalid reference_id' };
  }

  const order = await Order.findById(refId);
  if (!order) return { status: 'ignored', reason: 'unknown order' };

  const payload = flattenPaymentPayload(event);

  switch (type) {
    case 'payment.succeeded':
    case 'payment.success':
    case 'payment.captured':
    case 'payment.completed':
    case 'payment_link.paid':
    case 'virtual_account.paid':
      await markPaid(order, payload);
      return { status: 'ok', orderStatus: 'paid' };
    case 'payment.failed':
    case 'payment.cancelled':
    case 'payment_link.expired':
    case 'payment_link.canceled':
      await markFailed(order, payload);
      return { status: 'ok', orderStatus: 'failed' };
    default:
      return { status: 'ignored', reason: `unknown event ${type}` };
  }
}

/* ────────── status / cancel / refund ────────── */

async function getOrderStatus(user, orderId) {
  const order = await Order.findOne({ _id: orderId, buyer: user._id });
  if (!order) throw AppError.notFound('Order not found');
  return {
    id: order._id.toString(),
    status: order.status,
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
 * Admin manual refund — calls Zoho refunds API then mutates the order.
 * (Wired up by the admin panel in Phase 9.)
 */
async function refundOrder(orderId, { reason } = {}) {
  const order = await Order.findById(orderId);
  if (!order) throw AppError.notFound('Order not found');
  if (order.status !== 'paid') {
    throw AppError.badRequest('Only paid orders can be refunded', 'BAD_STATE');
  }
  const paymentId = order.payment?.zohoPaymentId;
  if (paymentId) {
    await zoho.refundPayment({ paymentId, amount: order.total, reason });
  }
  return markRefunded(order);
}

module.exports = {
  createOrder,
  handleWebhookEvent,
  getOrderStatus,
  cancelPendingOrder,
  refundOrder,
  // exported for tests:
  markPaid,
  markFailed,
  markRefunded,
};
