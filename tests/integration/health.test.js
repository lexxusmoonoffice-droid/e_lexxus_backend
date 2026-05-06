const request = require('supertest');
const buildApp = require('../../src/app');

describe('GET /api/health', () => {
  const app = buildApp();

  it('returns ok payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('redis');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes inbound x-request-id', async () => {
    const res = await request(app).get('/api/health').set('x-request-id', 'test-req-123');
    expect(res.headers['x-request-id']).toBe('test-req-123');
  });
});

describe('GET /api/ready', () => {
  const app = buildApp();

  it('returns 503 when DB is not connected', async () => {
    const res = await request(app).get('/api/ready');
    // No DB connection in this test, so we expect 503
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not-ready');
  });
});

describe('404 handler', () => {
  const app = buildApp();

  it('returns standardised error envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error).toMatch(/not found/i);
  });
});
