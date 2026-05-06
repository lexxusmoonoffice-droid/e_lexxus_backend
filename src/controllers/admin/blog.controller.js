const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { BlogPost } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.title = new RegExp(req.query.q, 'i');
  res.json(await BlogPost.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
  }));
});

const detail = asyncHandler(async (req, res) => {
  const p = await BlogPost.findById(req.params.id);
  if (!p) throw AppError.notFound('Post not found');
  res.json({ post: p });
});

const create = asyncHandler(async (req, res) => {
  const post = await BlogPost.create({
    ...req.body,
    author: req.user._id,
    authorName: req.body.authorName || req.user.name,
  });
  await audit.logAction(req, 'blog.create', 'BlogPost', post._id, { after: post.toJSON() });
  await invalidate.blog();
  res.status(201).json({ post });
});

const update = asyncHandler(async (req, res) => {
  const before = await BlogPost.findById(req.params.id);
  if (!before) throw AppError.notFound('Post not found');
  const post = await BlogPost.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  await audit.logAction(req, 'blog.update', 'BlogPost', post._id, { before: before.toJSON(), after: post.toJSON() });
  await invalidate.blog();
  res.json({ post });
});

const remove = asyncHandler(async (req, res) => {
  const post = await BlogPost.findByIdAndDelete(req.params.id);
  if (!post) throw AppError.notFound('Post not found');
  await audit.logAction(req, 'blog.delete', 'BlogPost', post._id, { before: post.toJSON() });
  await invalidate.blog();
  res.status(204).end();
});

module.exports = { list, detail, create, update, remove };
