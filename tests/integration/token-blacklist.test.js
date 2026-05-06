/**
 * Access-token blacklist: logout revokes the currently-held access
 * jti via cache.service. Next request with the same bearer is 401
 * TOKEN_REVOKED.
 */

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const cache = require('../../src/services/cache.service');

setupDB();
const app = buildApp();

beforeEach(() => {
  cache._resetMemory();
});

describe('access-token blacklist', () => {
  it('issued token has a jti claim', async () => {
    await f.makeUser({ email: 'j@x.com', password: 'pa$$word123' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'j@x.com', password: 'pa$$word123' });
    const [, payload] = login.body.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    expect(claims.jti).toBeDefined();
    expect(claims.type).toBe('access');
  });

  it('logout blacklists the access token so /me returns 401 TOKEN_REVOKED', async () => {
    await f.makeUser({ email: 'k@x.com', password: 'pa$$word123' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'k@x.com', password: 'pa$$word123' });
    const access = login.body.accessToken;

    const meOk = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${access}`);
    expect(meOk.status).toBe(200);

    const bye = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ refreshToken: login.body.refreshToken });
    expect(bye.status).toBe(204);

    const meNow = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${access}`);
    expect(meNow.status).toBe(401);
    expect(meNow.body.code).toBe('TOKEN_REVOKED');
  });
});
