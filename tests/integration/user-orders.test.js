const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order } = require('../../src/models');

setupDB();
const app = buildApp();

async function makeOrder(buyer, product, over = {}) {
  return Order.create({
    buyer: buyer._id,
    items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: product.price, title: product.title }],
    subtotal: product.price,
    total: product.price,
    status: over.status || 'paid',
    payment: { paidAt: new Date() },
    downloadToken: over.downloadToken,
    tokenExpiresAt: over.tokenExpiresAt,
    downloadCount: 0,
    downloadLimit: 5,
    ...over.extra,
  });
}

describe('Orders — user side', () => {
  it('GET /api/orders lists ONLY my own orders', async () => {
    const me = await f.makeUser();
    const other = await f.makeUser();
    const product = await f.makeProduct();

    await makeOrder(me, product);
    await makeOrder(me, product);
    await makeOrder(other, product);

    const res = await request(app).get('/api/orders').set('Authorization', bearer(me));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('GET /api/orders/:id 404s when ordered by someone else', async () => {
    const me = await f.makeUser();
    const other = await f.makeUser();
    const product = await f.makeProduct();
    const theirs = await makeOrder(other, product);

    const res = await request(app).get(`/api/orders/${theirs._id}`).set('Authorization', bearer(me));
    expect(res.status).toBe(404);
  });

  it('GET /api/orders/:id returns my own order with items populated', async () => {
    const me = await f.makeUser();
    const product = await f.makeProduct({ title: 'Owned' });
    const order = await makeOrder(me, product);

    const res = await request(app).get(`/api/orders/${order._id}`).set('Authorization', bearer(me));
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].product.title).toBe('Owned');
  });

  it('rejects bad ObjectId with 422', async () => {
    const me = await f.makeUser();
    const res = await request(app).get('/api/orders/not-an-id').set('Authorization', bearer(me));
    expect(res.status).toBe(422);
  });

  it('401 without auth', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
  });
});

describe('Downloads — user side', () => {
  it('GET /api/downloads returns paid orders with tokens', async () => {
    const me = await f.makeUser();
    const product = await f.makeProduct();

    await makeOrder(me, product, { status: 'paid', downloadToken: 'tok-A', tokenExpiresAt: new Date(Date.now() + 86_400_000) });
    await makeOrder(me, product, { status: 'pending' }); // not included

    const res = await request(app).get('/api/downloads').set('Authorization', bearer(me));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].downloadToken).toBe('tok-A');
    expect(res.body.data[0].downloadLimit).toBe(5);
  });

  it('401 without auth', async () => {
    expect((await request(app).get('/api/downloads')).status).toBe(401);
  });
});
