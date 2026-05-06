const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Order, Product, Bundle, User } = require('../../models');
const audit = require('../../services/audit.service');
const paymentService = require('../../services/payment.service');
const email = require('../../services/email.service');

const POPULATE = [
  { path: 'buyer', select: 'name email' },
  { path: 'items.product', select: 'title slug thumbnail' },
  { path: 'items.bundle', select: 'name slug image' },
];

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    filter.$or = [
      { 'billing.email': new RegExp(req.query.q, 'i') },
      { 'billing.name': new RegExp(req.query.q, 'i') },
    ];
  }
  res.json(await Order.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
    populate: POPULATE,
  }));
});

const detail = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(POPULATE);
  if (!order) throw AppError.notFound('Order not found');
  res.json({ order });
});

const patchStatus = asyncHandler(async (req, res) => {
  const before = await Order.findById(req.params.id);
  if (!before) throw AppError.notFound('Order not found');
  const next = req.body.status;

  let order;
  // pending → paid: run the full side-effect chain (issue download token,
  // stamp paidAt, bump product download counts, send receipt + download
  // email, drop notification). Without this the buyer can never download.
  if (before.status === 'pending' && next === 'paid') {
    order = await paymentService.markPaid(before, { manual: true, actor: req.user?._id?.toString() });
  } else if (before.status === 'paid' && next === 'refunded') {
    order = await paymentService.markRefunded(before);
  } else if (before.status === 'pending' && next === 'failed') {
    order = await paymentService.markFailed(before, { manual: true });
  } else {
    order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: { status: next } },
      { new: true },
    );
  }
  await audit.logAction(req, 'order.status', 'Order', order._id, {
    before: { status: before.status },
    after: { status: order.status },
  });
  res.json({ order });
});

const refund = asyncHandler(async (req, res) => {
  const order = await paymentService.refundOrder(req.params.id, { reason: req.body.reason });
  await audit.logAction(req, 'order.refund', 'Order', order._id, {
    after: { status: order.status, reason: req.body.reason },
  });
  res.json({ order });
});

const resendReceipt = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('buyer');
  if (!order) throw AppError.notFound('Order not found');
  await email.sendOrderConfirmationEmail(order.buyer, order);
  await audit.logAction(req, 'order.resendReceipt', 'Order', order._id);
  res.json({ message: 'Receipt emailed' });
});

/**
 * Create a manual pending order for a given buyer. Used for:
 *  - offline / bank-transfer settlements
 *  - comp orders given to reviewers / partners
 *  - local QA without a live payment gateway
 * After creation, the admin can flip the status to `paid` which fires
 * the normal download-token + email pipeline via paymentService.markPaid.
 */
const create = asyncHandler(async (req, res) => {
  const { buyerId, items, billing } = req.body;
  const buyer = await User.findById(buyerId);
  if (!buyer) throw AppError.badRequest('Unknown buyer', 'BAD_BUYER');
  if (!Array.isArray(items) || items.length === 0) {
    throw AppError.badRequest('At least one item is required', 'EMPTY');
  }

  const lineItems = [];
  const creators = new Set();
  let subtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.min(99, Number(it.qty || 1)));
    if (it.productId) {
      const prod = await Product.findById(it.productId);
      if (!prod) throw AppError.badRequest(`Unknown product ${it.productId}`, 'BAD_PRODUCT');
      subtotal += prod.price * qty;
      lineItems.push({ type: 'product', product: prod._id, qty, priceAtPurchase: prod.price, title: prod.title });
      if (prod.creator) creators.add(String(prod.creator));
    } else if (it.bundleId) {
      const b = await Bundle.findById(it.bundleId);
      if (!b) throw AppError.badRequest(`Unknown bundle ${it.bundleId}`, 'BAD_BUNDLE');
      subtotal += b.bundlePrice * qty;
      lineItems.push({ type: 'bundle', bundle: b._id, qty, priceAtPurchase: b.bundlePrice, title: b.name });
    } else {
      throw AppError.badRequest('Each item needs productId or bundleId', 'BAD_ITEM');
    }
  }

  const order = await Order.create({
    buyer: buyer._id,
    items: lineItems,
    creators: [...creators],
    subtotal,
    total: subtotal,
    currency: 'INR',
    status: 'pending',
    billing: {
      name: billing?.name || buyer.name,
      email: billing?.email || buyer.email,
      country: billing?.country || 'IN',
    },
  });
  await audit.logAction(req, 'order.create', 'Order', order._id, { after: { buyer: String(buyer._id), total: subtotal } });
  res.status(201).json({ order });
});

module.exports = { list, detail, create, patchStatus, refund, resendReceipt };
