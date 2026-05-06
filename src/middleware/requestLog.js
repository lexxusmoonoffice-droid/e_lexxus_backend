/**
 * Structured request logger — replaces Morgan for production where
 * we want one-line-per-request JSON with request-id, user-id, and
 * latency. Runs alongside Morgan in dev for the familiar coloured
 * output.
 *
 *   {"level":"http","requestId":"…","method":"GET","url":"/api/products",
 *    "status":200,"ms":12,"userId":"…","ip":"…"}
 */

const logger = require('../config/logger');
const env = require('../config/env');

module.exports = function requestLog(req, res, next) {
  if (env.isTest) return next();
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    // Skip noisy health checks.
    if (req.path === '/api/health' || req.path === '/api/ready' || req.path === '/metrics') return;

    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const entry = {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms,
      userId: req.user?.id,
      ip: req.ip,
      ua: req.headers['user-agent'],
    };
    if (res.statusCode >= 500) logger.error('http', entry);
    else if (res.statusCode >= 400) logger.warn('http', entry);
    else logger.info('http', entry);
  });

  next();
};
