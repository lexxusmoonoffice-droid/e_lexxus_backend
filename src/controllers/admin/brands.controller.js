const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Brand } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');
const storage = require('../../services/storageCleanup.service');

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.name = new RegExp(req.query.q, 'i');
  res.json(await Brand.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: 'name',
  }));
});

const detail = asyncHandler(async (req, res) => {
  const b = await Brand.findById(req.params.id);
  if (!b) throw AppError.notFound('Brand not found');
  res.json({ brand: b });
});

const create = asyncHandler(async (req, res) => {
  const brand = await Brand.create(req.body);
  await audit.logAction(req, 'brand.create', 'Brand', brand._id, { after: brand.toJSON() });
  await invalidate.brands();
  res.status(201).json({ brand });
});

const update = asyncHandler(async (req, res) => {
  const before = await Brand.findById(req.params.id);
  if (!before) throw AppError.notFound('Brand not found');
  const brand = await Brand.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  await audit.logAction(req, 'brand.update', 'Brand', brand._id, { before: before.toJSON(), after: brand.toJSON() });
  await invalidate.brands();
  res.json({ brand });
});

const remove = asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) throw AppError.notFound('Brand not found');
  await Promise.allSettled([
    storage.deleteSingleImage(brand.logo),
    storage.deleteSingleImage(brand.hero),
  ]);
  await brand.deleteOne();
  await audit.logAction(req, 'brand.delete', 'Brand', brand._id, { before: brand.toJSON() });
  await invalidate.brands();
  res.status(204).end();
});

module.exports = { list, detail, create, update, remove };
