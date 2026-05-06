/**
 * Auth flow integration tests.
 * Covers register → verify → login → me → refresh (rotation) → logout
 * plus negative paths: bad creds, expired token, reused refresh, suspended,
 * password reset cycle, change password.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const env = require('../../src/config/env');
const { User, RefreshToken } = require('../../src/models');
const { hashPassword } = require('../../src/utils/password');
const { signRefreshToken } = require('../../src/services/jwt.service');

setupDB();

const app = buildApp();

const creds = { name: 'Test User', email: 'test@lexxus.com', password: 'pa$$word123' };

async function makeUser(over = {}) {
  return User.create({
    name: over.name || 'U',
    email: over.email || `u-${Date.now()}@x.com`,
    passwordHash: await hashPassword(over.password || 'pa$$word123'),
    verified: true,
    role: 'buyer',
    ...over.extra,
  });
}

describe('POST /api/auth/register', () => {
  it('creates a user and returns verifyToken in dev', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user.verified).toBe(false);
    expect(res.body.verifyToken).toBeDefined();
  });

  it('rejects duplicate email', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('422 on bad email / short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'x', email: 'nope', password: '123' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/verify-email', () => {
  it('verifies on valid token', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: reg.body.verifyToken });
    expect(res.status).toBe(200);
    expect(res.body.user.verified).toBe(true);
  });

  it('400 on invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_VERIFY_TOKEN');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await makeUser({ email: creds.email, password: creds.password });
  });

  it('returns access + refresh + sets cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(creds.email);
    expect(res.headers['set-cookie']?.join('|')).toMatch(/refresh=/);
  });

  it('401 on bad password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('BAD_CREDENTIALS');
  });

  it('403 if suspended', async () => {
    await User.updateOne({ email: creds.email }, { $set: { status: 'suspended' } });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('GET /api/auth/me', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  it('200 with valid bearer', async () => {
    await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
  });

  it('401 on expired access token', async () => {
    const u = await makeUser({ email: creds.email });
    const expired = jwt.sign(
      { sub: u._id.toString(), role: 'buyer', type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('401 on tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

describe('POST /api/auth/refresh — rotation + reuse detection', () => {
  it('rotates the refresh token and returns a new access', async () => {
    await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    const r1 = login.body.refreshToken;

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: r1 });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(r1);

    const stored = await RefreshToken.find({}).sort({ createdAt: 1 });
    expect(stored.length).toBe(2);
    expect(stored[0].revokedAt).toBeInstanceOf(Date);
    expect(stored[1].family).toBe(stored[0].family);
  });

  it('reuses → revokes the entire family', async () => {
    await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    const r1 = login.body.refreshToken;

    const ok = await request(app).post('/api/auth/refresh').send({ refreshToken: r1 });
    expect(ok.status).toBe(200);

    // Reusing the OLD refresh now must trip reuse detection.
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: r1 });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');

    const live = await RefreshToken.find({ revokedAt: null });
    expect(live.length).toBe(0);
  });

  it('401 on garbage refresh', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH');
  });

  it('401 on unknown jti', async () => {
    const u = await makeUser({ email: creds.email });
    const { token } = signRefreshToken({ userId: u._id });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNKNOWN_REFRESH');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token', async () => {
    await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });

    const res = await request(app).post('/api/auth/logout').send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(204);

    // Subsequent refresh fails (already revoked → reuse path).
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);
  });
});

describe('Forgot + reset password flow', () => {
  it('reset works end-to-end and invalidates refresh tokens', async () => {
    const u = await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });

    await request(app).post('/api/auth/forgot-password').send({ email: creds.email });

    const updated = await User.findById(u._id).select('+passwordResetTokenHash');
    expect(updated.passwordResetTokenHash).toBeDefined();

    // Issue a known token directly so we can test the reset path.
    const { randomToken, hashToken } = require('../../src/utils/token');
    const raw = randomToken();
    updated.passwordResetTokenHash = hashToken(raw);
    updated.passwordResetTokenExpiresAt = new Date(Date.now() + 60_000);
    await updated.save();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: raw, newPassword: 'newPassword123!' });
    expect(reset.status).toBe(200);

    // Old refresh is now revoked.
    const after = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(after.status).toBe(401);

    // Old password no longer works; new one does.
    const oldLogin = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: creds.email, password: 'newPassword123!' });
    expect(newLogin.status).toBe(200);
  });

  it('forgot returns 200 even for unknown email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@x.com' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/auth/change-password', () => {
  it('changes when current password matches; rejects otherwise', async () => {
    await makeUser({ email: creds.email, password: creds.password });
    const login = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });

    const bad = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'replacement123!' });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: creds.password, newPassword: 'replacement123!' });
    expect(good.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: creds.email, password: 'replacement123!' });
    expect(newLogin.status).toBe(200);
  });
});
