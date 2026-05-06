const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order } = require('../../src/models');

setupDB();
const app = buildApp();

async function paidOrder(buyer, product, paidAt, total = 100) {
  return Order.create({
    buyer: buyer._id,
    items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: total }],
    subtotal: total, total,
    status: 'paid',
    payment: { paidAt, zohoPaymentId: 'p' },
    billing: { country: 'IN', email: buyer.email },
    creators: [product.creator],
  });
}

describe('Admin dashboard', () => {
  it('rejects non-admin with 403', async () => {
    const buyer = await f.makeUser({ role: 'buyer' });
    const res = await request(app).get('/api/admin/dashboard/stats').set('Authorization', bearer(buyer));
    expect(res.status).toBe(403);
  });

  it('GET /dashboard/stats returns revenue/orders/customers/products', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const buyer = await f.makeUser({ role: 'buyer' });
    const p = await f.makeProduct({ price: 500 });
    await paidOrder(buyer, p, new Date(), 500);

    const res = await request(app).get('/api/admin/dashboard/stats').set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.revenue.total).toBe(500);
    expect(res.body.orders.total).toBe(1);
    expect(res.body.customers.total).toBeGreaterThanOrEqual(1);
    expect(res.body.products.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /dashboard/revenue returns 12 months (zero-padded)', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const buyer = await f.makeUser({ role: 'buyer' });
    const p = await f.makeProduct({ price: 200 });
    await paidOrder(buyer, p, new Date(), 200);

    const res = await request(app).get('/api/admin/dashboard/revenue').set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data[11].total).toBeGreaterThan(0); // current month is last
  });

  it('GET /dashboard/top-categories aggregates paid sales by category', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const buyer = await f.makeUser({ role: 'buyer' });
    const cat = await f.makeCategory({ name: 'Sofas', slug: 'sofas-top' });
    const p = await f.makeProduct({ category: cat, price: 300 });
    await paidOrder(buyer, p, new Date(), 300);

    const res = await request(app).get('/api/admin/dashboard/top-categories').set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].name).toBe('Sofas');
    expect(res.body.data[0].pct).toBe(100);
  });

  it('GET /dashboard/recent-orders returns most recent', async () => {
    const admin = await f.makeUser({ role: 'admin' });
    const buyer = await f.makeUser({ role: 'buyer' });
    const p = await f.makeProduct();
    await paidOrder(buyer, p, new Date());

    const res = await request(app)
      .get('/api/admin/dashboard/recent-orders?limit=5')
      .set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data[0].buyer.email).toBe(buyer.email);
  });
});
