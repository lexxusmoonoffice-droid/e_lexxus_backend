const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { Category } = require('../models');

async function getTree() {
  return cache.wrap(
    'tree',
    3600,
    async () => {
      const all = await Category.find({ status: 'active' }).sort('order name').lean();
      const byParent = new Map();
      all.forEach((c) => {
        const k = c.parent ? c.parent.toString() : 'root';
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k).push(c);
      });
      return (byParent.get('root') || []).map((top) => ({
        ...top,
        id: top._id.toString(),
        children: (byParent.get(top._id.toString()) || []).map((sub) => ({
          ...sub,
          id: sub._id.toString(),
        })),
      }));
    },
    { tag: 'categories' },
  );
}

async function getCategoryBySlug(slug) {
  const cached = await cache.wrap(
    `slug:${slug}`,
    300,
    async () => {
      const category = await Category.findOne({ slug, status: 'active' });
      if (!category) return null;
      const children = await Category.find({ parent: category._id, status: 'active' }).sort(
        'order name',
      );
      return { category, children };
    },
    { tag: 'categories' },
  );
  if (!cached) throw AppError.notFound('Category not found');
  return cached;
}

module.exports = { getTree, getCategoryBySlug };
