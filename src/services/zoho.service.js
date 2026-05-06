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
function getAccountsHost() { return appConfig.get('zoho.accountsHost') || 'https://accounts.zoho.in'; }
function getClientId() { return appConfig.get('zoho.clientId') || null; }
function getClientSecret() { return appConfig.get('zoho.clientSecret') || null; }
function getApiBase() { return appConfig.get('zoho.apiBase') || 'https://payments.zoho.in/api/v1'; }

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
 * Create a hosted checkout session. Returns the data we need to send the
 * buyer to Zoho's pay page.
 */
async function createCheckoutSession({ amount, currency = 'INR', description, referenceId, redirectUrl, cancelUrl, customer }) {
  const token = await getAccessToken();
  const apiUrl = `${getApiBase()}/sessions`;
  const body = {
    amount: Math.round(amount * 100), // smallest unit (paise)
    currency,
    description,
    reference_id: referenceId,
    redirect_url: redirectUrl,
    cancel_url: cancelUrl,
    customer,
  };
  logger.info('zoho.createCheckoutSession request', { url: apiUrl, body });
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
  return {
    sessionId: json.session_id || json.id,
    paymentUrl: json.payment_url || json.url,
    raw: json,
  };
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
    body: JSON.stringify({ amount: Math.round(amount * 100), reason }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zoho refund failed: ${res.status} ${text}`);
  }
  return res.json();
}

/* ────────── Webhook signature ────────── */

/**
 * Verify a webhook payload's HMAC-SHA256 signature in constant time.
 * `rawBody` must be the exact bytes Zoho sent (Buffer or string).
 * Prefers the DB-stored webhook secret, falls back to env.
 */
async function verifyWebhookSignature(rawBody, signature) {
  const secret = getStoredWebhookSecret();
  if (!secret) {
    logger.warn('Zoho webhook secret not configured — rejecting webhook');
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
  createCheckoutSession,
  refundPayment,
  verifyWebhookSignature,
};
