const asyncHandler = require('../utils/asyncHandler');
const blogService = require('../services/blog.service');

const list = asyncHandler(async (req, res) => {
  res.json(await blogService.listPosts(req.query));
});

const detail = asyncHandler(async (req, res) => {
  res.json({ post: await blogService.getPostBySlug(req.params.slug) });
});

module.exports = { list, detail };
