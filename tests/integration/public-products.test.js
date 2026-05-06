const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');

setupDB();
const app = buildApp();

describe('GET /api/products', () => {
  it('returns paginated published products only (drafts excluded)', async () => {
    const cat = await f.makeCategory({ name: 'Sofas', slug: 'sofas' });
    const brand = await f.makeBrand({ name: 'Villevenete', slug: 'villevenete' });
    await f.makeProduct({ category: cat, brand, status: 'published', title: 'P1' });
    await f.makeProduct({ category: cat, brand, status: 'published', title: 'P2' });
    await f.makeProduct({ category: cat, brand, status: 'draft', title: 'P3' });

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((p) => p.status === 'published')).toBe(true);
    expect(res.body.data[0].brand.name).toBe('Villevenete');
  });

  it('filters by category slug', async () => {
    const sofas = await f.makeCategory({ name: 'Sofas', slug: 'sofas' });
    const desks = await f.makeCategory({ name: 'Desks', slug: 'desks' });
    await f.makeProduct({ category: sofas, title: 'A' });
    await f.makeProduct({ category: desks, title: 'B' });

    const res = await request(app).get('/api/products?category=sofas');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].title).toBe('A');
  });

  it('filters by brand slug', async () => {
    const v = await f.makeBrand({ name: 'V', slug: 'v' });
    const w = await f.makeBrand({ name: 'W', slug: 'w' });
    await f.makeProduct({ brand: v, title: 'X' });
    await f.makeProduct({ brand: w, title: 'Y' });

    const res = await request(app).get('/api/products?brand=v');
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].title).toBe('X');
  });

  it('filters by price range and free flag', async () => {
    await f.makeProduct({ title: 'cheap', price: 100 });
    await f.makeProduct({ title: 'mid', price: 1000 });
    await f.makeProduct({ title: 'expensive', price: 5000 });
    await f.makeProduct({ title: 'free-1', price: 0 });

    const range = await request(app).get('/api/products?priceMin=500&priceMax=2000');
    expect(range.body.total).toBe(1);
    expect(range.body.data[0].title).toBe('mid');

    const free = await request(app).get('/api/products?free=true');
    expect(free.body.total).toBe(1);
    expect(free.body.data[0].isFree).toBe(true);
  });

  it('sort=price_asc / price_desc', async () => {
    await f.makeProduct({ title: 'a', price: 300 });
    await f.makeProduct({ title: 'b', price: 100 });
    await f.makeProduct({ title: 'c', price: 200 });

    const asc = await request(app).get('/api/products?sort=price_asc');
    expect(asc.body.data.map((p) => p.price)).toEqual([100, 200, 300]);

    const desc = await request(app).get('/api/products?sort=price_desc');
    expect(desc.body.data.map((p) => p.price)).toEqual([300, 200, 100]);
  });

  it('paginates correctly', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await f.makeProduct({ title: `P${i}` });
    }
    const res = await request(app).get('/api/products?limit=2&page=2');
    expect(res.body.total).toBe(5);
    expect(res.body.pages).toBe(3);
    expect(res.body.page).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  it('422 when limit > 100', async () => {
    const res = await request(app).get('/api/products?limit=9999');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/products/:slug', () => {
  it('returns product + related (same category or brand, excludes self)', async () => {
    const cat = await f.makeCategory({ slug: 'sofas' });
    const brand = await f.makeBrand({ slug: 'v' });
    const otherCat = await f.makeCategory({ slug: 'desks' });
    const main = await f.makeProduct({ category: cat, brand, slug: 'main' });
    await f.makeProduct({ category: cat, brand, slug: 'rel-cat' });
    await f.makeProduct({ category: otherCat, brand, slug: 'rel-brand' });
    await f.makeProduct({ category: otherCat, slug: 'unrelated' });

    const res = await request(app).get(`/api/products/${main.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.product.slug).toBe('main');
    const slugs = res.body.related.map((r) => r.slug);
    expect(slugs).toEqual(expect.arrayContaining(['rel-cat', 'rel-brand']));
    expect(slugs).not.toContain('main');
  });

  it('404 on unknown slug', async () => {
    const res = await request(app).get('/api/products/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('404 on draft (unpublished)', async () => {
    const p = await f.makeProduct({ slug: 'draft-x', status: 'draft' });
    const res = await request(app).get(`/api/products/${p.slug}`);
    expect(res.status).toBe(404);
  });
});

describe('Featured / Trending / New arrivals', () => {
  beforeEach(async () => {
    await f.makeProduct({ title: 'most-liked', likes: 999, downloadCount: 1 });
    await f.makeProduct({ title: 'most-downloaded', likes: 5, downloadCount: 999 });
    // Stagger create order by waiting 5ms so publishedAt differs.
    await new Promise((r) => setTimeout(r, 5));
    await f.makeProduct({ title: 'newest', likes: 10, downloadCount: 10 });
  });

  it('GET /featured sorts by likes', async () => {
    const res = await request(app).get('/api/products/featured');
    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('most-liked');
  });

  it('GET /trending sorts by downloads', async () => {
    const res = await request(app).get('/api/products/trending');
    expect(res.body.data[0].title).toBe('most-downloaded');
  });

  it('GET /new-arrivals sorts by publishedAt desc', async () => {
    const res = await request(app).get('/api/products/new-arrivals');
    expect(res.body.data[0].title).toBe('newest');
  });
});
