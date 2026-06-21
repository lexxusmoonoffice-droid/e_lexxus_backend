const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Product } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');

const POPULATE = ['brand', 'category', 'subCategory'];

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.brand) filter.brand = req.query.brand;
  if (req.query.q) filter.$text = { $search: req.query.q };
  const result = await Product.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: req.query.sort || '-createdAt',
    populate: POPULATE,
  });
  res.json(result);
});

const detail = asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id).populate(POPULATE);
  if (!p) throw AppError.notFound('Product not found');
  res.json({ product: p });
});

const create = asyncHandler(async (req, res) => {
  const product = await Product.create({ ...req.body, creator: req.user._id });
  await audit.logAction(req, 'product.create', 'Product', product._id, { after: product.toJSON() });
  await invalidate.products();
  res.status(201).json({ product });
});

const update = asyncHandler(async (req, res) => {
  const before = await Product.findById(req.params.id);
  if (!before) throw AppError.notFound('Product not found');
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true },
  ).populate(POPULATE);
  await audit.logAction(req, 'product.update', 'Product', product._id, {
    before: before.toJSON(),
    after: product.toJSON(),
  });
  await invalidate.products();
  res.json({ product });
});

const patchStatus = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { status: req.body.status } },
    { new: true },
  );
  if (!product) throw AppError.notFound('Product not found');
  await audit.logAction(req, 'product.status', 'Product', product._id, {
    after: { status: product.status },
  });
  await invalidate.products();
  res.json({ product });
});

const remove = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw AppError.notFound('Product not found');
  await audit.logAction(req, 'product.delete', 'Product', product._id, {
    before: product.toJSON(),
  });
  await invalidate.products();
  res.status(204).end();
});

const bulk = asyncHandler(async (req, res) => {
  const { ids, action } = req.body;
  let result;
  if (action === 'publish') {
    result = await Product.updateMany({ _id: { $in: ids } }, { $set: { status: 'published', publishedAt: new Date() } });
  } else if (action === 'unpublish') {
    result = await Product.updateMany({ _id: { $in: ids } }, { $set: { status: 'draft' } });
  } else if (action === 'delete') {
    result = await Product.deleteMany({ _id: { $in: ids } });
  }
  await audit.logAction(req, `product.bulk.${action}`, 'Product', null, { after: { ids, result } });
  await invalidate.products();
  res.json({ action, affected: result.modifiedCount || result.deletedCount || 0 });
});

module.exports = { list, detail, create, update, patchStatus, remove, bulk };
