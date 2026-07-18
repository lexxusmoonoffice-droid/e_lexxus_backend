/**
 * cacheControl(seconds, [opts]) — sets a public Cache-Control header
 * on the response. Express's built-in ETag still applies, so clients
 * benefit from 304s in addition to age-based caching.
 *
 *   router.get('/', cacheControl(60), handler);
 *
 * In test mode it's a no-op so test assertions don't have to deal
 * with header noise.
 */
const env = require('../config/env');

const cacheControl = (seconds = 60, { swr = seconds * 2, scope = 'public' } = {}) =>
  (req, res, next) => {
    if (env.isTest || env.isDev) return next();
    res.setHeader(
      'Cache-Control',
      `${scope}, max-age=${seconds}, stale-while-revalidate=${swr}`,
    );
    next();
  };

module.exports = cacheControl;
