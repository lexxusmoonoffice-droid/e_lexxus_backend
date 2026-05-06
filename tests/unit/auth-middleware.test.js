/**
 * Unit tests for requireAuth, requireRole, requireVerified.
 */
const { setupDB } = require('../helpers/db');
const { User } = require('../../src/models');
const { hashPassword } = require('../../src/utils/password');
const { signAccessToken } = require('../../src/services/jwt.service');
const { requireAuth, requireRole, requireVerified } = require('../../src/middleware/auth');

setupDB();

async function makeUser(over = {}) {
  return User.create({
    name: 'X',
    email: `u${Date.now()}@x.com`,
    passwordHash: await hashPassword('secret123'),
    verified: true,
    role: 'buyer',
    ...over,
  });
}

function fakeReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

describe('requireAuth', () => {
  it('401 when missing', (done) => {
    requireAuth(fakeReq(), {}, (err) => {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('NO_TOKEN');
      done();
    });
  });

  it('attaches req.user on valid token', async () => {
    const user = await makeUser();
    const token = signAccessToken(user);
    const req = fakeReq(token);
    await new Promise((resolve, reject) => {
      requireAuth(req, {}, (err) => (err ? reject(err) : resolve()));
    });
    expect(req.user.id).toBe(user.id);
  });

  it('403 when user is suspended', async () => {
    const user = await makeUser({ status: 'suspended' });
    const token = signAccessToken(user);
    await new Promise((resolve) => {
      requireAuth(fakeReq(token), {}, (err) => {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('ACCOUNT_SUSPENDED');
        resolve();
      });
    });
  });
});

describe('requireRole', () => {
  it('403 when role mismatches', (done) => {
    const req = { user: { role: 'buyer' } };
    requireRole('admin')(req, {}, (err) => {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('WRONG_ROLE');
      done();
    });
  });

  it('passes when role matches', (done) => {
    const req = { user: { role: 'admin' } };
    requireRole('admin', 'creator')(req, {}, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });
});

describe('requireVerified', () => {
  it('403 when not verified', (done) => {
    const req = { user: { verified: false } };
    requireVerified(req, {}, (err) => {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
      done();
    });
  });
  it('passes when verified', (done) => {
    const req = { user: { verified: true } };
    requireVerified(req, {}, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });
});
