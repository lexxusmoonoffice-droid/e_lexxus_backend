const AppError = require('../utils/AppError');
const cache = require('./cache.service');
const { BlogPost } = require('../models');

async function listPosts(query = {}) {
  return cache.wrap(
    `list:${query.page || 1}:${query.limit || 20}:${query.tag || ''}`,
    60,
    async () => {
      const filter = { status: 'published' };
      if (query.tag) filter.tags = query.tag;
      return BlogPost.paginate(filter, {
        page: query.page,
        limit: query.limit,
        sort: '-publishedAt -createdAt',
      });
    },
    { tag: 'blog' },
  );
}

async function getPostBySlug(slug) {
  const post = await cache.wrap(
    `slug:${slug}`,
    300,
    async () => BlogPost.findOne({ slug, status: 'published' }),
    { tag: 'blog' },
  );
  if (!post) throw AppError.notFound('Post not found');
  BlogPost.updateOne({ slug, status: 'published' }, { $inc: { viewCount: 1 } }).catch(() => {});
  return post;
}

module.exports = { listPosts, getPostBySlug };
