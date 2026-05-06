/**
 * Token-redeem flow tests. cdn.service is mocked so we don't need
 * real B2 creds.
 */

jest.mock('../../src/services/cdn.service', () => ({
  publicUrl: (key) => (key ? `https://files.test/${key}` : null),
  signedDownloadUrl: jest.fn(async (key) => `https://files.test/${key}?sig=mock&exp=300`),
}));

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order, Product } = require('../../src/models');

setupDB();
const app = buildApp();

async function makePaidOrder(buyer, items, over = {}) {
  return Order.create({
    buyer: buyer._id,
    items,
    subtotal: 100,
    total: 100,
    status: 'paid',
    payment: { paidAt: new Date() },
    downloadToken: over.downloadToken || `tok-${Math.random().toString(36).slice(2)}`,
    tokenExpiresAt: over.tokenExpiresAt || new Date(Date.now() + 86_400_000),
    downloadCount: over.downloadCount || 0,
    downloadLimit: over.downloadLimit || 5,
    billing: { country: 'IN', email: buyer.email, name: buyer.name },
    ...over.extra,
  });
}

async function attachFile(product, key = 'products/x/y/file.zip') {
  product.file = {
    b2FileName: key,
    cdnUrl: `https://files.test/${key}`,
    sizeBytes: 1024,
    mimeType: 'application/zip',
  };
  product.fileSizeMb = 1;
  await product.save();
  return product;
}

describe('GET /api/downloads/:token', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/downloads/tok-x');
    expect(res.status).toBe(401);
  });

  it('returns signed URL + bumps downloadCount atomically', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct({ title: 'Sofa' }));
    const order = await makePaidOrder(buyer, [
      { type: 'product', product: product._id, qty: 1, priceAtPurchase: 100, title: product.title },
    ]);

    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(200);
    expect(res.body.order.downloadCount).toBe(1);
    expect(res.body.order.remaining).toBe(4);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].url).toMatch(/^https:\/\/files\.test\//);
    expect(res.body.items[0].expiresIn).toBe(300);

    const fresh = await Order.findById(order._id);
    expect(fresh.downloadCount).toBe(1);
  });

  it('expands a bundle into one URL per included product', async () => {
    const buyer = await f.makeUser();
    const p1 = await attachFile(await f.makeProduct({ title: 'P1' }), 'products/x/p1.zip');
    const p2 = await attachFile(await f.makeProduct({ title: 'P2' }), 'products/x/p2.zip');
    const bundle = await f.makeBundle({
      productIds: [p1._id, p2._id],
      bundlePrice: 200,
      originalPrice: 200,
    });
    const order = await makePaidOrder(buyer, [
      { type: 'bundle', bundle: bundle._id, qty: 1, priceAtPurchase: 200, title: bundle.name },
    ]);

    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(200);
    expect(res.body.items[0].type).toBe('bundle');
    expect(res.body.items[0].products).toHaveLength(2);
    expect(res.body.items[0].products[0].url).toContain('p1.zip');
    expect(res.body.items[0].products[1].url).toContain('p2.zip');
  });

  it('handles a product with no file attached gracefully', async () => {
    const buyer = await f.makeUser();
    const product = await f.makeProduct({ title: 'No file yet' }); // no .file set
    const order = await makePaidOrder(buyer, [
      { type: 'product', product: product._id, qty: 1, priceAtPurchase: 100, title: product.title },
    ]);
    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(200);
    expect(res.body.items[0].url).toBeNull();
    expect(res.body.items[0].reason).toMatch(/No file/);
  });

  it('404 for wrong buyer (no info leak)', async () => {
    const buyer = await f.makeUser();
    const intruder = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await makePaidOrder(buyer, [
      { type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' },
    ]);
    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(intruder));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BAD_TOKEN');
  });

  it('404 BAD_TOKEN for unknown token', async () => {
    const buyer = await f.makeUser();
    const res = await request(app)
      .get('/api/downloads/unknown-tok')
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BAD_TOKEN');
  });

  it('410 TOKEN_EXPIRED when tokenExpiresAt is past', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await makePaidOrder(
      buyer,
      [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' }],
      { tokenExpiresAt: new Date(Date.now() - 1000) },
    );
    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('429 DOWNLOAD_LIMIT when count == limit', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await makePaidOrder(
      buyer,
      [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' }],
      { downloadCount: 5, downloadLimit: 5 },
    );
    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('DOWNLOAD_LIMIT');
  });

  it('403 NOT_PAID when order is pending', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await Order.create({
      buyer: buyer._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' }],
      subtotal: 1, total: 1,
      status: 'pending',
      downloadToken: 'tok-pending',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
      billing: { country: 'IN' },
    });
    const res = await request(app)
      .get(`/api/downloads/${order.downloadToken}`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_PAID');
  });
});

describe('POST /api/downloads/:token/resend', () => {
  it('emails the link and returns the recipient', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await makePaidOrder(buyer, [
      { type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' },
    ]);
    const res = await request(app)
      .post(`/api/downloads/${order.downloadToken}/resend`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/emailed/i);
    expect(res.body.sentTo).toBe(buyer.email);
  });

  it('404 BAD_TOKEN on unknown', async () => {
    const buyer = await f.makeUser();
    const res = await request(app)
      .post('/api/downloads/nope/resend')
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(404);
  });

  it('410 TOKEN_EXPIRED when expired', async () => {
    const buyer = await f.makeUser();
    const product = await attachFile(await f.makeProduct());
    const order = await makePaidOrder(
      buyer,
      [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1, title: 'p' }],
      { tokenExpiresAt: new Date(Date.now() - 1000) },
    );
    const res = await request(app)
      .post(`/api/downloads/${order.downloadToken}/resend`)
      .set('Authorization', bearer(buyer));
    expect(res.status).toBe(410);
  });
});
