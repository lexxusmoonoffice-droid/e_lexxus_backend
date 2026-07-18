const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { SocialLink } = require('../../models');
const audit = require('../../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const links = await SocialLink.find().sort('order platform');
  res.json({ links });
});

const create = asyncHandler(async (req, res) => {
  const { platform } = req.body;
  const existing = await SocialLink.findOne({ platform: platform.trim().toLowerCase() });
  if (existing) {
    throw AppError.badRequest(`Platform "${platform}" already exists.`);
  }

  const link = await SocialLink.create(req.body);
  await audit.logAction(req, 'socialLink.create', 'SocialLink', link._id, { after: link.toJSON() });
  res.status(201).json({ link });
});

const update = asyncHandler(async (req, res) => {
  const before = await SocialLink.findById(req.params.id);
  if (!before) throw AppError.notFound('Social link not found');

  const link = await SocialLink.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );

  await audit.logAction(req, 'socialLink.update', 'SocialLink', link._id, {
    before: before.toJSON(),
    after: link.toJSON(),
  });
  res.json({ link });
});

const remove = asyncHandler(async (req, res) => {
  const link = await SocialLink.findById(req.params.id);
  if (!link) throw AppError.notFound('Social link not found');

  await link.deleteOne();
  await audit.logAction(req, 'socialLink.delete', 'SocialLink', link._id, { before: link.toJSON() });
  res.status(204).end();
});

module.exports = { list, create, update, remove };
