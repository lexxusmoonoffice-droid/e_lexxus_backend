const AppError = require('../utils/AppError');
const { Order } = require('../models');

const POPULATE = [
  { path: 'items.product', select: 'title slug thumbnail price brand category', populate: ['brand', 'category'] },
  { path: 'items.bundle', select: 'name slug image bundlePrice modelCount' },
];

async function listMyOrders(userId, query = {}) {
  const filter = { buyer: userId };
  if (query.status) filter.status = query.status;
  return Order.paginate(filter, {
    page: query.page,
    limit: query.limit,
    sort: '-createdAt',
    populate: POPULATE,
  });
}

async function getMyOrder(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, buyer: userId }).populate(POPULATE);
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

module.exports = { listMyOrders, getMyOrder };
