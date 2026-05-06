/**
 * Rate-limit factory.
 * Uses Redis store when REDIS_URL is set; otherwise in-memory (per-process).
 *
 * Skipped entirely under NODE_ENV=test so unit tests can hit endpoints
 * without tripping limits.
 */

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const env = require('../config/env');
const { getRedis } = require('../config/redis');
const appConfig = require('../services/appConfig.service');

function buildStore() {
  if (env.isTest) return undefined;
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  });
}

function buildLimiter({ windowMs, max, code = 'RATE_LIMITED', message = 'Too many requests' }) {
  return rateLimit({
    windowMs,
    max, // may be a number or a function(req, res) — express-rate-limit supports both
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest,
    store: buildStore(),
    handler: (req, res) => {
      res.status(429).json({ error: message, code });
    },
  });
}

// Global + download limits are runtime-tunable via appConfig. The
// rate-limit library calls the function on each request, so admin
// updates take effect on the next request (no restart needed).
const globalLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: () => appConfig.get('limits.globalRateLimitPer15Min') || 300,
  code: 'GLOBAL_RATE_LIMITED',
  message: 'Too many requests, slow down',
});

const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  code: 'AUTH_RATE_LIMITED',
  message: 'Too many auth attempts, try again later',
});

const paymentLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 10,
  code: 'PAYMENT_RATE_LIMITED',
  message: 'Too many payment attempts, slow down',
});

const downloadLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: () => appConfig.get('limits.downloadRateLimitPerHour') || 10,
  code: 'DOWNLOAD_RATE_LIMITED',
  message: 'Download rate limit reached, try again later',
});

// Separate limiter for resend-email requests — more lenient, different bucket
const resendLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  code: 'RESEND_RATE_LIMITED',
  message: 'Too many resend requests, try again later',
});

module.exports = {
  globalLimiter,
  authLimiter,
  paymentLimiter,
  downloadLimiter,
  resendLimiter,
  buildLimiter, // exported for tests + ad-hoc limiters
};
