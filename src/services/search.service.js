/**
 * Global search across published products, bundles, and blog posts.
 * Falls back to a case-insensitive regex when $text returns nothing
 * (e.g. for short prefix matches like "sof" → "sofa").
 */

const { Product, Bundle, BlogPost } = require('../models');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function searchProducts(q, limit) {
  const text = await Product.find({ status: 'published', $text: { $search: q } })
    .select('title slug thumbnail price brand category')
    .populate('brand category')
    .limit(limit);
  if (text.length) return text;
  const re = new RegExp(escapeRegex(q), 'i');
  return Product.find({
    status: 'published',
    $or: [{ title: re }, { tags: re }],
  })
    .select('title slug thumbnail price brand category')
    .populate('brand category')
    .limit(limit);
}

async function searchBundles(q, limit) {
  const re = new RegExp(escapeRegex(q), 'i');
  return Bundle.find({
    status: 'published',
    $or: [{ name: re }, { description: re }, { tag: re }],
  })
    .select('name slug image bundlePrice modelCount tag badge')
    .limit(limit);
}

async function searchBlog(q, limit) {
  const re = new RegExp(escapeRegex(q), 'i');
  return BlogPost.find({
    status: 'published',
    $or: [{ title: re }, { excerpt: re }, { tags: re }],
  })
    .select('title slug image excerpt publishedAt')
    .limit(limit);
}

async function globalSearch(q, limit = 8) {
  const [products, bundles, blog] = await Promise.all([
    searchProducts(q, limit),
    searchBundles(q, Math.ceil(limit / 2)),
    searchBlog(q, Math.ceil(limit / 2)),
  ]);
  return { products, bundles, blog, q };
}

module.exports = { globalSearch };
