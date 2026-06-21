/**
 * Zoho Payments client — OAuth refresh-token grant + checkout-session
 * creation + webhook signature verification.
 *
 *   - Access tokens cached for ~1h (Zoho's typical lifetime).
 *   - Webhook payloads must be HMAC-SHA256 signed with
 *     `ZOHO_WEBHOOK_SECRET`. Always verify before trusting.
 *
 * The HTTP layer uses native `fetch` (Node 18+). Tests mock with `nock`.
 */

const crypto = require('crypto');
const cache = require('./cache.service');
const logger = require('../config/logger');
const appConfig = require('./appConfig.service');

const ACCESS_TOKEN_KEY = 'zoho:access-token';
const TOKEN_TTL_SECONDS = 60 * 50; // 50 min — Zoho default is 60 min

/* ────────── credential lookup (appConfig merges DB + env) ────────── */

function getStoredRefreshToken() { return appConfig.get('zoho.refreshToken') || null; }
function getStoredWebhookSecret() { return appConfig.get('zoho.webhookSecret') || null; }
function getStoredSigningKey() { return appConfig.get('zoho.signingKey') || process.env.ZOHO_SIGNING_KEY || null; }
function getAccountsHost() { return appConfig.get('zoho.accountsHost') || 'https://accounts.zoho.in'; }
function getClientId() { return appConfig.get('zoho.clientId') || null; }
function getClientSecret() { return appConfig.get('zoho.clientSecret') || null; }
function getApiBase() { return appConfig.get('zoho.apiBase') || 'https://payments.zoho.in/api/v1'; }
function getAccountId() { return appConfig.get('zoho.accountId') || process.env.ZOHO_ACCOUNT_ID || null; }

/* ────────── OAuth ────────── */

async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Zoho credentials not configured');
  }
  const host = getAccountsHost();
  const url =
    `${host}/oauth/v2/token?grant_type=refresh_token` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&refresh_token=${encodeURIComponent(refreshToken)}`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zoho OAuth failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Zoho OAuth response missing access_token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function getAccessToken() {
  return cache.wrap(ACCESS_TOKEN_KEY, TOKEN_TTL_SECONDS, refreshAccessToken);
}

/**
 * Exchange an authorization code for access + refresh tokens. Called
 * by the OAuth callback endpoint. Returns the full Zoho response so
 * the caller can persist the refresh token.
 */
async function exchangeCodeForTokens({ code, redirectUri, host }) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Zoho client id/secret not configured');
  }
  const accountsHost = host || getAccountsHost();
  const url =
    `${accountsHost}/oauth/v2/token?grant_type=authorization_code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) {
    const err = new Error(`Zoho authorization-code exchange failed: ${res.status} ${JSON.stringify(json)}`);
    err.zohoBody = json;
    err.zohoStatus = res.status;
    throw err;
  }
  return json; // { access_token, refresh_token, expires_in, api_domain, token_type, scope }
}

/* ────────── Checkout sessions ────────── */

/**
 * Create a hosted payment session via the Zoho Payments India API.
 * Correct endpoint: POST /api/v1/paymentsessions?account_id={id}
 * Returns { sessionId, accessKey } — frontend widget uses these.
 */
async function createCheckoutSession({ amount, currency = 'INR', description, referenceId, redirectUrl, cancelUrl, customer }) {
  const token = await getAccessToken();
  const accountId = getAccountId();
  if (!accountId) throw new Error('Zoho account_id not configured (set ZOHO_ACCOUNT_ID in .env)');

  const apiUrl = `${getApiBase()}/paymentsessions?account_id=${encodeURIComponent(accountId)}`;
  // Zoho requires HTTPS for success/failure URLs — swap http→https.
  // Localhost/non-routable hosts are rejected by Zoho; reroute to the canonical frontend.
  const env = require('../config/env');
  const canonicalBase = (env.FRONTEND_URL || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  const toHttps = (url) => {
    if (!url) return url;
    const httpsUrl = url.replace(/^http:\/\//i, 'https://');
    if (/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(httpsUrl)) {
      // Replace localhost origin with the public frontend URL
      return httpsUrl.replace(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i, canonicalBase);
    }
    return httpsUrl;
  };

  const pageDescription = description
    ? description.replace(/[^\w\s.,\-#]/g, '').slice(0, 255).trim() || 'Lexxus purchase'
    : 'Lexxus purchase';

  const body = {
    amount: Number(amount.toFixed(2)), // decimal rupees, e.g. 100.00
    currency,
    description: pageDescription, // top-level: required, max 500 chars
    max_retry_count: 3,
    configurations: {
      hosted_page_parameters: {
        description: pageDescription, // hosted page: also required
        ...(customer?.name ? { name: customer.name } : {}),
        ...(customer?.email ? { email: customer.email } : {}),
        phone_country_code: 'IN',
        success_url: toHttps(redirectUrl), // must be HTTPS
        failure_url: toHttps(cancelUrl),   // must be HTTPS
        ...(referenceId ? { udf1: referenceId } : {}),
      },
    },
  };

  logger.info('zoho.createCheckoutSession request', { url: apiUrl, amount, currency });
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  logger.info('zoho.createCheckoutSession response', { status: res.status, body: text.slice(0, 500) });
  if (!res.ok) {
    throw new Error(`Zoho session creation failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text);
  // Response: { code: 0, message: "success", payments_session: { payments_session_id, access_key, ... } }
  const session = json.payments_session || json;
  return {
    sessionId: session.payments_session_id || session.session_id || session.id,
    accessKey: session.access_key || null,
    paymentUrl: session.payment_url || null, // may be null for widget flow
    raw: json,
  };
}

/**
 * Retrieve a payment session to check its current status.
 * Used as a fallback for local dev where webhooks can't reach localhost.
 * Returns the raw session object or null on any failure.
 */
async function retrieveSession(sessionId) {
  const accountId = getAccountId();
  if (!accountId || !sessionId) return null;
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${getApiBase()}/paymentsessions/${encodeURIComponent(sessionId)}?account_id=${encodeURIComponent(accountId)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json) return null;
    return json.payments_session || json.payment_session || json;
  } catch {
    return null;
  }
}

/**
 * Refund a payment. Zoho returns a refund object.
 */
async function refundPayment({ paymentId, amount, reason }) {
  const token = await getAccessToken();
  const res = await fetch(`${getApiBase()}/payments/${paymentId}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    // C-4 FIX: Zoho Payments India uses decimal rupees throughout (same as
    // createCheckoutSession). Sending paise (×100) would charge 100× too much.
    body: JSON.stringify({ amount: Number(amount.toFixed(2)), reason }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zoho refund failed: ${res.status} ${text}`);
  }
  return res.json();
}

/* ────────── Webhook signature ────────── */

/**
 * Verify a Zoho webhook signature in constant time.
 * Zoho signs payloads with the Signing Key (from Developer Space).
 * `rawBody` must be the exact bytes Zoho sent (Buffer or string).
 * Falls back to webhook secret if signing key not configured.
 */
async function verifyWebhookSignature(rawBody, signature) {
  // Prefer Signing Key (from Developer Space > Authentication Keys)
  const secret = getStoredSigningKey() || getStoredWebhookSecret();
  if (!secret) {
    logger.warn('Zoho signing key not configured — rejecting webhook');
    return false;
  }
  if (!signature || typeof signature !== 'string') return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

module.exports = {
  refreshAccessToken,
  getAccessToken,
  exchangeCodeForTokens,
  getStoredRefreshToken,
  getStoredWebhookSecret,
  retrieveSession,
  createCheckoutSession,
  refundPayment,
  verifyWebhookSignature,
};
