const cache = require('../../src/services/cache.service');
const blacklist = require('../../src/services/tokenBlacklist.service');

beforeEach(() => {
  cache._resetMemory();
});

describe('tokenBlacklist', () => {
  it('revoke stores a hit that isRevoked reads', async () => {
    await blacklist.revoke('jti-1', Math.floor(Date.now() / 1000) + 60);
    expect(await blacklist.isRevoked('jti-1')).toBe(true);
    expect(await blacklist.isRevoked('jti-unknown')).toBe(false);
  });

  it('revoke is a no-op when jti is falsy', async () => {
    await expect(blacklist.revoke(null, 1000)).resolves.toBeUndefined();
    await expect(blacklist.revoke("", 1000)).resolves.toBeUndefined();
  });

  it('isRevoked returns false for falsy jti', async () => {
    expect(await blacklist.isRevoked(null)).toBe(false);
    expect(await blacklist.isRevoked("")).toBe(false);
  });

  it('revoke clamps negative TTL to 1', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    await blacklist.revoke('old-jti', pastExp);
    // Still reads as revoked in the same tick since cache TTL resolution is seconds.
    expect(await blacklist.isRevoked('old-jti')).toBe(true);
  });
});
