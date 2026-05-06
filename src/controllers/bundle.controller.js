const asyncHandler = require('../utils/asyncHandler');
const bundleService = require('../services/bundle.service');

const list = asyncHandler(async (req, res) => {
  res.json(await bundleService.listBundles(req.query));
});

const detail = asyncHandler(async (req, res) => {
  res.json({ bundle: await bundleService.getBundleBySlug(req.params.slug) });
});

module.exports = { list, detail };
