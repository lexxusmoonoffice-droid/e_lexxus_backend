const asyncHandler = require('../utils/asyncHandler');
const productService = require('../services/product.service');

const list = asyncHandler(async (req, res) => {
  const result = await productService.listProducts(req.query);
  res.json(result);
});

const detail = asyncHandler(async (req, res) => {
  const { product, related } = await productService.getProductBySlug(req.params.slug);
  res.json({ product, related });
});

const featured = asyncHandler(async (req, res) => {
  res.json({ data: await productService.getFeatured(req.query.limit || 12) });
});

const trending = asyncHandler(async (req, res) => {
  res.json({ data: await productService.getTrending(req.query.limit || 12) });
});

const newArrivals = asyncHandler(async (req, res) => {
  res.json({ data: await productService.getNewArrivals(req.query.limit || 12) });
});

module.exports = { list, detail, featured, trending, newArrivals };
