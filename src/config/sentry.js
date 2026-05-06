/**
 * Sentry — conditional init. If `SENTRY_DSN` is unset (default in
 * dev + tests), every exported helper is a no-op.
 *
 *   require('./config/sentry').init();
 *   sentry.captureError(err);
 *   app.use(sentry.requestHandler);  // before routes
 *   app.use(sentry.errorHandler);    // before our errorHandler
 */

const env = require('./env');
const logger = require('./logger');

let Sentry = null;
let ready = false;

function init() {
  if (ready || !env.SENTRY_DSN || env.isTest) return;
  try {
    // eslint-disable-next-line global-require
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.isProd ? 0.1 : 1.0,
      release: process.env.GIT_SHA || undefined,
      integrations: [],
    });
    ready = true;
    logger.info('sentry: initialised');
  } catch (err) {
    logger.warn('sentry: init failed', { message: err.message });
  }
}

function captureError(err, extra) {
  if (!ready || !Sentry) return;
  try {
    Sentry.captureException(err, { extra });
  } catch {
    /* swallow */
  }
}

// Express middleware — always resolve to a no-op when Sentry is off
// so `app.use(...)` calls line up.
function requestHandler(req, res, next) {
  if (ready && Sentry) {
    return Sentry.Handlers?.requestHandler
      ? Sentry.Handlers.requestHandler()(req, res, next)
      : next();
  }
  return next();
}

function errorHandler(err, req, res, next) {
  if (ready && Sentry && Sentry.Handlers?.errorHandler) {
    return Sentry.Handlers.errorHandler()(err, req, res, next);
  }
  return next(err);
}

module.exports = { init, captureError, requestHandler, errorHandler };
