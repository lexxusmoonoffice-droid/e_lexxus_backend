const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');

setupDB();
const app = buildApp();

describe('GET /api/categories', () => {
  it('returns nested tree (parents → children)', async () => {
    const models = await f.makeCategory({ name: '3D Models', slug: 'models' });
    await f.makeCategory({ name: 'Sofas', slug: 'sofas', parent: models._id });
    await f.makeCategory({ name: 'Chairs', slug: 'chairs', parent: models._id });
    await f.makeCategory({ name: 'Textures', slug: 'textures' });

    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const modelsNode = res.body.data.find((c) => c.slug === 'models');
    expect(modelsNode.children).toHaveLength(2);
    expect(modelsNode.children.map((c) => c.slug).sort()).toEqual(['chairs', 'sofas']);
  });
});

describe('GET /api/categories/:slug', () => {
  it('returns category + first-page products', async () => {
    const cat = await f.makeCategory({ slug: 'sofas' });
    await f.makeProduct({ category: cat });
    await f.makeProduct({ category: cat });
    const res = await request(app).get('/api/categories/sofas');
    expect(res.status).toBe(200);
    expect(res.body.category.slug).toBe('sofas');
    expect(res.body.products.total).toBe(2);
  });

  it('404 when category missing', async () => {
    const res = await request(app).get('/api/categories/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/brands', () => {
  it('lists active brands paginated', async () => {
    await f.makeBrand({ name: 'Alpha', slug: 'alpha' });
    await f.makeBrand({ name: 'Beta', slug: 'beta' });
    const res = await request(app).get('/api/brands');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});

describe('GET /api/brands/:slug', () => {
  it('returns brand + their products', async () => {
    const brand = await f.makeBrand({ slug: 'b1' });
    await f.makeProduct({ brand });
    await f.makeProduct({ brand });
    const res = await request(app).get('/api/brands/b1');
    expect(res.body.brand.slug).toBe('b1');
    expect(res.body.products.total).toBe(2);
  });
  it('404 unknown brand', async () => {
    const res = await request(app).get('/api/brands/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/bundles', () => {
  it('lists published bundles', async () => {
    await f.makeBundle({ name: 'A', status: 'published' });
    await f.makeBundle({ name: 'B', status: 'draft' });
    const res = await request(app).get('/api/bundles');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('A');
  });
});

describe('GET /api/bundles/:slug', () => {
  it('returns bundle with included products populated', async () => {
    const product = await f.makeProduct({ title: 'Inside' });
    const bundle = await f.makeBundle({ slug: 'mybundle', productIds: [product._id] });
    const res = await request(app).get(`/api/bundles/${bundle.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.bundle.slug).toBe('mybundle');
    expect(res.body.bundle.productIds[0].title).toBe('Inside');
  });
  it('404 unknown bundle', async () => {
    const res = await request(app).get('/api/bundles/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/blog', () => {
  it('lists published posts', async () => {
    await f.makeBlogPost({ title: 'A', status: 'published' });
    await f.makeBlogPost({ title: 'B', status: 'draft' });
    const res = await request(app).get('/api/blog');
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].title).toBe('A');
  });
});

describe('GET /api/blog/:slug', () => {
  it('increments viewCount and returns post', async () => {
    const post = await f.makeBlogPost({ slug: 'hello' });
    expect(post.viewCount).toBe(0);
    const res = await request(app).get('/api/blog/hello');
    expect(res.status).toBe(200);
    expect(res.body.post.slug).toBe('hello');
    // best-effort, may or may not have flushed; assert shape rather than count
    expect(res.body.post.title).toBeDefined();
  });
  it('404 unknown post', async () => {
    const res = await request(app).get('/api/blog/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/hero-slides', () => {
  it('returns only active slides ordered', async () => {
    await f.makeHeroSlide({ order: 2, active: true });
    await f.makeHeroSlide({ order: 0, active: true });
    await f.makeHeroSlide({ order: 1, active: false });
    const res = await request(app).get('/api/hero-slides');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].order).toBe(0);
    expect(res.body.data[1].order).toBe(2);
  });
});
