/**
 * HTTP server entry point.
 * Connects DB + Redis (best-effort), starts the server, hooks
 * SIGINT/SIGTERM for graceful shutdown.
 */

const http = require('http');
const sentry = require('./config/sentry');

// Init Sentry *before* buildApp so the request handler captures
// the right scope (no-op when SENTRY_DSN is unset).
sentry.init();

// eslint-disable-next-line import/order
const buildApp = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const dbConn = require('./config/db');
const redisConn = require('./config/redis');

const app = buildApp();
const server = http.createServer(app);

let shuttingDown = false;

async function start() {
  try {
    await dbConn.connect();
  } catch (err) {
    logger.error('boot: failed to connect to MongoDB', { message: err.message });
    if (env.isProd) process.exit(1);
    logger.warn('boot: continuing without DB (dev mode) — DB-backed routes will 503');
  }

  // Resolve runtime config (DB-first, env fallback) into the shared cache.
  try {
    // eslint-disable-next-line global-require
    await require('./services/appConfig.service').init();
  } catch (err) {
    logger.warn('appConfig init failed', { message: err.message });
  }

  // Best-effort Redis connect (lazy client) + start the email worker.
  if (env.hasRedis) {
    redisConn.getRedis();
    try {
      // eslint-disable-next-line global-require
      require('./jobs/emailQueue').startWorker();
    } catch (err) {
      logger.warn('email worker failed to start', { message: err.message });
    }
  }

  server.listen(env.PORT, () => {
    logger.info(`🚀 ${env.APP_NAME} listening on http://localhost:${env.PORT}`, {
      env: env.NODE_ENV,
      pid: process.pid,
      node: process.version,
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`shutdown: ${signal} received — closing gracefully`);

  // Stop accepting new requests
  server.close((err) => {
    if (err) logger.error('shutdown: server.close error', { message: err.message });
  });

  // Drain dependent resources
  try {
    await dbConn.disconnect();
  } catch (err) {
    logger.error('shutdown: db disconnect error', { message: err.message });
  }
  try {
    await redisConn.quit();
  } catch (err) {
    logger.error('shutdown: redis quit error', { message: err.message });
  }

  // Hard exit if it didn't land in 10 s
  setTimeout(() => {
    logger.error('shutdown: forced exit after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: reason instanceof Error ? reason.stack : reason });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err.message, stack: err.stack });
  shutdown('uncaughtException').then(() => process.exit(1));
});

start();
