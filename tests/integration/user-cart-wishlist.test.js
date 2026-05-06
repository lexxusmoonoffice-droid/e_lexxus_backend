const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');

setupDB();
const app = buildApp();

async function setupUser() {
  const user = await f.makeUser();
  const auth = bearer(user);
  return { user, auth };
}

describe('Cart', () => {
  it('401 without auth on every cart route', async () => {
    expect((await request(app).get('/api/cart')).status).toBe(401);
    expect((await request(app).post('/api/cart/items').send({})).status).toBe(401);
  });

  it('GET /api/cart returns empty cart on first call', async () => {
    const { auth } = await setupUser();
    const res = await request(app).get('/api/cart').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.cart.items).toEqual([]);
  });

  it('add product → cart contains it; adding again increments qty', async () => {
    const { auth } = await setupUser();
    const product = await f.makeProduct();

    const r1 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', auth)
      .send({ productId: product._id.toString(), qty: 1 });
    expect(r1.status).toBe(201);
    expect(r1.body.cart.items).toHaveLength(1);
    expect(r1.body.cart.items[0].qty).toBe(1);

    const r2 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', auth)
      .send({ productId: product._id.toString(), qty: 2 });
    expect(r2.body.cart.items).toHaveLength(1);
    expect(r2.body.cart.items[0].qty).toBe(3);
  });

  it('add bundle works', async () => {
    const { auth } = await setupUser();
    const bundle = await f.makeBundle();
    const res = await request(app)
      .post('/api/cart/items')
      .set('Authorization', auth)
      .send({ bundleId: bundle._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.cart.items[0].bundle).toBeDefined();
  });

  it('rejects when both productId + bundleId given', async () => {
    const { auth } = await setupUser();
    const product = await f.makeProduct();
    const bundle = await f.makeBundle();
    const res = await request(app)
      .post('/api/cart/items')
      .set('Authorization', auth)
      .send({ productId: product._id.toString(), bundleId: bundle._id.toString() });
    expect(res.status).toBe(422);
  });

  it('PATCH updates qty', async () => {
    const { auth } = await setupUser();
    const product = await f.makeProduct();
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', auth)
      .send({ productId: product._id.toString() });
    const res = await request(app)
      .patch(`/api/cart/items/product/${product._id}`)
      .set('Authorization', auth)
      .send({ qty: 7 });
    expect(res.status).toBe(200);
    expect(res.body.cart.items[0].qty).toBe(7);
  });

  it('DELETE removes one item; clear empties the cart', async () => {
    const { auth } = await setupUser();
    const p1 = await f.makeProduct();
    const p2 = await f.makeProduct();
    await request(app).post('/api/cart/items').set('Authorization', auth).send({ productId: p1._id.toString() });
    await request(app).post('/api/cart/items').set('Authorization', auth).send({ productId: p2._id.toString() });

    const remove = await request(app)
      .delete(`/api/cart/items/product/${p1._id}`)
      .set('Authorization', auth);
    expect(remove.body.cart.items).toHaveLength(1);

    const clear = await request(app).delete('/api/cart').set('Authorization', auth);
    expect(clear.body.cart.items).toHaveLength(0);
  });

  it('POST /api/cart/merge sums client cart with server cart', async () => {
    const { auth } = await setupUser();
    const p1 = await f.makeProduct();
    const p2 = await f.makeProduct();

    await request(app).post('/api/cart/items').set('Authorization', auth).send({ productId: p1._id.toString(), qty: 1 });
    const res = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', auth)
      .send({
        items: [
          { productId: p1._id.toString(), qty: 2 },
          { productId: p2._id.toString(), qty: 1 },
        ],
      });
    expect(res.status).toBe(200);
    const items = res.body.cart.items;
    expect(items).toHaveLength(2);
    const p1item = items.find((i) => i.product?.id === p1._id.toString());
    expect(p1item.qty).toBe(3);
  });
});

describe('Wishlist', () => {
  it('401 without auth', async () => {
    expect((await request(app).get('/api/wishlist')).status).toBe(401);
  });

  it('add → list → remove', async () => {
    const { auth } = await setupUser();
    const product = await f.makeProduct();

    const empty = await request(app).get('/api/wishlist').set('Authorization', auth);
    expect(empty.body.wishlist.productIds).toEqual([]);

    const add = await request(app)
      .post('/api/wishlist')
      .set('Authorization', auth)
      .send({ productId: product._id.toString() });
    expect(add.status).toBe(201);
    expect(add.body.wishlist.productIds).toHaveLength(1);

    // dedup
    await request(app).post('/api/wishlist').set('Authorization', auth).send({ productId: product._id.toString() });
    const after = await request(app).get('/api/wishlist').set('Authorization', auth);
    expect(after.body.wishlist.productIds).toHaveLength(1);

    const remove = await request(app)
      .delete(`/api/wishlist/product/${product._id}`)
      .set('Authorization', auth);
    expect(remove.body.wishlist.productIds).toHaveLength(0);
  });
});
