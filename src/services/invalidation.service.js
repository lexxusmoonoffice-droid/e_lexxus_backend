/**
 * Named cache-invalidation shortcuts used by admin mutations.
 * Each function bumps the tags the public storefront caches under,
 * so the next read re-queries the DB.
 */

const cache = require('./cache.service');

async function products() {
  // Products change the /products list + detail + featured/trending/new;
  // bundles reference productIds, so also bump bundles to refresh pricing.
  await cache.invalidateMany(['products', 'bundles']);
}

async function bundles() {
  await cache.invalidate('bundles');
}

async function categories() {
  // Products populate category, so invalidate products too.
  await cache.invalidateMany(['categories', 'products']);
}

async function brands() {
  await cache.invalidateMany(['brands', 'products']);
}

async function blog() {
  await cache.invalidate('blog');
}

async function heroSlides() {
  await cache.invalidate('hero-slides');
}

module.exports = { products, bundles, categories, brands, blog, heroSlides };
