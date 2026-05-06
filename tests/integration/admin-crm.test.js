jest.resetModules();
process.env.ZOHO_CLIENT_ID = 'c';
process.env.ZOHO_CLIENT_SECRET = 's';
process.env.ZOHO_REFRESH_TOKEN = 'r';
process.env.ZOHO_WEBHOOK_SECRET = 'w';

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order, User } = require('../../src/models');
const { _resetMemory } = require('../../src/services/cache.service');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  _resetMemory();
  // Zoho refund path: OAuth then refund. Mock both.
  global.fetch = jest
    .fn()
    .mockResolvedValue(jsonResponse({ access_token: 'tok', id: 'refund-1' }));
});

setupDB();
const app = buildApp();

async function admin() {
  const user = await f.makeUser({ role: 'admin' });
  return { user, auth: bearer(user) };
}

async function paidOrder(buyer, product) {
  return Order.create({
    buyer: buyer._id,
    items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 100 }],
    subtotal: 100, total: 100,
    status: 'paid',
    payment: { paidAt: new Date(), zohoPaymentId: 'p' },
    billing: { country: 'IN', email: buyer.email, name: buyer.name },
    downloadToken: `tok-${Date.now()}${Math.random()}`,
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
  });
}

describe('Admin /users', () => {
  it('lists + filters + shows per-user stats', async () => {
    const { auth } = await admin();
    const b1 = await f.makeUser({ role: 'buyer', name: 'Alex' });
    await f.makeUser({ role: 'buyer', name: 'Maria' });
    const product = await f.makeProduct({ price: 250 });
    await paidOrder(b1, product);

    const all = await request(app).get('/api/admin/users').set('Authorization', auth);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(3);

    const filtered = await request(app).get('/api/admin/users?q=Alex').set('Authorization', auth);
    expect(filtered.body.total).toBe(1);

    const detail = await request(app)
      .get(`/api/admin/users/${b1._id}`)
      .set('Authorization', auth);
    expect(detail.body.stats.orders).toBe(1);
    expect(detail.body.stats.spent).toBe(100);
  });

  it('patch status suspends; blocks self-suspension', async () => {
    const { user, auth } = await admin();
    const buyer = await f.makeUser({ role: 'buyer' });

    const suspend = await request(app)
      .patch(`/api/admin/users/${buyer._id}/status`)
      .set('Authorization', auth)
      .send({ status: 'suspended' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.user.status).toBe('suspended');

    const self = await request(app)
      .patch(`/api/admin/users/${user._id}/status`)
      .set('Authorization', auth)
      .send({ status: 'suspended' });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('SELF_GUARD');
  });

  it('lists orders per user', async () => {
    const { auth } = await admin();
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    await paidOrder(buyer, product);
    await paidOrder(buyer, product);

    const res = await request(app)
      .get(`/api/admin/users/${buyer._id}/orders`)
      .set('Authorization', auth);
    expect(res.body.total).toBe(2);
  });
});

describe('Admin /orders', () => {
  it('lists, patches status, resends receipt', async () => {
    const { auth } = await admin();
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    const order = await paidOrder(buyer, product);

    const list = await request(app).get('/api/admin/orders').set('Authorization', auth);
    expect(list.body.total).toBe(1);

    const detail = await request(app).get(`/api/admin/orders/${order._id}`).set('Authorization', auth);
    expect(detail.body.order.buyer.email).toBe(buyer.email);

    const patch = await request(app)
      .patch(`/api/admin/orders/${order._id}/status`)
      .set('Authorization', auth)
      .send({ status: 'cancelled' });
    expect(patch.body.order.status).toBe('cancelled');

    const resend = await request(app)
      .post(`/api/admin/orders/${order._id}/resend-receipt`)
      .set('Authorization', auth);
    expect(resend.status).toBe(200);
  });

  it('refund revokes download token and flips status', async () => {
    const { auth } = await admin();
    const buyer = await f.makeUser();
    const product = await f.makeProduct();
    const order = await paidOrder(buyer, product);

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/refund`)
      .set('Authorization', auth)
      .send({ reason: 'duplicate' });
    expect(res.status).toBe(200);
    const fresh = await Order.findById(order._id);
    expect(fresh.status).toBe('refunded');
    expect(fresh.downloadToken).toBeNull();
  });
});
