/**
 * Access-token blacklist.
 *
 * Access tokens are stateless JWTs — once signed, the only way to
 * revoke them is to keep a short-lived deny-list. We key by the
 * token's `jti` and TTL the entry exactly to its remaining lifetime
 * so the list self-cleans.
 *
 * Backed by cache.service, so it works through Redis when available
 * and falls back to process-local memory otherwise (acceptable for
 * single-instance dev).
 */

const cache = require('./cache.service');

const PREFIX = 'access-jti:revoked:';

async function revoke(jti, exp) {
  if (!jti) return;
  const ttl = Math.max(1, Math.floor(exp - Date.now() / 1000));
  await cache.set(`${PREFIX}${jti}`, 1, ttl);
}

async function isRevoked(jti) {
  if (!jti) return false;
  const hit = await cache.get(`${PREFIX}${jti}`);
  return hit === 1 || hit === '1';
}

module.exports = { revoke, isRevoked };
