/**
 * Verify cache.service works against a real (mocked) Redis client.
 * ioredis-mock is a drop-in that implements the ioredis API in-memory.
 *
 * We have to reset modules + set REDIS_URL *before* requiring anything
 * that consults env.hasRedis.
 */

jest.mock('ioredis', () => require('ioredis-mock'));
jest.resetModules();
process.env.REDIS_URL = 'redis://localhost:6379';

const cache = require('../../src/services/cache.service');
const { getRedis, quit } = require('../../src/config/redis');

beforeEach(() => {
  cache._resetMemory();
});

afterAll(async () => {
  await quit();
});

describe('cache.service → Redis (ioredis-mock)', () => {
  it('set persists to Redis, get reads it back', async () => {
    await cache.set('r:hello', { who: 'world' }, 60);
    const c = getRedis();
    const raw = await c.get('r:hello');
    expect(JSON.parse(raw)).toEqual({ who: 'world' });
    expect(await cache.get('r:hello')).toEqual({ who: 'world' });
  });

  it('tag-based invalidation still works via Redis', async () => {
    const fn = jest.fn(async () => 'A');
    await cache.wrap('k1', 60, fn, { tag: 'X' });
    await cache.wrap('k1', 60, fn, { tag: 'X' });
    expect(fn).toHaveBeenCalledTimes(1);

    await cache.invalidate('X');
    fn.mockResolvedValueOnce('B');
    const v = await cache.wrap('k1', 60, fn, { tag: 'X' });
    expect(v).toBe('B');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
