/**
 * Random token + hash helpers (for email-verify and password-reset tokens).
 * The raw token is sent to the user; only the SHA-256 hash is persisted,
 * so a DB leak does not expose live tokens.
 */
const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hashToken(rawToken) {
  return sha256(rawToken);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { randomToken, sha256, hashToken, timingSafeEqual };
