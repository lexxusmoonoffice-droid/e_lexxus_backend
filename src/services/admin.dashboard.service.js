/**
 * Admin dashboard aggregations.
 *
 *   stats()             revenue + orders + customers + products, with MoM deltas
 *   revenueSeries()     12 months of paid-revenue totals
 *   topCategories()     top 4 by paid sales
 *   recentOrders(n)     last N paid/ pending/ refunded orders
 */

const { Order, User, Product } = require('../models');

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function deltaPct(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

async function sumPaidBetween(start, end) {
  const res = await Order.aggregate([
    {
      $match: {
        status: 'paid',
        'payment.paidAt': { $gte: start, ...(end ? { $lt: end } : {}) },
      },
    },
    { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
  ]);
  return res[0] || { total: 0, count: 0 };
}

async function stats() {
  const now = new Date();
  const thisMonth = startOfMonth(now);
  const lastMonth = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [curR, prevR, totalRevenue, totalOrders, customers, products] = await Promise.all([
    sumPaidBetween(thisMonth),
    sumPaidBetween(lastMonth, thisMonth),
    Order.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]).then((r) => (r[0] ? r[0].total : 0)),
    Order.countDocuments({ status: 'paid' }),
    User.countDocuments({ role: 'buyer' }),
    Product.countDocuments({ status: 'published' }),
  ]);

  return {
    revenue: {
      total: totalRevenue,
      month: curR.total,
      deltaPct: deltaPct(curR.total, prevR.total),
    },
    orders: {
      total: totalOrders,
      month: curR.count,
      deltaPct: deltaPct(curR.count, prevR.count),
    },
    customers: { total: customers },
    products: { total: products },
  };
}

async function revenueSeries() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rows = await Order.aggregate([
    { $match: { status: 'paid', 'payment.paidAt': { $gte: start } } },
    {
      $group: {
        _id: {
          y: { $year: '$payment.paidAt' },
          m: { $month: '$payment.paidAt' },
        },
        total: { $sum: '$total' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Build a map for quick lookup then emit 12 consecutive months
  // (fills gaps with zero so the chart has a stable shape).
  const byKey = new Map(rows.map((r) => [`${r._id.y}-${r._id.m}`, r]));
  const series = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const row = byKey.get(key);
    series.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString('en', { month: 'short' }),
      total: row?.total || 0,
      count: row?.count || 0,
    });
  }
  return series;
}

async function topCategories(limit = 4) {
  const rows = await Order.aggregate([
    { $match: { status: 'paid' } },
    { $unwind: '$items' },
    { $match: { 'items.type': 'product', 'items.product': { $ne: null } } },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'p',
      },
    },
    { $unwind: '$p' },
    {
      $group: {
        _id: '$p.category',
        sales: { $sum: { $multiply: ['$items.qty', '$items.priceAtPurchase'] } },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: '_id',
        foreignField: '_id',
        as: 'c',
      },
    },
    { $unwind: '$c' },
    { $sort: { sales: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        categoryId: '$_id',
        name: '$c.name',
        slug: '$c.slug',
        sales: 1,
        count: 1,
      },
    },
  ]);
  const total = rows.reduce((s, r) => s + r.sales, 0) || 1;
  return rows.map((r) => ({ ...r, pct: Math.round((r.sales / total) * 100) }));
}

async function recentOrders(limit = 5) {
  return Order.find({})
    .sort('-createdAt')
    .limit(limit)
    .populate({ path: 'buyer', select: 'name email' });
}

module.exports = { stats, revenueSeries, topCategories, recentOrders };
