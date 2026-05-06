const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../../src/services/jwt.service');

describe('jwt service', () => {
  it('signs + verifies an access token', () => {
    const token = signAccessToken({ id: 'u1', role: 'buyer' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('u1');
    expect(decoded.role).toBe('buyer');
    expect(decoded.type).toBe('access');
  });

  it('rejects access token signed with refresh secret', () => {
    const { token } = signRefreshToken({ userId: 'u1' });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('signs + verifies a refresh token, returns jti+family', () => {
    const { token, jti, family } = signRefreshToken({ userId: 'u1' });
    expect(jti).toBeDefined();
    expect(family).toBeDefined();
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('u1');
    expect(decoded.jti).toBe(jti);
    expect(decoded.family).toBe(family);
    expect(decoded.type).toBe('refresh');
  });

  it('refresh token reuses provided family', () => {
    const fam = 'fam-fixed';
    const { family } = signRefreshToken({ userId: 'u1', family: fam });
    expect(family).toBe(fam);
  });
});
