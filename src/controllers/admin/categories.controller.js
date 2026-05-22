const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Category, Product } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');

const list = asyncHandler(async (req, res) => {
  const result = await Category.paginate({}, {
    page: req.query.page,
    limit: req.query.limit,
    sort: 'order name',
  });
  res.json(result);
});

const detail = asyncHandler(async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) throw AppError.notFound('Category not found');
  res.json({ category: c });
});

const create = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  await audit.logAction(req, 'category.create', 'Category', category._id, { after: category.toJSON() });
  await invalidate.categories();
  res.status(201).json({ category });
});

const update = asyncHandler(async (req, res) => {
  const before = await Category.findById(req.params.id);
  if (!before) throw AppError.notFound('Category not found');
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  await audit.logAction(req, 'category.update', 'Category', category._id, {
    before: before.toJSON(),
    after: category.toJSON(),
  });
  await invalidate.categories();
  res.json({ category });
});

const remove = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw AppError.notFound('Category not found');

  const childCount = await Category.countDocuments({ parent: category._id });
  if (childCount > 0) {
    throw AppError.badRequest(`Cannot delete — this category has ${childCount} subcategori${childCount === 1 ? 'y' : 'es'}. Remove them first.`);
  }

  const productCount = await Product.countDocuments({ $or: [{ category: category._id }, { subCategory: category._id }] });
  if (productCount > 0) {
    throw AppError.badRequest(`Cannot delete — ${productCount} product${productCount === 1 ? ' is' : 's are'} assigned to this category.`);
  }

  await category.deleteOne();
  await audit.logAction(req, 'category.delete', 'Category', category._id, { before: category.toJSON() });
  await invalidate.categories();
  res.status(204).end();
});

module.exports = { list, detail, create, update, remove };
