/**
 * Cache wrapper — uses Redis if `REDIS_URL` is set, otherwise an
 * in-memory Map with manual TTL eviction. Per ADR-0002 the app must
 * stay functional when Redis is down.
 *
 *   const cached = await cache.wrap('k', 60, () => fetchThing());
 *
 * Tag-based invalidation (Phase 11):
 *
 *   await cache.wrap('k', 60, fn, { tag: 'products' });
 *   await cache.invalidate('products');   // bumps the tag generation
 *
 * Rather than SCAN+DEL (which ioredis-mock handles poorly and which
 * scales linearly in key count), we keep a monotonically increasing
 * generation per tag. Each wrap-with-tag embeds the generation in its
 * key, so a bump transparently misses all previous keys (they later
 * expire via TTL).
 */

const env = require('../config/env');
const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

const memory = new Map(); // key → { v: any, exp: number ms-epoch }

function memGet(key) {
  const e = memory.get(key);
  if (!e) return null;
  if (e.exp && Date.now() > e.exp) {
    memory.delete(key);
    return null;
  }
  return e.v;
}

function memSet(key, value, ttlSeconds) {
  memory.set(key, {
    v: value,
    exp: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

async function get(key) {
  if (env.hasRedis) {
    try {
      const c = getRedis();
      if (!c) return memGet(key);
      const raw = await c.get(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (err) {
      logger.warn('cache.get fell back to memory', { key, message: err.message });
    }
  }
  return memGet(key);
}

async function set(key, value, ttlSeconds = 60) {
  if (env.hasRedis) {
    try {
      const c = getRedis();
      if (c) {
        const v = JSON.stringify(value);
        if (ttlSeconds > 0) await c.set(key, v, 'EX', ttlSeconds);
        else await c.set(key, v);
        return;
      }
    } catch (err) {
      logger.warn('cache.set fell back to memory', { key, message: err.message });
    }
  }
  memSet(key, value, ttlSeconds);
}

async function del(key) {
  if (env.hasRedis) {
    try {
      const c = getRedis();
      if (c) await c.del(key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(key);
}

async function getGeneration(tag) {
  const v = await get(`_gen:${tag}`);
  return typeof v === 'number' ? v : 1;
}

/** Bump the tag's generation — invalidates every wrap-with-tag key for it. */
async function invalidate(tag) {
  const g = await getGeneration(tag);
  await set(`_gen:${tag}`, g + 1, 0); // no expiry — generation persists
}

/** Bump multiple tags in parallel. */
async function invalidateMany(tags = []) {
  await Promise.all(tags.map(invalidate));
}

/**
 * wrap(key, ttl, fn, [opts])
 *   opts.tag — stamp the key with the tag generation so invalidate(tag)
 *              transparently misses all prior entries.
 */
async function wrap(key, ttlSeconds, fn, { tag } = {}) {
  let fullKey = key;
  if (tag) {
    const gen = await getGeneration(tag);
    fullKey = `${tag}:v${gen}:${key}`;
  }
  const hit = await get(fullKey);
  if (hit !== null && hit !== undefined) return hit;
  const value = await fn();
  if (value !== null && value !== undefined) {
    set(fullKey, value, ttlSeconds).catch(() => {});
  }
  return value;
}

/** Test-only: wipe the in-memory map. */
function _resetMemory() {
  memory.clear();
}

module.exports = {
  get,
  set,
  del,
  wrap,
  invalidate,
  invalidateMany,
  getGeneration,
  _resetMemory,
};
