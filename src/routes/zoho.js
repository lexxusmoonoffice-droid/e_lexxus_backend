/**
 * Zoho OAuth authorization-code flow.
 *
 *   GET  /api/zoho/connect       admin → returns { authUrl } to open
 *   GET  /api/zoho/callback      redirect URI — exchanges code for tokens,
 *                                persists refresh token in Settings, and
 *                                redirects the admin back to the dashboard
 *   GET  /api/zoho/status        admin → { connected: bool, connectedAt, scope }
 *   POST /api/zoho/disconnect    admin → clears stored refresh token
 *   POST /api/zoho/webhook-secret admin → sets webhook secret in DB
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const env = require('../config/env');
const logger = require('../config/logger');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const cache = require('../services/cache.service');
const zoho = require('../services/zoho.service');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const audit = require('../services/audit.service');
const { Settings } = require('../models');
const appConfig = require('../services/appConfig.service');

const router = express.Router();

const STATE_TTL_SECONDS = 15 * 60;
const STATE_PREFIX = 'zoho:oauth:state:';

const DEFAULT_SCOPE = 'ZohoPayments.fullaccess.all';

function callbackUri() {
  return `${env.API_URL}/api/zoho/callback`;
}

function adminUrl(path) {
  const base = env.ADMIN_URL || 'http://localhost:3001';
  return `${base}${path}`;
}

const connect = asyncHandler(async (req, res) => {
  if (!env.ZOHO_CLIENT_ID) {
    throw AppError.badRequest('ZOHO_CLIENT_ID not set in backend .env', 'NO_CLIENT_ID');
  }
  const settings = await Settings.getSettings();
  const accountsHost = settings.integrations?.zoho?.accountsHost || 'https://accounts.zoho.in';
  const scope = req.query.scope || settings.integrations?.zoho?.scope || DEFAULT_SCOPE;

  const state = crypto.randomBytes(24).toString('hex');
  await cache.set(
    STATE_PREFIX + state,
    { userId: req.user._id.toString(), accountsHost, scope },
    STATE_TTL_SECONDS,
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ZOHO_CLIENT_ID,
    scope,
    redirect_uri: callbackUri(),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  const authUrl = `${accountsHost}/oauth/v2/auth?${params.toString()}`;
  res.json({ authUrl, callbackUri: callbackUri(), scope });
});

const callback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(adminUrl(`/settings?zoho=error&reason=${encodeURIComponent(String(error))}`));
  }
  if (!code || !state) {
    return res.redirect(adminUrl('/settings?zoho=error&reason=missing-code'));
  }
  const ctx = await cache.get(STATE_PREFIX + state);
  if (!ctx) {
    return res.redirect(adminUrl('/settings?zoho=error&reason=state-expired'));
  }
  await cache.del(STATE_PREFIX + state);

  let tokens;
  try {
    tokens = await zoho.exchangeCodeForTokens({
      code: String(code),
      redirectUri: callbackUri(),
      host: ctx.accountsHost,
    });
  } catch (e) {
    logger.error('zoho.callback exchange failed', { err: e.message });
    return res.redirect(
      adminUrl(`/settings?zoho=error&reason=${encodeURIComponent('exchange-failed')}`),
    );
  }

  const settings = await Settings.getSettings();
  settings.integrations = settings.integrations || {};
  settings.integrations.zoho = {
    ...(settings.integrations.zoho || {}),
    refreshToken: tokens.refresh_token,
    accountsHost: ctx.accountsHost,
    scope: tokens.scope || ctx.scope,
    connectedAt: new Date(),
    ...(ctx.userId && ctx.userId !== 'dev-setup' ? { connectedBy: ctx.userId } : {}),
  };
  await settings.save();

  // Drop any cached access token so the next call re-issues against the
  // new refresh token. Reload appConfig so the in-memory cache reflects
  // the new refresh token without requiring a server restart.
  await cache.del('zoho:access-token');
  await appConfig.reload();

  logger.info('zoho: connected', { by: ctx.userId });

  if (env.NODE_ENV === 'development' && req.query._dev) {
    return res.send('<h1>Zoho Connected!</h1><p>Refresh token saved. Payments are now enabled. You can close this tab.</p>');
  }
  return res.redirect(adminUrl('/settings?zoho=connected'));
});

const status = asyncHandler(async (req, res) => {
  const settings = await Settings.findOne({}, '+integrations.zoho.refreshToken +integrations.zoho.webhookSecret');
  const z = settings?.integrations?.zoho || {};
  res.json({
    connected: !!(z.refreshToken || env.ZOHO_REFRESH_TOKEN),
    connectedAt: z.connectedAt || null,
    scope: z.scope || null,
    accountsHost: z.accountsHost || 'https://accounts.zoho.in',
    webhookSecretSet: !!(z.webhookSecret || env.ZOHO_WEBHOOK_SECRET),
    clientIdSet: !!env.ZOHO_CLIENT_ID,
    clientSecretSet: !!env.ZOHO_CLIENT_SECRET,
    callbackUri: callbackUri(),
  });
});

const disconnect = asyncHandler(async (req, res) => {
  const settings = await Settings.getSettings();
  if (settings.integrations?.zoho) {
    settings.integrations.zoho.refreshToken = undefined;
    settings.integrations.zoho.connectedAt = undefined;
    settings.integrations.zoho.connectedBy = undefined;
    await settings.save();
  }
  await cache.del('zoho:access-token');
  await audit.logAction(req, 'zoho.disconnect', 'Settings', settings._id);
  res.json({ ok: true });
});

const webhookSecretSchema = z.object({
  secret: z.string().min(8).max(256),
});
const setWebhookSecret = asyncHandler(async (req, res) => {
  const settings = await Settings.getSettings();
  settings.integrations = settings.integrations || {};
  settings.integrations.zoho = {
    ...(settings.integrations.zoho || {}),
    webhookSecret: req.body.secret,
  };
  await settings.save();
  await audit.logAction(req, 'zoho.webhook-secret', 'Settings', settings._id);
  res.json({ ok: true });
});

// Public callback — Zoho redirects here from the authorize page.
router.get('/callback', callback);

// Admin-gated endpoints
router.get('/connect', requireAuth, requireAdmin, connect);
router.get('/status', requireAuth, requireAdmin, status);
router.post('/disconnect', requireAuth, requireAdmin, disconnect);
router.post('/webhook-secret', requireAuth, requireAdmin, validate(webhookSecretSchema), setWebhookSecret);

// Dev-only: initiate Zoho OAuth without requiring admin login.
// Visit http://localhost:5050/api/zoho/dev-connect in a browser to start the flow.
if (env.NODE_ENV === 'development') {
  router.get('/dev-connect', asyncHandler(async (_req, res) => {
    if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
      return res.status(400).send('<h1>ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not set in backend .env</h1>');
    }
    const settings = await Settings.getSettings();
    const accountsHost = settings.integrations?.zoho?.accountsHost || 'https://accounts.zoho.in';
    const scope = DEFAULT_SCOPE;

    const state = crypto.randomBytes(24).toString('hex');
    await cache.set(STATE_PREFIX + state, { userId: 'dev-setup', accountsHost, scope }, STATE_TTL_SECONDS);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.ZOHO_CLIENT_ID,
      scope,
      redirect_uri: callbackUri(),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    const authUrl = `${accountsHost}/oauth/v2/auth?${params.toString()}`;

    res.send(`<!DOCTYPE html><html><head><title>Zoho OAuth Setup</title></head><body style="font-family:sans-serif;max-width:600px;margin:60px auto;padding:0 20px">
<h2>Zoho Payments OAuth Setup</h2>
<p>Click the button below to authorize Lexxus to access Zoho Payments.</p>
<p style="font-size:12px;color:#666">Callback URI: <code>${callbackUri()}</code><br>Make sure this is registered as an allowed redirect URI in your Zoho app settings.</p>
<a href="${authUrl}" style="display:inline-block;background:#0066cc;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px">Connect Zoho Payments</a>
</body></html>`);
  }));
}

module.exports = router;
