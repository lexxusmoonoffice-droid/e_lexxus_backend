/**
 * cache.service tests — verify tag-based invalidation + TTL semantics
 * against the in-memory backend (NODE_ENV=test has REDIS_URL unset so
 * cache.service uses `memory`).
 */

const cache = require('../../src/services/cache.service');

beforeEach(() => {
  cache._resetMemory();
});

describe('cache.service', () => {
  it('get/set/del round-trip with TTL', async () => {
    await cache.set('k1', { a: 1 }, 60);
    expect(await cache.get('k1')).toEqual({ a: 1 });
    await cache.del('k1');
    expect(await cache.get('k1')).toBeNull();
  });

  it('wrap returns cached value; fn called only once', async () => {
    const fn = jest.fn(async () => ({ n: 42 }));
    const a = await cache.wrap('hot', 60, fn);
    const b = await cache.wrap('hot', 60, fn);
    expect(a).toEqual({ n: 42 });
    expect(b).toEqual({ n: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('wrap does not cache nullish', async () => {
    const fn = jest.fn(async () => null);
    await cache.wrap('n', 60, fn);
    await cache.wrap('n', 60, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('tagged wrap + invalidate causes fn to run again', async () => {
    const fn = jest.fn(async () => 'v1');
    const a = await cache.wrap('k', 60, fn, { tag: 'products' });
    expect(a).toBe('v1');

    await cache.invalidate('products');
    fn.mockResolvedValueOnce('v2');
    const b = await cache.wrap('k', 60, fn, { tag: 'products' });
    expect(b).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('invalidate on one tag does not clobber another', async () => {
    const fnA = jest.fn(async () => 'A');
    const fnB = jest.fn(async () => 'B');
    await cache.wrap('x', 60, fnA, { tag: 'products' });
    await cache.wrap('y', 60, fnB, { tag: 'blog' });

    await cache.invalidate('products');
    await cache.wrap('x', 60, fnA, { tag: 'products' });
    await cache.wrap('y', 60, fnB, { tag: 'blog' });
    // products fn ran twice (invalidated), blog fn ran once (still cached).
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('invalidateMany bumps several tags', async () => {
    const fn = jest.fn(async () => 1);
    await cache.wrap('k', 60, fn, { tag: 'a' });
    await cache.wrap('k', 60, fn, { tag: 'b' });
    await cache.invalidateMany(['a', 'b']);
    await cache.wrap('k', 60, fn, { tag: 'a' });
    await cache.wrap('k', 60, fn, { tag: 'b' });
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
