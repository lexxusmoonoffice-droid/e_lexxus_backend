const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');

setupDB();
const app = buildApp();

describe('GET /api/settings/public', () => {
  it('returns the public subset only', async () => {
    await f.ensureSettings();
    const res = await request(app).get('/api/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe('Lexxus');
    expect(res.body.defaultCurrency).toBe('INR');
    expect(res.body.payments).toEqual({ zoho: true, stripe: false, paypal: false });
  });
});

describe('GET /api/search', () => {
  beforeEach(async () => {
    const cat = await f.makeCategory({ slug: 'sofas' });
    await f.makeProduct({ category: cat, title: 'Velvet Sofa Atlas' });
    await f.makeProduct({ category: cat, title: 'Marble Bath' });
    await f.makeBundle({ name: 'Living Room Sofa Bundle' });
    await f.makeBlogPost({ title: 'Sofa care tips' });
  });

  it('returns matching products + bundles + blog', async () => {
    const res = await request(app).get('/api/search?q=sofa');
    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body.bundles.length).toBeGreaterThan(0);
    expect(res.body.blog.length).toBeGreaterThan(0);
  });

  it('422 when q < 2 chars', async () => {
    const res = await request(app).get('/api/search?q=a');
    expect(res.status).toBe(422);
  });
});

describe('GET /api/currency/rates', () => {
  it('returns base + rates table', async () => {
    const res = await request(app).get('/api/currency/rates');
    expect(res.status).toBe(200);
    expect(res.body.base).toBe('INR');
    expect(res.body.rates.INR).toBe(1);
    expect(res.body.rates.USD).toBeGreaterThan(0);
    expect(res.body.fetchedAt).toBeDefined();
  });
});
