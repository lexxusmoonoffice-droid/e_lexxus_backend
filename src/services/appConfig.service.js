/**
 * appConfig — runtime-resolved application configuration.
 *
 * Merges the Settings singleton (DB) with the process `.env` so admins
 * can manage secrets + tunables from the UI without restarting the
 * backend. DB values win; env is the fallback / boot-default.
 *
 * The resolved object is cached in memory. Services read it
 * synchronously via `get('b2.keyId')`. Call `reload()` after writes so
 * the in-memory copy reflects the new DB state.
 *
 * Services should *not* mutate the cached object — write through the
 * admin endpoints which persist to Settings + call `reload()`.
 */

const env = require('../config/env');
const logger = require('../config/logger');

let cached = null;

function mergeString(db, fallback) {
  return (db !== undefined && db !== null && db !== '') ? db : (fallback || '');
}
function mergeNumber(db, fallback) {
  if (db === undefined || db === null || db === '') return fallback;
  const n = Number(db);
  return Number.isFinite(n) ? n : fallback;
}
function mergeBoolean(db, fallback) {
  if (db === undefined || db === null) return fallback;
  return !!db;
}

async function reload() {
  _kycPending = false; // clear on reconnect
  // Pull the Settings singleton with every select:false field included.
  const { Settings } = require('../models');
  const doc = await Settings.findOne(
    {},
    '+integrations.zoho.clientSecret +integrations.zoho.refreshToken +integrations.zoho.webhookSecret +integrations.zoho.signingKey' +
    ' +integrations.b2.appKey +integrations.cloudflare.apiToken +integrations.smtp.pass' +
    ' +integrations.stripe.secretKey +integrations.stripe.webhookSecret' +
    ' +integrations.razorpay.keySecret +integrations.razorpay.webhookSecret' +
    ' +observability.sentryDsn',
  );
  const i = doc?.integrations || {};
  const l = doc?.limits || {};
  const o = doc?.observability || {};
  const p = doc?.payments || {};

  cached = {
    // ── payment provider flags & default ──────────────────────────────
    payments: {
      // Auto-enable a provider when its credentials are present in env,
      // unless the DB explicitly disabled it (false).
      zohoEnabled:     mergeBoolean(p.zohoEnabled,     true),
      stripeEnabled:   mergeBoolean(p.stripeEnabled,   !!(env.STRIPE_SECRET_KEY)),
      razorpayEnabled: mergeBoolean(p.razorpayEnabled, !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)),
      // env.PAYMENT_PROVIDER wins over DB setting (easy local override)
      defaultProvider: env.PAYMENT_PROVIDER || p.defaultProvider || 'zoho',
    },
    // ── provider credentials ─────────────────────────────────────────
    b2: {
      keyId:       mergeString(i.b2?.keyId,       env.B2_KEY_ID),
      appKey:      mergeString(i.b2?.appKey,      env.B2_APP_KEY),
      bucketName:  mergeString(i.b2?.bucketName,  env.B2_BUCKET_NAME),
      region:      mergeString(i.b2?.region,      env.B2_REGION),
      endpoint:    mergeString(i.b2?.endpoint,    env.B2_ENDPOINT),
      endpointHost:mergeString(i.b2?.endpointHost,env.B2_ENDPOINT_HOST),
      cdnDomain:   mergeString(i.b2?.cdnDomain,  env.CDN_DOMAIN),
    },
    cloudflare: {
      accountId: mergeString(i.cloudflare?.accountId, env.CF_ACCOUNT_ID),
      apiToken:  mergeString(i.cloudflare?.apiToken,  env.CF_API_TOKEN),
    },
    zoho: {
      clientId:     mergeString(i.zoho?.clientId,     env.ZOHO_CLIENT_ID),
      clientSecret: mergeString(i.zoho?.clientSecret, env.ZOHO_CLIENT_SECRET),
      refreshToken: mergeString(i.zoho?.refreshToken, env.ZOHO_REFRESH_TOKEN),
      webhookSecret:mergeString(i.zoho?.webhookSecret,env.ZOHO_WEBHOOK_SECRET),
      signingKey:   mergeString(i.zoho?.signingKey,   env.ZOHO_SIGNING_KEY),
      apiKey:       mergeString(i.zoho?.apiKey,       env.ZOHO_API_KEY),
      accountId:    mergeString(i.zoho?.accountId,    env.ZOHO_ACCOUNT_ID),
      apiBase:      mergeString(i.zoho?.apiBase,      env.ZOHO_API_BASE) || 'https://payments.zoho.in/api/v1',
      accountsHost: mergeString(i.zoho?.accountsHost, '') || 'https://accounts.zoho.in',
      scope:        i.zoho?.scope || null,
      connectedAt:  i.zoho?.connectedAt || null,
    },
    stripe: {
      secretKey:     mergeString(i.stripe?.secretKey,     env.STRIPE_SECRET_KEY),
      webhookSecret: mergeString(i.stripe?.webhookSecret, env.STRIPE_WEBHOOK_SECRET),
      currency:      mergeString(i.stripe?.currency,      env.STRIPE_CURRENCY) || 'inr',
    },
    razorpay: {
      keyId:         mergeString(i.razorpay?.keyId,         env.RAZORPAY_KEY_ID),
      keySecret:     mergeString(i.razorpay?.keySecret,     env.RAZORPAY_KEY_SECRET),
      webhookSecret: mergeString(i.razorpay?.webhookSecret, env.RAZORPAY_WEBHOOK_SECRET),
      currency:      mergeString(i.razorpay?.currency,      env.RAZORPAY_CURRENCY) || 'INR',
    },
    smtp: {
      host:     mergeString(i.smtp?.host,     env.SMTP_HOST),
      port:     mergeNumber(i.smtp?.port,     env.SMTP_PORT),
      secure:   mergeBoolean(i.smtp?.secure,  env.SMTP_SECURE),
      user:     mergeString(i.smtp?.user,     env.SMTP_USER),
      pass:     mergeString(i.smtp?.pass,     env.SMTP_PASS),
      mailFrom: mergeString(i.smtp?.mailFrom, env.MAIL_FROM),
    },
    limits: {
      downloadTokenTtlDays:    mergeNumber(l.downloadTokenTtlDays,    env.DOWNLOAD_TOKEN_TTL_DAYS)    || 30,
      downloadLimitPerOrder:   mergeNumber(l.downloadLimitPerOrder,   env.DOWNLOAD_LIMIT_PER_ORDER)   || 5,
      downloadRateLimitPerHour:mergeNumber(l.downloadRateLimitPerHour,env.DOWNLOAD_RATE_LIMIT_PER_HOUR)|| 10,
      globalRateLimitPer15Min: mergeNumber(l.globalRateLimitPer15Min, env.GLOBAL_RATE_LIMIT_PER_15MIN)|| 300,
    },
    observability: {
      sentryDsn: mergeString(o.sentryDsn, env.SENTRY_DSN),
    },
  };
  return cached;
}

