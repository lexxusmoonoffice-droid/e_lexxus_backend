const asyncHandler = require('../utils/asyncHandler');
const brandService = require('../services/brand.service');
const productService = require('../services/product.service');

const list = asyncHandler(async (req, res) => {
  res.json(await brandService.listBrands(req.query));
});

const detail = asyncHandler(async (req, res) => {
  const brand = await brandService.getBrandBySlug(req.params.slug);
  const products = await productService.listProducts({ brand: brand.slug, limit: 24 });
  res.json({ brand, products });
});

module.exports = { list, detail };
