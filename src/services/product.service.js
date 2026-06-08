/**
 * Product service — read-side queries used by public storefront APIs.
 * (Mutations live in admin.controller / Phase 9.)
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { Product, Category, Brand } = require('../models');

function hashQuery(q = {}) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(q))
    .digest('hex')
    .slice(0, 12);
}

const SORT_MAP = {
  newest: '-publishedAt -createdAt',
  oldest: 'publishedAt createdAt',
  price_asc: 'price',
  price_desc: '-price',
  popular: '-likes -views',
  trending: '-downloadCount -views',
};

function isObjectId(s) {
  return mongoose.isValidObjectId(s);
}

/** Resolve a category or brand identifier (slug or ObjectId) to its _id. */
async function resolveRefId(Model, value) {
  if (!value) return null;
  if (isObjectId(value)) return value;
  const doc = await Model.findOne({ slug: String(value).toLowerCase() }).select('_id');
  return doc ? doc._id : null;
}

async function buildFilter(query) {
  const filter = { status: 'published' };

  if (query.category) {
    const id = await resolveRefId(Category, query.category);
    if (!id) return { ...filter, _id: { $exists: false } }; // no match
    // Include descendants so /models?category=models returns products
    // whose category is sofas/chairs/etc. (children of "models").
    const childIds = await Category.find({ parent: id }).select('_id');
    const ids = [id, ...childIds.map((c) => c._id)];
    filter.category = ids.length > 1 ? { $in: ids } : id;
  }
  if (query.subCategory) {
    const id = await resolveRefId(Category, query.subCategory);
    if (id) {
      // Match both storage formats:
      //   New: product.subCategory = id  (category field = parent)
      //   Old: product.category    = id  (subCategory field = null/unset)
      filter.$or = [{ subCategory: id }, { category: id }];
    }
  }
  if (query.brand) {
    const id = await resolveRefId(Brand, query.brand);
    if (!id) return { ...filter, _id: { $exists: false } };
    filter.brand = id;
  }
  if (query.tags) {
    filter.tags = { $in: String(query.tags).split(',').map((t) => t.trim()).filter(Boolean) };
  }
  if (query.priceMin != null || query.priceMax != null) {
    filter.price = {};
    if (query.priceMin != null) filter.price.$gte = Number(query.priceMin);
    if (query.priceMax != null) filter.price.$lte = Number(query.priceMax);
  }
  if (query.free === true) filter.isFree = true;
  if (query.q) {
    const q = String(query.q).trim();
    // Try $text first (covers indexed fields). Caller can OR a regex if too few hits.
    filter.$text = { $search: q };
  }
  return filter;
}

const POPULATE = ['brand', 'category'];

async function listProducts(query = {}) {
  return cache.wrap(
    `list:${hashQuery(query)}`,
    60,
    async () => {
      const filter = await buildFilter(query);
      const sort = SORT_MAP[query.sort] || SORT_MAP.newest;
      return Product.paginate(filter, {
        page: query.page,
        limit: query.limit,
        sort,
        populate: POPULATE,
      });
    },
    { tag: 'products' },
  );
}

async function getProductBySlug(slug) {
  const cached = await cache.wrap(
    `detail:${slug}`,
    300,
    async () => {
      const product = await Product.findOne({ slug, status: 'published' }).populate(POPULATE);
      if (!product) return null;
      const related = await Product.find({
        _id: { $ne: product._id },
        status: 'published',
        $or: [{ brand: product.brand }, { category: product.category }],
      })
        .sort('-publishedAt')
        .limit(6)
        .populate(POPULATE);
      return { product, related };
    },
    { tag: 'products' },
  );
  if (!cached) throw AppError.notFound('Product not found');

  // Best-effort view increment — not part of the cached payload.
  Product.updateOne({ slug, status: 'published' }, { $inc: { views: 1 } }).catch(() => {});

  return cached;
}

async function getFeatured(limit = 12) {
  return cache.wrap(
    `featured:${limit}`,
    60,
    async () =>
      Product.find({ status: 'published' })
        .sort(SORT_MAP.popular)
        .limit(limit)
        .populate(POPULATE),
    { tag: 'products' },
  );
}

async function getTrending(limit = 12) {
  return cache.wrap(
    `trending:${limit}`,
    60,
    async () =>
      Product.find({ status: 'published' })
        .sort(SORT_MAP.trending)
        .limit(limit)
        .populate(POPULATE),
    { tag: 'products' },
  );
}

async function getNewArrivals(limit = 12) {
  return cache.wrap(
    `new:${limit}`,
    60,
    async () =>
      Product.find({ status: 'published' })
        .sort(SORT_MAP.newest)
        .limit(limit)
        .populate(POPULATE),
    { tag: 'products' },
  );
}

module.exports = {
  listProducts,
  getProductBySlug,
  getFeatured,
  getTrending,
  getNewArrivals,
  SORT_MAP,
};
