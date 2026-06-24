/**
 * Zoho Payments client — OAuth refresh-token grant + checkout-session
 * creation + webhook signature verification.
 *
 *   - Access tokens cached for ~1h (Zoho's typical lifetime).
 *   - Webhook payloads must be HMAC-SHA256 signed with
 *     `ZOHO_SIGNING_KEY`. Always verify before trusting.
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

// Z-13 FIX: send OAuth params in POST body (not URL query string) to avoid
// leaking client_secret in server/proxy access logs.
async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Zoho credentials not configured');
  }
  const host = getAccountsHost();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${host}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
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
  // If a direct API key is configured, use it — no OAuth refresh needed.
  // Get the API key from: payments.zoho.in → Settings → Developers → API Keys
  const apiKey = appConfig.get('zoho.apiKey');
  if (apiKey) return apiKey;
  // Fall back to OAuth refresh-token flow
  return cache.wrap(ACCESS_TOKEN_KEY, TOKEN_TTL_SECONDS, refreshAccessToken);
}

/**
 * Exchange an authorization code for access + refresh tokens. Called
 * by the OAuth callback endpoint. Returns the full Zoho response so
 * the caller can persist the refresh token.
 * Z-13 FIX: params in POST body, not URL query string.
 */
async function exchangeCodeForTokens({ code, redirectUri, host }) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Zoho client id/secret not configured');
  }
  const accountsHost = host || getAccountsHost();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${accountsHost}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
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
 * Endpoint: POST /api/v1/paymentsessions?account_id={id}
 * Returns { sessionId, accessKey, paymentUrl }.
 */
async function createCheckoutSession({ amount, currency = 'INR', description, referenceId, redirectUrl, cancelUrl, customer }) {
  const token = await getAccessToken();
  const accountId = getAccountId();
  if (!accountId) throw new Error('Zoho account_id not configured (set ZOHO_ACCOUNT_ID in .env)');

  const apiUrl = `${getApiBase()}/paymentsessions?account_id=${encodeURIComponent(accountId)}`;

  // Z-3 FIX: use ZOHO_PUBLIC_FRONTEND_URL (e.g. ngrok URL) as canonical base when set.
  // In production set FRONTEND_URL to the real domain — no extra var needed.
  // In dev, run: ngrok http 3000  →  set ZOHO_PUBLIC_FRONTEND_URL=https://abc.ngrok.io
  const env = require('../config/env');
  const publicBase = (
    env.ZOHO_PUBLIC_FRONTEND_URL ||
    env.FRONTEND_URL ||
    ''
  ).replace(/\/$/, '');

  const toPublicHttps = (url) => {
    if (!url) return url;
    // If publicBase is a real public HTTPS URL, replace the origin of any localhost URL.
    if (publicBase && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(publicBase)) {
      return url.replace(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i, publicBase);
    }
    // Fallback: just upgrade to https (may still be rejected by Zoho in dev).
    return url.replace(/^http:\/\//i, 'https://');
  };

  const pageDescription = description
    ? description.replace(/[^\w\s.,\-#]/g, '').slice(0, 255).trim() || 'Lexxus purchase'
    : 'Lexxus purchase';

  const body = {
    amount: Number(amount.toFixed(2)), // decimal rupees, e.g. 100.00
    currency,
    description: pageDescription,
    max_retry_count: 3,
    configurations: {
      hosted_page_parameters: {
        description: pageDescription,
        ...(customer?.name  ? { name:  customer.name  } : {}),
        ...(customer?.email ? { email: customer.email } : {}),
        // Z-12 FIX: only include phone_country_code when a phone number is provided.
        ...(customer?.phone ? { phone: customer.phone, phone_country_code: 'IN' } : {}),
        success_url: toPublicHttps(redirectUrl),
        failure_url: toPublicHttps(cancelUrl),
        ...(referenceId ? { udf1: referenceId } : {}),
      },
    },
  };

  logger.info('zoho.createCheckoutSession request', { url: apiUrl, amount, currency, success_url: body.configurations.hosted_page_parameters.success_url });
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
    // 401 "Not An Authorized User" means the Zoho Payments account KYC is not yet complete
    // or the account_id doesn't match the authenticated user's organization.
    if (res.status === 401 || res.status === 403) {
      // Flag so the /available endpoint can report KYC_PENDING to the frontend.
      appConfig.setKycPending(true);
      const err = new Error('Zoho Payments account not activated (KYC pending or unauthorized)');
      err.zohoStatus = res.status;
      err.zohoBody = text;
      err.code = 'ZOHO_UNAUTHORIZED';
      throw err;
    }
    throw new Error(`Zoho session creation failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text);
  // Response: { code: 0, message: "success", payments_session: { payments_session_id, access_key, redirect_url, ... } }
  const session = json.payments_session || json.payment_session;
  if (!session) {
    throw new Error(`Zoho unexpected response shape: ${text.slice(0, 300)}`);
  }
  // Z-4 FIX: Zoho Payments India returns the hosted page URL as `redirect_url`, not `payment_url`.
  const paymentUrl =
    session.redirect_url ||
    session.payment_link ||
    session.hosted_page_url ||
    session.payment_url ||
    null;

  return {
    sessionId: session.payments_session_id || session.session_id || session.id,
    accessKey: session.access_key || null,
    paymentUrl,
    raw: json,
  };
}

/**
 * Retrieve a payment session to check its current status.
 * Used as a fallback for local dev where webhooks can't reach localhost.
 * Z-6 FIX: never returns the outer envelope — returns null if shape is unrecognized.
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
    const session = json.payments_session || json.payment_session;
    if (!session) {
      logger.warn('zoho.retrieveSession: unrecognized response shape', { keys: Object.keys(json) });
      return null;
    }
    return session;
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
 * Z-8 FIX: strip optional "sha256=" prefix Zoho may prepend to the signature.
 */
async function verifyWebhookSignature(rawBody, signature) {
  const secret = getStoredSigningKey() || getStoredWebhookSecret();
  if (!secret) {
    logger.warn('Zoho signing key not configured — rejecting webhook');
    return false;
  }
  if (!signature || typeof signature !== 'string') return false;
  // Z-8 FIX: strip "sha256=" prefix if present.
  const normalizedSig = signature.replace(/^sha256=/i, '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== normalizedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedSig));
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
