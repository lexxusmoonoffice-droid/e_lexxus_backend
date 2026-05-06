/**
 * Health + readiness endpoints.
 *
 *   GET /api/health   liveness — DB ping, Redis ping, uptime
 *   GET /api/ready    readiness — same checks, but 503 if DB is down
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const dbConn = require('../config/db');
const redisConn = require('../config/redis');

const router = express.Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const [redisUp] = await Promise.all([redisConn.isHealthy()]);
    const dbUp = dbConn.isHealthy();
    res.json({
      status: 'ok',
      app: env.APP_NAME,
      env: env.NODE_ENV,
      uptime: Math.round(process.uptime()),
      db: dbUp ? 'up' : 'down',
      redis: env.hasRedis ? (redisUp ? 'up' : 'down') : 'disabled',
      ts: new Date().toISOString(),
    });
  }),
);

router.get(
  '/ready',
  asyncHandler(async (req, res) => {
    const dbUp = dbConn.isHealthy();
    if (!dbUp) {
      return res.status(503).json({ status: 'not-ready', db: 'down' });
    }
    res.json({ status: 'ready', db: 'up' });
  }),
);

module.exports = router;
