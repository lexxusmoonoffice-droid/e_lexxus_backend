const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { Review, Order, Product } = require('../models');

function toObjectId(v) {
  return v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v);
}

async function listForProduct(productSlug, query = {}) {
  const product = await Product.findOne({ slug: productSlug, status: 'published' }).select('_id');
  if (!product) throw AppError.notFound('Product not found');
  return Review.paginate(
    { product: product._id, status: 'visible' },
    {
      page: query.page,
      limit: query.limit,
      sort: '-createdAt',
      populate: { path: 'user', select: 'name avatar' },
    },
  );
}

async function listMine(userId, query = {}) {
  return Review.paginate(
    { user: toObjectId(userId) },
    {
      page: query.page,
      limit: query.limit,
      sort: '-createdAt',
      populate: { path: 'product', select: 'title slug thumbnail' },
    },
  );
}

/** Recompute and persist (avg, count) for a product after a write. */
async function refreshProductRating(productId) {
  const oid = toObjectId(productId);
  const agg = await Review.aggregate([
    { $match: { product: oid, status: 'visible' } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const { avg = 0, count = 0 } = agg[0] || {};
  await Product.updateOne(
    { _id: productId },
    { $set: { 'rating.avg': Math.round(avg * 10) / 10, 'rating.count': count } },
  );
}

async function create(userId, { productId, rating, comment }) {
  const ownsOrder = await Order.exists({
    buyer: userId,
    status: 'paid',
    'items.product': productId,
  });
  if (!ownsOrder)
    throw AppError.forbidden('You can only review products you have purchased', 'NOT_PURCHASED');

  const existing = await Review.findOne({ product: productId, user: userId });
  if (existing) throw AppError.conflict('You have already reviewed this product', 'REVIEW_EXISTS');

  const review = await Review.create({
    product: productId,
    user: userId,
    rating,
    comment,
    verifiedPurchase: true,
  });
  await refreshProductRating(productId);
  return review;
}

async function update(userId, reviewId, payload) {
  const review = await Review.findById(reviewId);
  if (!review) throw AppError.notFound('Review not found');
  if (review.user.toString() !== userId.toString())
    throw AppError.forbidden('Not your review', 'NOT_OWNER');
  if (payload.rating !== undefined) review.rating = payload.rating;
  if (payload.comment !== undefined) review.comment = payload.comment;
  await review.save();
  await refreshProductRating(review.product);
  return review;
}

async function remove(userId, reviewId) {
  const review = await Review.findById(reviewId);
  if (!review) throw AppError.notFound('Review not found');
  if (review.user.toString() !== userId.toString())
    throw AppError.forbidden('Not your review', 'NOT_OWNER');
  const productId = review.product;
  await review.deleteOne();
  await refreshProductRating(productId);
}

module.exports = { listForProduct, listMine, create, update, remove, refreshProductRating };
