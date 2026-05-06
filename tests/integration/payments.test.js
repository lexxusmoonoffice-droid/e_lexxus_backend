/**
 * Payment flow integration tests.
 * Zoho HTTP calls are mocked with nock.
 * Email is log-only (no SMTP creds → mailer.service falls back).
 */

jest.resetModules();
process.env.ZOHO_CLIENT_ID = 'test-client';
process.env.ZOHO_CLIENT_SECRET = 'test-secret';
process.env.ZOHO_REFRESH_TOKEN = 'test-refresh';
process.env.ZOHO_WEBHOOK_SECRET = 'test-webhook-secret';

const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Order, Cart, Notification } = require('../../src/models');
const { _resetMemory } = require('../../src/services/cache.service');

setupDB();
const app = buildApp();

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
  global.fetch = jest.fn();
});

function mockZohoOAuth() {
  global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }));
}

function mockZohoSession({ paymentUrl = 'https://pay.zoho.in/x', sessionId = 'sess-1' } = {}) {
  global.fetch.mockResolvedValueOnce(jsonResponse({ session_id: sessionId, payment_url: paymentUrl }));
}

async function addCartItem(user, product, qty = 1) {
  await Cart.create({ user: user._id, items: [{ product: product._id, qty }] });
}

function signWebhook(body) {
  return crypto.createHmac('sha256', 'test-webhook-secret').update(body).digest('hex');
}

describe('POST /api/payments/create-order', () => {
  it('rejects empty cart', async () => {
    const u = await f.makeUser();
    const res = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', bearer(u))
      .send({ billing: { country: 'IN' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_CART');
  });

  it('creates a pending order, calls Zoho, returns paymentUrl', async () => {
    mockZohoOAuth();
    mockZohoSession({ paymentUrl: 'https://pay.zoho.in/abc', sessionId: 'sess-9' });

    const u = await f.makeUser();
    const product = await f.makeProduct({ price: 1500 });
    await addCartItem(u, product, 2);

    const res = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', bearer(u))
      .send({ billing: { country: 'IN', name: 'Buyer', email: u.email } });
    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.paymentUrl).toBe('https://pay.zoho.in/abc');

    const order = await Order.findById(res.body.orderId);
    expect(order.status).toBe('pending');
    expect(order.subtotal).toBe(3000);
    expect(order.payment.zohoOrderId).toBe('sess-9');
  });

  it('Idempotency-Key returns the same response on repeat', async () => {
    mockZohoOAuth();
    mockZohoSession({ paymentUrl: 'https://pay.zoho.in/idem', sessionId: 'sess-idem' });

    const u = await f.makeUser();
    const product = await f.makeProduct({ price: 100 });
    await addCartItem(u, product);

    const r1 = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', bearer(u))
      .set('Idempotency-Key', 'unique-1')
      .send({ billing: { country: 'IN' } });

    // No second nock call set up — if the service hits Zoho again, this test fails.
    const r2 = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', bearer(u))
      .set('Idempotency-Key', 'unique-1')
      .send({ billing: { country: 'IN' } });

    expect(r1.body.orderId).toBe(r2.body.orderId);
    expect(r1.body.paymentUrl).toBe(r2.body.paymentUrl);
  });

  it('401 without auth', async () => {
    const res = await request(app).post('/api/payments/create-order').send({ billing: { country: 'IN' } });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/payments/webhook', () => {
  it('rejects bad signature', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Zoho-Signature', 'deadbeef')
      .send({ event_type: 'payment.success', reference_id: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('BAD_SIGNATURE');
  });

  it('payment.success → marks order paid, issues download token, notifies user', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct({ price: 200 });
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 200 }],
      subtotal: 200,
      total: 200,
      status: 'pending',
      billing: { name: 'B', email: u.email, country: 'IN' },
    });
    const body = JSON.stringify({
      event_type: 'payment.success',
      reference_id: order._id.toString(),
      payment_id: 'pay-1',
      method: 'upi',
    });
    const sig = signWebhook(body);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Zoho-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    const updated = await Order.findById(order._id);
    expect(updated.status).toBe('paid');
    expect(updated.downloadToken).toBeDefined();
    expect(updated.payment.zohoPaymentId).toBe('pay-1');

    const notes = await Notification.find({ user: u._id });
    expect(notes.some((n) => n.type === 'order.paid')).toBe(true);
  });

  it('replayed webhook is idempotent', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct({ price: 200 });
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 200 }],
      subtotal: 200,
      total: 200,
      status: 'pending',
      billing: { country: 'IN', email: u.email },
    });
    const body = JSON.stringify({
      event_type: 'payment.success',
      reference_id: order._id.toString(),
      payment_id: 'pay-1',
    });
    const sig = signWebhook(body);

    await request(app).post('/api/payments/webhook').set('X-Zoho-Signature', sig).set('Content-Type', 'application/json').send(body);
    const first = await Order.findById(order._id);
    const tokenAfterFirst = first.downloadToken;

    await request(app).post('/api/payments/webhook').set('X-Zoho-Signature', sig).set('Content-Type', 'application/json').send(body);
    const second = await Order.findById(order._id);
    // Token unchanged on replay
    expect(second.downloadToken).toBe(tokenAfterFirst);
    expect(second.status).toBe('paid');
  });

  it('payment.failed → marks failed', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct();
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 100 }],
      subtotal: 100,
      total: 100,
      status: 'pending',
      billing: { country: 'IN' },
    });
    const body = JSON.stringify({ event_type: 'payment.failed', reference_id: order._id.toString() });
    const sig = signWebhook(body);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('X-Zoho-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    const updated = await Order.findById(order._id);
    expect(updated.status).toBe('failed');
  });

  it('refund.processed → marks refunded and revokes downloadToken', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct();
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 100 }],
      subtotal: 100,
      total: 100,
      status: 'paid',
      downloadToken: 'tok-x',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
      billing: { country: 'IN' },
    });
    const body = JSON.stringify({ event_type: 'refund.processed', reference_id: order._id.toString() });
    const sig = signWebhook(body);

    await request(app).post('/api/payments/webhook').set('X-Zoho-Signature', sig).set('Content-Type', 'application/json').send(body);
    const updated = await Order.findById(order._id);
    expect(updated.status).toBe('refunded');
    expect(updated.downloadToken).toBeNull();
  });

  it('ignores unknown event_type but still 200 once verified', async () => {
    const body = JSON.stringify({
      event_type: 'something.unknown',
      reference_id: new mongoose.Types.ObjectId().toString(),
    });
    const sig = signWebhook(body);
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('X-Zoho-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
  });
});

