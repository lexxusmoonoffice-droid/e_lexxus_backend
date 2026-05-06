const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order, Notification, Product } = require('../../src/models');

setupDB();
const app = buildApp();

async function purchase(buyer, product) {
  return Order.create({
    buyer: buyer._id,
    items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: product.price }],
    subtotal: product.price,
    total: product.price,
    status: 'paid',
    payment: { paidAt: new Date() },
  });
}

describe('Reviews', () => {
  it('public list on a product slug', async () => {
    const buyer = await f.makeUser();
    const product = await f.makeProduct({ slug: 'rev-prod' });
    await purchase(buyer, product);
    await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 5, comment: 'love it' });

    const res = await request(app).get('/api/products/rev-prod/reviews');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].rating).toBe(5);
    expect(res.body.data[0].user.name).toBeDefined();
  });

  it('rejects review when buyer has no paid order for the product', async () => {
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 4 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_PURCHASED');
  });

  it('rejects double review for same product', async () => {
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    await purchase(buyer, product);
    await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 5 });
    const dup = await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 4 });
    expect(dup.status).toBe(409);
  });

  it('owner can update; non-owner cannot', async () => {
    const buyer = await f.makeUser();
    const stranger = await f.makeUser();
    const product = await f.makeProduct();
    await purchase(buyer, product);
    const created = await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 3 });
    const id = created.body.review.id;

    const intruder = await request(app)
      .put(`/api/reviews/${id}`)
      .set('Authorization', bearer(stranger))
      .send({ rating: 1 });
    expect(intruder.status).toBe(403);

    const own = await request(app)
      .put(`/api/reviews/${id}`)
      .set('Authorization', bearer(buyer))
      .send({ rating: 4 });
    expect(own.status).toBe(200);
    expect(own.body.review.rating).toBe(4);
  });

  it('delete updates the product rating', async () => {
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    await purchase(buyer, product);
    const created = await request(app)
      .post('/api/reviews')
      .set('Authorization', bearer(buyer))
      .send({ productId: product._id.toString(), rating: 5 });

    let p = await Product.findById(product._id);
    expect(p.rating.count).toBe(1);
    expect(p.rating.avg).toBe(5);

    const del = await request(app)
      .delete(`/api/reviews/${created.body.review.id}`)
      .set('Authorization', bearer(buyer));
    expect(del.status).toBe(204);
    p = await Product.findById(product._id);
    expect(p.rating.count).toBe(0);
  });
});

describe('Notifications', () => {
  it('lists own + filters by status; owner-scoped', async () => {
    const me = await f.makeUser();
    const other = await f.makeUser();
    await Notification.create({ user: me._id, type: 'order.paid', title: 'Paid' });
    await Notification.create({ user: me._id, type: 'order.paid', title: 'Read', read: true });
    await Notification.create({ user: other._id, type: 'order.paid', title: 'Other' });

    const all = await request(app).get('/api/notifications').set('Authorization', bearer(me));
    expect(all.body.total).toBe(2);

    const unread = await request(app)
      .get('/api/notifications?status=unread')
      .set('Authorization', bearer(me));
    expect(unread.body.total).toBe(1);
  });

  it('mark read / mark all read; owner only', async () => {
    const me = await f.makeUser();
    const other = await f.makeUser();
    const n = await Notification.create({ user: me._id, type: 't', title: 'x' });
    const theirs = await Notification.create({ user: other._id, type: 't', title: 'x' });

    const intruder = await request(app)
      .patch(`/api/notifications/${theirs._id}/read`)
      .set('Authorization', bearer(me));
    expect(intruder.status).toBe(404);

    const ok = await request(app)
      .patch(`/api/notifications/${n._id}/read`)
      .set('Authorization', bearer(me));
    expect(ok.status).toBe(200);
    expect(ok.body.notification.read).toBe(true);

    await Notification.create({ user: me._id, type: 't', title: 'y' });
    await Notification.create({ user: me._id, type: 't', title: 'z' });
    const all = await request(app).patch('/api/notifications/read-all').set('Authorization', bearer(me));
    expect(all.body.updated).toBeGreaterThan(0);
  });
});
