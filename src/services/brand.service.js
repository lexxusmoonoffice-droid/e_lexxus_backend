const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { Brand } = require('../models');

async function listBrands(query = {}) {
  return cache.wrap(
    `list:${query.page || 1}:${query.limit || 20}`,
    3600,
    async () =>
      Brand.paginate(
        { status: 'active' },
        { page: query.page, limit: query.limit, sort: 'name' },
      ),
    { tag: 'brands' },
  );
}

async function getBrandBySlug(slug) {
  const brand = await cache.wrap(
    `slug:${slug}`,
    300,
    async () => Brand.findOne({ slug, status: 'active' }),
    { tag: 'brands' },
  );
  if (!brand) throw AppError.notFound('Brand not found');
  return brand;
}

module.exports = { listBrands, getBrandBySlug };