/** Boot-time init. If DB is unreachable, fall back to env-only config. */
async function init() {
  try {
    await reload();
    logger.info('appConfig: loaded from DB+env');
  } catch (err) {
    logger.warn('appConfig: DB lookup failed — using env only', { err: err.message });
    cached = await reloadFromEnvOnly();
  }
}

async function reloadFromEnvOnly() {
  const originalFind = require('../models').Settings.findOne;
  try {
    require('../models').Settings.findOne = async () => null;
    return await reload();
  } finally {
    require('../models').Settings.findOne = originalFind;
  }
}

// Runtime flag set by zoho.service when the Payments API returns 401/403.
// Cleared on appConfig.reload() (i.e. when a new refresh token is saved).
let _kycPending = false;

function setKycPending(v) { _kycPending = !!v; }

function get(path) {
  // Allow reading the live KYC flag
  if (path === 'zoho._kycPending') return _kycPending;
  if (!cached) {
    // Synchronous fallback — let callers work even before init() finishes.
    // Once init() lands, subsequent reads see DB values.
    return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), {
      payments: { zohoEnabled: true, stripeEnabled: false, razorpayEnabled: false, defaultProvider: 'zoho' },
      b2: { keyId: env.B2_KEY_ID, appKey: env.B2_APP_KEY, bucketName: env.B2_BUCKET_NAME, region: env.B2_REGION, endpoint: env.B2_ENDPOINT, endpointHost: env.B2_ENDPOINT_HOST, cdnDomain: env.CDN_DOMAIN },
      cloudflare: { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN },
      zoho: { clientId: env.ZOHO_CLIENT_ID, clientSecret: env.ZOHO_CLIENT_SECRET, refreshToken: env.ZOHO_REFRESH_TOKEN, webhookSecret: env.ZOHO_WEBHOOK_SECRET, signingKey: env.ZOHO_SIGNING_KEY, apiKey: env.ZOHO_API_KEY, accountId: env.ZOHO_ACCOUNT_ID, apiBase: env.ZOHO_API_BASE || 'https://payments.zoho.in/api/v1', accountsHost: 'https://accounts.zoho.in' },
      stripe: { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, currency: env.STRIPE_CURRENCY || 'inr' },
      razorpay: { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET, currency: env.RAZORPAY_CURRENCY || 'INR' },
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, pass: env.SMTP_PASS, mailFrom: env.MAIL_FROM },
      limits: { downloadTokenTtlDays: env.DOWNLOAD_TOKEN_TTL_DAYS || 30, downloadLimitPerOrder: env.DOWNLOAD_LIMIT_PER_ORDER || 5, downloadRateLimitPerHour: env.DOWNLOAD_RATE_LIMIT_PER_HOUR || 10, globalRateLimitPer15Min: env.GLOBAL_RATE_LIMIT_PER_15MIN || 300 },
      observability: { sentryDsn: env.SENTRY_DSN },
    });
  }
  return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), cached);
}

