const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Bundle } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');
const storage = require('../../services/storageCleanup.service');

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.name = new RegExp(req.query.q, 'i');
  const result = await Bundle.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
  });
  res.json(result);
});

const detail = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id).populate('productIds');
  if (!bundle) throw AppError.notFound('Bundle not found');
  res.json({ bundle });
});

const create = asyncHandler(async (req, res) => {
  const bundle = await Bundle.create(req.body);
  await audit.logAction(req, 'bundle.create', 'Bundle', bundle._id, { after: bundle.toJSON() });
  await invalidate.bundles();
  res.status(201).json({ bundle });
});

const update = asyncHandler(async (req, res) => {
  const before = await Bundle.findById(req.params.id);
  if (!before) throw AppError.notFound('Bundle not found');
  const bundle = await Bundle.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  await audit.logAction(req, 'bundle.update', 'Bundle', bundle._id, {
    before: before.toJSON(),
    after: bundle.toJSON(),
  });
  await invalidate.bundles();
  res.json({ bundle });
});

const remove = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) throw AppError.notFound('Bundle not found');
  await storage.deleteBundleFiles(bundle);
  await bundle.deleteOne();
  await audit.logAction(req, 'bundle.delete', 'Bundle', bundle._id, { before: bundle.toJSON() });
  await invalidate.bundles();
  res.status(204).end();
});

module.exports = { list, detail, create, update, remove };
