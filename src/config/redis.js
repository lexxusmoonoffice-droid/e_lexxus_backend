/**
 * Redis client (ioredis) — lazy-connected, optional in dev.
 *
 *   const redis = require('./config/redis');
 *   if (redis) await redis.set(...);
 *
 * Returns `null` if REDIS_URL is unset. Every consumer must check for
 * null before calling — see ADR-0002 in memory/DECISIONS.md.
 */

const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');

let client = null;
let warnedDisabled = false;

function getRedis() {
  if (client !== null) return client;
  if (!env.hasRedis) {
    if (!warnedDisabled) {
      logger.info('redis: REDIS_URL not set — running without cache/queue');
      warnedDisabled = true;
    }
    return null;
  }

  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  client.on('connect', () => logger.info('redis: connected'));
  client.on('ready', () => logger.info('redis: ready'));
  client.on('error', (err) => logger.error('redis: error', { message: err.message }));
  client.on('close', () => logger.warn('redis: connection closed'));

  client.connect().catch((err) => {
    logger.error('redis: initial connect failed', { message: err.message });
    client = null; // fall back to no-cache mode
  });

  return client;
}

async function isHealthy() {
  const c = getRedis();
  if (!c) return false;
  try {
    const pong = await c.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

async function quit() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* ignore */
  }
  client = null;
}

module.exports = { getRedis, isHealthy, quit };
