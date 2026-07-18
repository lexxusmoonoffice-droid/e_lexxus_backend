/**
 * Express app factory.
 * Built as a function so tests can boot fresh instances and so we can
 * skip the global rate limiter under NODE_ENV=test.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const env = require('./config/env');
const logger = require('./config/logger');
const sentry = require('./config/sentry');
const requestId = require('./middleware/requestId');
const requestLog = require('./middleware/requestLog');
const metrics = require('./services/metrics.service');
const { globalLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const docsRoutes = require('./routes/docs');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const brandRoutes = require('./routes/brands');
const bundleRoutes = require('./routes/bundles');
const blogRoutes = require('./routes/blog');
const heroSlideRoutes = require('./routes/heroSlides');
const settingsRoutes = require('./routes/settings');
const socialLinksRoutes = require('./routes/socialLinks');
const searchRoutes = require('./routes/search');
const currencyRoutes = require('./routes/currency');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const downloadRoutes = require('./routes/downloads');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notifications');
const uploadRoutes = require('./routes/uploads');
const paymentRoutes = require('./routes/payments');
const zohoRoutes = require('./routes/zoho');
const inquiriesRoutes = require('./routes/inquiries');
const adminRoutes = require('./routes/admin');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Sentry request context (no-op if SENTRY_DSN unset) — goes first
  // so exceptions below it are captured with the right request scope.
  app.use(sentry.requestHandler);

  // Tracing next so every later middleware can see req.id
  app.use(requestId);

  // Prometheus instrumentation (no-op overhead — just counts/timings).
  app.use(metrics.middleware());
  metrics.registerRoute(app);

  // Security baseline
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // CORS origin check commented out — allow all origins.
  // const prodOrigins = [env.FRONTEND_URL, env.ADMIN_URL].filter(Boolean);
  // const localhostRe = /^https?:\/\/localhost(:\d+)?$/;

  app.use(
    cors({
      origin: true, // allow all origins
      // origin: (origin, cb) => {
      //   if (!origin) return cb(null, true); // curl, Postman, server-to-server
      //   if (env.NODE_ENV !== 'production' && localhostRe.test(origin)) return cb(null, true);
      //   if (prodOrigins.includes(origin)) return cb(null, true);
      //   cb(new Error(`CORS: origin ${origin} not allowed`));
      // },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // Body parsers
  // NB: capture rawBody so the Zoho webhook route can verify HMAC
  // against the exact bytes Zoho sent (any re-stringify would break it).
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // HTTP logs: structured JSON line in prod, coloured Morgan in dev,
  // silent in tests.
  if (env.isProd) {
    app.use(requestLog);
  } else if (!env.isTest) {
    app.use(
      morgan('dev', {
        stream: logger.stream,
        skip: (req) => req.path === '/api/health' || req.path === '/api/ready' || req.path === '/metrics',
      }),
    );
  }

  // Global rate limiter (skipped in tests via the limiter itself)
  app.use(globalLimiter);

  // Routes
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/brands', brandRoutes);
  app.use('/api/bundles', bundleRoutes);
  app.use('/api/blog', blogRoutes);
  app.use('/api/hero-slides', heroSlideRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/social-links', socialLinksRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/currency', currencyRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/downloads', downloadRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/zoho', zohoRoutes);
  app.use('/api/admin/integrations', require('./routes/integrations'));
  app.use('/api/inquiries', inquiriesRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/docs', docsRoutes);

  // Sentry's own error handler — sits *before* ours so exceptions
  // are captured with the full request context intact.
  app.use(sentry.errorHandler);

  // 404 + error handler — must be last
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = buildApp;
