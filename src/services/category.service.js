const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { Category, Product } = require('../models');

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

      // Real product counts — one aggregation, no stale denormalized field.
      const counts = await Product.aggregate([
        { $match: { status: 'published' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      const countMap = new Map(counts.map((r) => [r._id.toString(), r.count]));

      return (byParent.get('root') || []).map((top) => ({
        ...top,
        id: top._id.toString(),
        productCount: countMap.get(top._id.toString()) || 0,
        children: (byParent.get(top._id.toString()) || []).map((sub) => ({
          ...sub,
          id: sub._id.toString(),
          productCount: countMap.get(sub._id.toString()) || 0,
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

/**
 * Returns the full category tree augmented with up to 4 product thumbnails per
 * subcategory — used by the frontend header mega-menu.
 * Cached 10 minutes; busted on any category or product invalidation.
 */
async function getTreeWithPreviews() {
  return cache.wrap(
    'tree-previews',
    600,
    async () => {
      const all = await Category.find({ status: 'active' }).sort('order name').lean();
      const byParent = new Map();
      all.forEach((c) => {
        const k = c.parent ? c.parent.toString() : 'root';
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k).push(c);
      });

      const roots = byParent.get('root') || [];

      // Fetch preview products for all subcategories in one query.
      const subIds = all.filter((c) => c.parent).map((c) => c._id);
      const previewProducts = subIds.length
        ? await Product.find({ category: { $in: subIds }, status: 'published' })
            .select('category title thumbnail price')
            .sort('-publishedAt')
            .lean()
        : [];

      const previewsByCategory = new Map();
      for (const p of previewProducts) {
        const k = p.category.toString();
        if (!previewsByCategory.has(k)) previewsByCategory.set(k, []);
        const arr = previewsByCategory.get(k);
        if (arr.length < 4) arr.push(p);
      }

      return roots.map((top) => ({
        ...top,
        id: top._id.toString(),
        children: (byParent.get(top._id.toString()) || []).map((sub) => ({
          ...sub,
          id: sub._id.toString(),
          previews: previewsByCategory.get(sub._id.toString()) || [],
        })),
      }));
    },
    { tag: 'categories' },
  );
}

module.exports = { getTree, getCategoryBySlug, getTreeWithPreviews };
