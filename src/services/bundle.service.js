const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { Bundle } = require('../models');

async function listBundles(query = {}) {
  return cache.wrap(
    `list:${query.page || 1}:${query.limit || 20}`,
    300,
    async () =>
      Bundle.paginate(
        { status: 'published' },
        {
          page: query.page,
          limit: query.limit,
          sort: '-publishedAt -createdAt',
        },
      ),
    { tag: 'bundles' },
  );
}

async function getBundleBySlug(slug) {
  const bundle = await cache.wrap(
    `slug:${slug}`,
    300,
    async () =>
      Bundle.findOne({ slug, status: 'published' }).populate({
        path: 'productIds',
        populate: ['brand', 'category'],
      }),
    { tag: 'bundles' },
  );
  if (!bundle) throw AppError.notFound('Bundle not found');
  return bundle;
}

module.exports = { listBundles, getBundleBySlug };
