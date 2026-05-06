/**
 * Verifies that admin mutations invalidate the corresponding public
 * storefront cache entries. We call the storefront endpoint first,
 * mutate via /api/admin/*, then call the storefront again — it must
 * reflect the change immediately.
 */

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const cache = require('../../src/services/cache.service');

setupDB();
const app = buildApp();

beforeEach(() => {
  cache._resetMemory();
});

describe('cache invalidation on admin writes', () => {
  it('products list reflects admin create', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const cat = await f.makeCategory();

    const before = await request(app).get('/api/products');
    expect(before.body.total).toBe(0);

    await request(app)
      .post('/api/admin/products')
      .set('Authorization', bearer(admin))
      .send({
        title: 'Fresh product',
        description: 'd',
        category: cat._id.toString(),
        price: 100,
        status: 'published',
      });

    const after = await request(app).get('/api/products');
    expect(after.body.total).toBe(1);
    expect(after.body.data[0].title).toBe('Fresh product');
  });

  it('categories tree reflects admin create', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const before = await request(app).get('/api/categories');
    expect(before.body.data).toHaveLength(0);

    await request(app)
      .post('/api/admin/categories')
      .set('Authorization', bearer(admin))
      .send({ name: 'Rugs' });

    const after = await request(app).get('/api/categories');
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].slug).toBe('rugs');
  });

  it('hero-slides reflects admin create + toggle', async () => {
    const admin = await f.makeUser({ role: 'admin' });

    const empty = await request(app).get('/api/hero-slides');
    expect(empty.body.data).toHaveLength(0);

    const slide = await request(app)
      .post('/api/admin/hero-slides')
      .set('Authorization', bearer(admin))
      .send({
        img: 'https://x/a.jpg',
        title: ['L1', 'L2'],
        sub: 's',
        cta: 'Go',
        href: '/',
      });

    const withOne = await request(app).get('/api/hero-slides');
    expect(withOne.body.data).toHaveLength(1);

    await request(app)
      .patch(`/api/admin/hero-slides/${slide.body.slide.id}/toggle`)
      .set('Authorization', bearer(admin));
    const afterToggle = await request(app).get('/api/hero-slides');
    // Default active=true → toggle flips to false → excluded from public list.
    expect(afterToggle.body.data).toHaveLength(0);
  });

  it('product detail reflects admin update', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const product = await f.makeProduct({ title: 'Old name', slug: 'test-slug' });

    const before = await request(app).get(`/api/products/${product.slug}`);
    expect(before.body.product.title).toBe('Old name');

    await request(app)
      .put(`/api/admin/products/${product._id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'New name' });

    const after = await request(app).get(`/api/products/${product.slug}`);
    expect(after.body.product.title).toBe('New name');
  });
});
