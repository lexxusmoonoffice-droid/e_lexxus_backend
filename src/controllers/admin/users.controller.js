const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { User, Order } = require('../../models');
const audit = require('../../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.role) filter.role = req.query.role;
  if (req.query.q) {
    filter.$or = [
      { name: new RegExp(req.query.q, 'i') },
      { email: new RegExp(req.query.q, 'i') },
    ];
  }
  res.json(await User.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
  }));
});

const detail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');
  const [orderCount, spentAgg] = await Promise.all([
    Order.countDocuments({ buyer: user._id, status: 'paid' }),
    Order.aggregate([
      { $match: { buyer: user._id, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
  ]);
  res.json({
    user,
    stats: {
      orders: orderCount,
      spent: spentAgg[0]?.total || 0,
    },
  });
});

const patchStatus = asyncHandler(async (req, res) => {
  const before = await User.findById(req.params.id);
  if (!before) throw AppError.notFound('User not found');
  if (String(before._id) === String(req.user._id)) {
    throw AppError.badRequest('You cannot change your own status', 'SELF_GUARD');
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { status: req.body.status } },
    { new: true },
  );
  await audit.logAction(req, 'user.status', 'User', user._id, {
    before: { status: before.status },
    after: { status: user.status },
  });
  res.json({ user });
});

const ordersForUser = asyncHandler(async (req, res) => {
  res.json(await Order.paginate({ buyer: req.params.id }, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
  }));
});

module.exports = { list, detail, patchStatus, ordersForUser };
