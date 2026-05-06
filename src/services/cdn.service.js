/**
 * Cloudflare CDN URL helpers.
 *
 * The B2 bucket is private. The frontend never gets the raw B2 host.
 * We generate a B2-signed URL, then rewrite its host to our CDN
 * domain (Cloudflare proxies the request and serves through the
 * partnership for free egress).
 *
 * If `CDN_DOMAIN` isn't configured, we fall back to the raw B2 URL.
 * That keeps dev usable without Cloudflare set up.
 */

const appConfig = require('./appConfig.service');
const b2 = require('./b2');

/** Public CDN URL for an object key (unsigned — only useful for public buckets / images cache). */
function publicUrl(key) {
  if (!key) return null;
  const b2c = appConfig.get('b2') || {};
  if (b2c.cdnDomain) return `https://${b2c.cdnDomain}/${encodeURI(key)}`;
  return `${b2c.endpoint}/${b2c.bucketName}/${encodeURI(key)}`;
}

/** Time-limited signed URL (used for paid downloads + admin previews). */
async function signedDownloadUrl(key, { expiresIn = 300, attachment = true } = {}) {
  const signed = await b2.presignGetUrl({ key, expiresIn, attachment });
  const b2c = appConfig.get('b2') || {};
  if (!b2c.cdnDomain) return signed;
  return signed.replace(b2c.endpointHost, b2c.cdnDomain);
}

module.exports = { publicUrl, signedDownloadUrl };
