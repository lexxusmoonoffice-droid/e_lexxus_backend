const asyncHandler = require('../utils/asyncHandler');
const orderService = require('../services/order.service');

const list = asyncHandler(async (req, res) => {
  res.json(await orderService.listMyOrders(req.user._id, req.query));
});

const detail = asyncHandler(async (req, res) => {
  res.json({ order: await orderService.getMyOrder(req.user._id, req.params.id) });
});

module.exports = { list, detail };
