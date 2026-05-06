/**
 * Admin review moderation.
 *
 *   GET    /api/admin/reviews                   paginated list with filters
 *   PATCH  /api/admin/reviews/:id/status        hide / show
 *   DELETE /api/admin/reviews/:id               hard delete (rare — prefer hide)
 *
 * Every write refreshes the target product's aggregate (avg + count).
 */
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const mongoose = require('mongoose');
const { Review } = require('../../models');
const audit = require('../../services/audit.service');
const reviewService = require('../../services/review.service');

const POPULATE = [
  { path: 'user', select: 'name email avatar' },
  { path: 'product', select: 'title slug thumbnail' },
];

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.product && mongoose.isValidObjectId(req.query.product)) {
    filter.product = req.query.product;
  }
  if (req.query.user && mongoose.isValidObjectId(req.query.user)) {
    filter.user = req.query.user;
  }
  if (req.query.rating) {
    const r = Number(req.query.rating);
    if (r >= 1 && r <= 5) filter.rating = r;
  }
  if (req.query.q) {
    filter.comment = new RegExp(req.query.q, 'i');
  }
  const result = await Review.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
    populate: POPULATE,
  });
  res.json(result);
});

const patchStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (status !== 'visible' && status !== 'hidden') {
    throw AppError.badRequest('status must be "visible" or "hidden"', 'BAD_STATUS');
  }
  const before = await Review.findById(req.params.id);
  if (!before) throw AppError.notFound('Review not found');
  before.status = status;
  await before.save();
  await reviewService.refreshProductRating(before.product);
  await audit.logAction(req, 'review.status', 'Review', before._id, {
    before: { status: before.isModified('status') ? status : before.status },
    after: { status },
  });
  const fresh = await Review.findById(before._id).populate(POPULATE);
  res.json({ review: fresh });
});

const remove = asyncHandler(async (req, res) => {
  const doc = await Review.findById(req.params.id);
  if (!doc) throw AppError.notFound('Review not found');
  const productId = doc.product;
  await doc.deleteOne();
  await reviewService.refreshProductRating(productId);
  await audit.logAction(req, 'review.delete', 'Review', req.params.id, {
    before: { rating: doc.rating, user: String(doc.user), product: String(productId) },
  });
  res.status(204).end();
});

module.exports = { list, patchStatus, remove };
