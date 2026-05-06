/**
 * Tiny factories used across integration tests.
 * Each factory creates and returns a saved doc; callers can pass
 * overrides. IDs are unique per call so tests don't collide.
 */
const { faker } = require('@faker-js/faker');
const {
  Brand,
  BlogPost,
  Bundle,
  Category,
  HeroSlide,
  Product,
  Settings,
  User,
} = require('../../src/models');
const { hashPassword } = require('../../src/utils/password');

async function makeUser(over = {}) {
  return User.create({
    name: over.name || faker.person.fullName(),
    email: over.email || faker.internet.email().toLowerCase(),
    passwordHash: await hashPassword(over.password || 'pa$$word123'),
    role: over.role || 'buyer',
    verified: over.verified !== false,
    status: over.status || 'active',
    ...(over.extra || {}),
  });
}

async function makeCategory(over = {}) {
  return Category.create({
    name: over.name || `Category ${faker.string.uuid().slice(0, 6)}`,
    slug: over.slug,
    parent: over.parent || null,
    status: 'active',
  });
}

async function makeBrand(over = {}) {
  return Brand.create({
    name: over.name || `Brand ${faker.string.uuid().slice(0, 6)}`,
    slug: over.slug,
    status: 'active',
  });
}

async function makeProduct(over = {}) {
  const creator = over.creator || (await makeUser({ role: 'creator' }));
  const category = over.category || (await makeCategory());
  const brand = over.brand || (await makeBrand());
  return Product.create({
    creator: creator._id,
    title: over.title || `Product ${faker.string.uuid().slice(0, 6)}`,
    slug: over.slug,
    description: over.description || 'desc',
    brand: brand._id,
    category: category._id,
    tags: over.tags || ['demo'],
    price: over.price ?? 1000,
    status: over.status || 'published',
    thumbnail: over.thumbnail || 'https://x/y.jpg',
    images: over.images || [],
    fileSizeMb: over.fileSizeMb || 10,
    downloadCount: over.downloadCount || 0,
    likes: over.likes || 0,
    views: over.views || 0,
    ...(over.extra || {}),
  });
}

async function makeBundle(over = {}) {
  const product = over.product || (await makeProduct());
  return Bundle.create({
    name: over.name || `Bundle ${faker.string.uuid().slice(0, 6)}`,
    slug: over.slug,
    description: 'desc',
    image: 'https://x/b.jpg',
    productIds: over.productIds || [product._id],
    bundlePrice: over.bundlePrice ?? 800,
    originalPrice: over.originalPrice ?? 1000,
    status: over.status || 'published',
    ...(over.extra || {}),
  });
}

async function makeBlogPost(over = {}) {
  return BlogPost.create({
    title: over.title || `Post ${faker.string.uuid().slice(0, 6)}`,
    slug: over.slug,
    excerpt: over.excerpt || 'excerpt',
    content: over.content || '<p>Body</p>',
    image: over.image || 'https://x/img.jpg',
    status: over.status || 'published',
    ...(over.extra || {}),
  });
}

async function makeHeroSlide(over = {}) {
  return HeroSlide.create({
    img: 'https://x/h.jpg',
    title: over.title || ['L1', 'L2'],
    sub: 'sub',
    cta: 'CTA',
    href: '/x',
    order: over.order || 0,
    active: over.active !== false,
    ...(over.extra || {}),
  });
}

async function ensureSettings() {
  return Settings.getSettings();
}

module.exports = {
  makeUser,
  makeCategory,
  makeBrand,
  makeProduct,
  makeBundle,
  makeBlogPost,
  makeHeroSlide,
  ensureSettings,
};