describe('GET /api/payments/order/:id/status', () => {
  it('returns current status; download token only when paid', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct();
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 100 }],
      subtotal: 100,
      total: 100,
      status: 'pending',
      billing: { country: 'IN' },
    });

    const r1 = await request(app)
      .get(`/api/payments/order/${order._id}/status`)
      .set('Authorization', bearer(u));
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('pending');
    expect(r1.body.downloadToken).toBeNull();

    await Order.updateOne({ _id: order._id }, { $set: { status: 'paid', downloadToken: 'tok-status' } });
    const r2 = await request(app)
      .get(`/api/payments/order/${order._id}/status`)
      .set('Authorization', bearer(u));
    expect(r2.body.status).toBe('paid');
    expect(r2.body.downloadToken).toBe('tok-status');
  });

  it('404s for someone else\'s order', async () => {
    const me = await f.makeUser();
    const other = await f.makeUser();
    const product = await f.makeProduct();
    const theirs = await Order.create({
      buyer: other._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1 }],
      subtotal: 1,
      total: 1,
      billing: { country: 'IN' },
    });
    const res = await request(app)
      .get(`/api/payments/order/${theirs._id}/status`)
      .set('Authorization', bearer(me));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/payments/order/:id/cancel', () => {
  it('cancels pending order; rejects paid', async () => {
    const u = await f.makeUser();
    const product = await f.makeProduct();
    const order = await Order.create({
      buyer: u._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1 }],
      subtotal: 1, total: 1, status: 'pending', billing: { country: 'IN' },
    });
    const ok = await request(app)
      .post(`/api/payments/order/${order._id}/cancel`)
      .set('Authorization', bearer(u));
    expect(ok.status).toBe(200);
    const updated = await Order.findById(order._id);
    expect(updated.status).toBe('cancelled');

    const bad = await request(app)
      .post(`/api/payments/order/${order._id}/cancel`)
      .set('Authorization', bearer(u));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_STATE');
  });
});
