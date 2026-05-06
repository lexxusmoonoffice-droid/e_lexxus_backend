const asyncHandler = require('../../utils/asyncHandler');
const dash = require('../../services/admin.dashboard.service');

const stats = asyncHandler(async (req, res) => {
  res.json(await dash.stats());
});

const revenue = asyncHandler(async (req, res) => {
  res.json({ data: await dash.revenueSeries() });
});

const topCategories = asyncHandler(async (req, res) => {
  res.json({ data: await dash.topCategories() });
});

const recentOrders = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));
  res.json({ data: await dash.recentOrders(limit) });
});

module.exports = { stats, revenue, topCategories, recentOrders };
