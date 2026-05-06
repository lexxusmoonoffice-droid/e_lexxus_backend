const AppError = require('../utils/AppError');
const { Wishlist, Product, Bundle } = require('../models');

const POPULATE = [
  { path: 'productIds', populate: ['brand', 'category'] },
  { path: 'bundleIds' },
];

async function getOrCreate(userId) {
  let w = await Wishlist.findOne({ user: userId });
  if (!w) w = await Wishlist.create({ user: userId, productIds: [], bundleIds: [] });
  return w;
}

async function load(userId) {
  await getOrCreate(userId);
  return Wishlist.findOne({ user: userId }).populate(POPULATE);
}

async function add(userId, { productId, bundleId }) {
  if (productId) {
    const exists = await Product.exists({ _id: productId, status: 'published' });
    if (!exists) throw AppError.notFound('Product not available');
    await Wishlist.updateOne(
      { user: userId },
      { $addToSet: { productIds: productId }, $setOnInsert: { user: userId } },
      { upsert: true },
    );
  } else {
    const exists = await Bundle.exists({ _id: bundleId, status: 'published' });
    if (!exists) throw AppError.notFound('Bundle not available');
    await Wishlist.updateOne(
      { user: userId },
      { $addToSet: { bundleIds: bundleId }, $setOnInsert: { user: userId } },
      { upsert: true },
    );
  }
  return load(userId);
}

async function remove(userId, { type, id }) {
  const field = type === 'product' ? 'productIds' : 'bundleIds';
  await Wishlist.updateOne({ user: userId }, { $pull: { [field]: id } });
  return load(userId);
}

module.exports = { load, add, remove };
