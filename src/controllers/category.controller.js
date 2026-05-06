const asyncHandler = require('../utils/asyncHandler');
const productService = require('../services/product.service');
const categoryService = require('../services/category.service');

const tree = asyncHandler(async (req, res) => {
  res.json({ data: await categoryService.getTree() });
});

const detail = asyncHandler(async (req, res) => {
  const { category, children } = await categoryService.getCategoryBySlug(req.params.slug);
  // First page of products in this category, for convenience.
  const products = await productService.listProducts({ category: category.slug, limit: 12 });
  res.json({ category, children, products });
});

module.exports = { tree, detail };
