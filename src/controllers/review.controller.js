const asyncHandler = require('../utils/asyncHandler');
const reviewService = require('../services/review.service');

const listForProduct = asyncHandler(async (req, res) => {
  res.json(await reviewService.listForProduct(req.params.slug, req.query));
});

const listMine = asyncHandler(async (req, res) => {
  res.json(await reviewService.listMine(req.user._id, req.query));
});

const create = asyncHandler(async (req, res) => {
  const review = await reviewService.create(req.user._id, req.body);
  res.status(201).json({ review });
});

const update = asyncHandler(async (req, res) => {
  const review = await reviewService.update(req.user._id, req.params.id, req.body);
  res.json({ review });
});

const remove = asyncHandler(async (req, res) => {
  await reviewService.remove(req.user._id, req.params.id);
  res.status(204).end();
});

module.exports = { listForProduct, listMine, create, update, remove };
