const { randomToken, sha256, hashToken, timingSafeEqual } = require('../../src/utils/token');

describe('utils/token', () => {
  it('randomToken returns unique hex strings of the requested length', () => {
    const a = randomToken(16);
    const b = randomToken(16);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it('sha256 is deterministic', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('hashToken is an alias for sha256', () => {
    expect(hashToken('abc')).toBe(sha256('abc'));
  });

  describe('timingSafeEqual', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });
    it('returns false for different-length strings', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });
    it('returns false for differing strings of same length', () => {
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
    });
    it('returns false when either argument is not a string', () => {
      expect(timingSafeEqual(null, 'abc')).toBe(false);
      expect(timingSafeEqual('abc', undefined)).toBe(false);
      expect(timingSafeEqual(123, '123')).toBe(false);
    });
  });
});
