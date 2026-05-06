/**
 * Orphan-file sweeper.
 *
 * Walks every B2 object under known prefixes and deletes ones that
 *   (a) are not referenced by any DB record AND
 *   (b) are older than 24 hours (so we don't race in-flight uploads
 *       still in their presigned-upload window).
 *
 * Designed to run on a daily cron via BullMQ (Phase 11). For now,
 * `runOrphanSweep()` can be invoked directly:
 *   node -e "require('./src/jobs/orphanSweeper').runOrphanSweep()"
 */

const env = require('../config/env');
const logger = require('../config/logger');
const b2 = require('../services/b2');
const { Product, Bundle, BlogPost, HeroSlide, User } = require('../models');

const PREFIXES = [
  'products/',
  'images/product/',
  'images/bundle/',
  'images/blog/',
  'images/hero/',
  'images/avatar/',
];

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

async function collectReferencedKeys() {
  const keys = new Set();
  function add(v) {
    if (typeof v === 'string' && v) keys.add(v);
  }

  // Pull lightweight projections; .lean() for speed.
  const [products, bundles, blog, hero, users] = await Promise.all([
    Product.find({}, 'file.b2FileName thumbnail images').lean(),
    Bundle.find({}, 'image images').lean(),
    BlogPost.find({}, 'image').lean(),
    HeroSlide.find({}, 'img').lean(),
    User.find({}, 'avatar').lean(),
  ]);

  for (const p of products) {
    add(p.file?.b2FileName);
    add(extractKey(p.thumbnail));
    (p.images || []).forEach((u) => add(extractKey(u)));
  }
  for (const b of bundles) {
    add(extractKey(b.image));
    (b.images || []).forEach((u) => add(extractKey(u)));
  }
  for (const post of blog) add(extractKey(post.image));
  for (const slide of hero) add(extractKey(slide.img));
  for (const u of users) add(extractKey(u.avatar));

  return keys;
}

/** If a stored URL points at our CDN/B2, recover the bucket key portion. */
function extractKey(url) {
  if (!url || typeof url !== 'string') return null;
  if (env.CDN_DOMAIN && url.includes(env.CDN_DOMAIN)) {
    const i = url.indexOf(env.CDN_DOMAIN);
    return decodeURI(url.slice(i + env.CDN_DOMAIN.length + 1).split('?')[0]);
  }
  if (url.includes(env.B2_ENDPOINT_HOST)) {
    const after = url.split(env.B2_ENDPOINT_HOST)[1] || '';
    // form: /<bucket>/<key>?...
    const path = after.split('?')[0];
    const parts = path.replace(/^\/+/, '').split('/');
    parts.shift(); // drop bucket
    return decodeURI(parts.join('/'));
  }
  return null;
}

async function runOrphanSweep({ dryRun = true, now = Date.now() } = {}) {
  const referenced = await collectReferencedKeys();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  let scanned = 0;
  let candidates = 0;
  let deleted = 0;
  const errors = [];

  for (const prefix of PREFIXES) {
    // eslint-disable-next-line no-restricted-syntax
    for await (const obj of b2.listAll(prefix)) {
      scanned += 1;
      if (referenced.has(obj.Key)) continue;
      const ts = obj.LastModified ? new Date(obj.LastModified).getTime() : now;
      if (ts > cutoff) continue;
      candidates += 1;
      if (dryRun) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await b2.deleteObject(obj.Key);
        deleted += 1;
      } catch (err) {
        errors.push({ key: obj.Key, message: err.message });
      }
    }
  }
  const summary = { scanned, candidates, deleted, errors, dryRun };
  logger.info('orphan-sweep complete', summary);
  return summary;
}

module.exports = { runOrphanSweep, collectReferencedKeys, extractKey };