function current() { return cached; }

/** Returns a safe-for-API object that masks secret fields. */
function snapshotForAdmin() {
  const c = current();
  if (!c) return null;
  return {
    // ── payment toggles (fully safe to expose) ───────────────────────
    payments: { ...c.payments },
    // ── provider credentials (secrets masked) ────────────────────────
    b2: {
      keyId:        c.b2.keyId || '',
      appKeySet:    !!c.b2.appKey,
      bucketName:   c.b2.bucketName || '',
      region:       c.b2.region || '',
      endpoint:     c.b2.endpoint || '',
      endpointHost: c.b2.endpointHost || '',
      cdnDomain:    c.b2.cdnDomain || '',
    },
    cloudflare: {
      accountId:    c.cloudflare.accountId || '',
      apiTokenSet:  !!c.cloudflare.apiToken,
    },
    zoho: {
      clientId:        c.zoho.clientId || '',
      clientSecretSet: !!c.zoho.clientSecret,
      refreshTokenSet: !!c.zoho.refreshToken,
      webhookSecretSet:!!c.zoho.webhookSecret,
      signingKeySet:   !!c.zoho.signingKey,
      accountId:       c.zoho.accountId || '',  // non-sensitive
      apiKeySet:       !!c.zoho.apiKey,
      apiBase:         c.zoho.apiBase,
      accountsHost:    c.zoho.accountsHost,
      connectedAt:     c.zoho.connectedAt,
      scope:           c.zoho.scope,
    },
    stripe: {
      secretKeySet:     !!c.stripe.secretKey,
      webhookSecretSet: !!c.stripe.webhookSecret,
      currency:         c.stripe.currency || 'inr',
    },
    razorpay: {
      keyId:            c.razorpay.keyId || '',   // public key — safe to expose
      keySecretSet:     !!c.razorpay.keySecret,
      webhookSecretSet: !!c.razorpay.webhookSecret,
      currency:         c.razorpay.currency || 'INR',
    },
    smtp: {
      host:     c.smtp.host || '',
      port:     c.smtp.port || '',
      secure:   !!c.smtp.secure,
      user:     c.smtp.user || '',
      passSet:  !!c.smtp.pass,
      mailFrom: c.smtp.mailFrom || '',
    },
    limits: { ...c.limits },
    observability: {
      sentryDsnSet: !!c.observability.sentryDsn,
    },
  };
}

module.exports = { init, reload, get, current, snapshotForAdmin, setKycPending };
