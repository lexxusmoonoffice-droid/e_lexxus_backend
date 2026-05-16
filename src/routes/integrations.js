/**
 * Admin integration settings — runtime config that the services pick
 * up from the Settings singleton via appConfig.service. Anything you
 * save here takes effect on the next request (no backend restart).
 *
 *   GET    /api/admin/integrations               masked snapshot
 *   PUT    /api/admin/integrations/b2            store creds / bucket / CDN
 *   PUT    /api/admin/integrations/cloudflare    store CF account + token
 *   PUT    /api/admin/integrations/smtp          store SMTP + mail from
 *   PUT    /api/admin/integrations/zoho          store client id/secret/api base
 *   PUT    /api/admin/integrations/stripe        store Stripe secret key + webhook secret
 *   PUT    /api/admin/integrations/razorpay      store Razorpay key id/secret
 *   PUT    /api/admin/integrations/payments      toggle providers + set defaultProvider
 *   PUT    /api/admin/integrations/limits        token TTL, download limit, rate limits
 *   PUT    /api/admin/integrations/observability sentry dsn
 *   POST   /api/admin/integrations/test/b2       round-trip upload to B2
 *   POST   /api/admin/integrations/test/smtp     send a test email
 *   POST   /api/admin/integrations/test/cloudflare  verify CF token
 *   POST   /api/admin/integrations/test/stripe   verify Stripe credentials
 *   POST   /api/admin/integrations/test/razorpay verify Razorpay credentials
 */

const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const audit = require('../services/audit.service');
const appConfig = require('../services/appConfig.service');
const mailer = require('../services/mailer.service');
const b2 = require('../services/b2');
const { Settings } = require('../models');

const router = express.Router();
router.use(requireAuth, requireAdmin);

/* ─── helpers ────────────────────────────────────────────────────── */

async function saveIntegrations(section, patch) {
  const doc = await Settings.findOne({}) || (await Settings.getSettings());
  doc.integrations = doc.integrations || {};
  doc.integrations[section] = { ...(doc.integrations[section] || {}), ...patch };
  doc.markModified('integrations');
  await doc.save();
  await appConfig.reload();
  return doc;
}
async function saveTop(field, patch) {
  const doc = await Settings.findOne({}) || (await Settings.getSettings());
  doc[field] = { ...(doc[field] || {}), ...patch };
  doc.markModified(field);
  await doc.save();
  await appConfig.reload();
  return doc;
}

/* ─── schemas ────────────────────────────────────────────────────── */

const b2Schema = z.object({
  keyId: z.string().optional(),
  appKey: z.string().optional(),
  bucketName: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().url().optional().or(z.literal('')),
  endpointHost: z.string().optional(),
  cdnDomain: z.string().optional(),
});
const cloudflareSchema = z.object({
  accountId: z.string().optional(),
  apiToken: z.string().optional(),
});
const smtpSchema = z.object({
  host: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.coerce.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  mailFrom: z.string().optional(),
});
const zohoSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  apiBase: z.string().url().optional().or(z.literal('')),
  accountsHost: z.string().url().optional().or(z.literal('')),
});
const limitsSchema = z.object({
  downloadTokenTtlDays: z.coerce.number().int().min(1).max(365).optional(),
  downloadLimitPerOrder: z.coerce.number().int().min(1).max(100).optional(),
  downloadRateLimitPerHour: z.coerce.number().int().min(1).max(10000).optional(),
  globalRateLimitPer15Min: z.coerce.number().int().min(1).max(1_000_000).optional(),
});
const observabilitySchema = z.object({
  sentryDsn: z.string().optional(),
});
const stripeSchema = z.object({
  secretKey:     z.string().optional(),
  webhookSecret: z.string().optional(),
  currency:      z.string().min(3).max(3).toLowerCase().optional(),
});
const razorpaySchema = z.object({
  keyId:         z.string().optional(),
  keySecret:     z.string().optional(),
  webhookSecret: z.string().optional(),
  currency:      z.string().min(3).max(3).toUpperCase().optional(),
});
const paymentsSchema = z.object({
  zohoEnabled:     z.boolean().optional(),
  stripeEnabled:   z.boolean().optional(),
  razorpayEnabled: z.boolean().optional(),
  defaultProvider: z.enum(['zoho', 'stripe', 'razorpay']).optional(),
});
const testEmailSchema = z.object({ to: z.string().email() });

/* ─── handlers ───────────────────────────────────────────────────── */

const getAll = asyncHandler(async (_req, res) => {
  if (!appConfig.current()) await appConfig.reload();
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

// Blank strings clear the field; missing fields leave it alone. Secret
// fields you omit are kept as-is, so the UI can safely send a payload
// without echoing back credentials the user never retyped.
function stripEmptyButSavableBlanks(payload, blankableFields = []) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    if (v === '' && !blankableFields.includes(k)) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}

const putB2 = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body, ['cdnDomain']);
  await saveIntegrations('b2', patch);
  b2._reset?.(); // force the S3 client to rebuild on next call
  await audit.logAction(req, 'integrations.b2', 'Settings', null, { after: { keys: Object.keys(patch) } });
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putCloudflare = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body);
  await saveIntegrations('cloudflare', patch);
  await audit.logAction(req, 'integrations.cloudflare', 'Settings', null);
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putSmtp = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body);
  await saveIntegrations('smtp', patch);
  mailer._reset?.();
  await audit.logAction(req, 'integrations.smtp', 'Settings', null);
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putZoho = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body);
  await saveIntegrations('zoho', patch);
  await audit.logAction(req, 'integrations.zoho', 'Settings', null);
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putStripe = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body);
  await saveIntegrations('stripe', patch);
  await audit.logAction(req, 'integrations.stripe', 'Settings', null, { after: { keys: Object.keys(patch) } });
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putRazorpay = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body);
  await saveIntegrations('razorpay', patch);
  await audit.logAction(req, 'integrations.razorpay', 'Settings', null, { after: { keys: Object.keys(patch) } });
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putPayments = asyncHandler(async (req, res) => {
  const patch = {};
  for (const k of ['zohoEnabled', 'stripeEnabled', 'razorpayEnabled', 'defaultProvider']) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  await saveTop('payments', patch);
  await audit.logAction(req, 'payments.settings', 'Settings', null, { after: patch });
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putLimits = asyncHandler(async (req, res) => {
  const patch = {};
  for (const k of Object.keys(req.body)) {
    if (req.body[k] !== undefined && req.body[k] !== '') patch[k] = req.body[k];
  }
  await saveTop('limits', patch);
  await audit.logAction(req, 'integrations.limits', 'Settings', null, { after: patch });
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

const putObservability = asyncHandler(async (req, res) => {
  const patch = stripEmptyButSavableBlanks(req.body, ['sentryDsn']);
  await saveTop('observability', patch);
  await audit.logAction(req, 'integrations.observability', 'Settings', null);
  res.json({ integrations: appConfig.snapshotForAdmin() });
});

/* ─── test endpoints ─────────────────────────────────────────────── */

const testB2 = asyncHandler(async (_req, res) => {
  const cfg = appConfig.get('b2') || {};
  if (!cfg.keyId || !cfg.appKey) throw AppError.badRequest('B2 credentials missing', 'B2_MISSING');
  const probeKey = `_probe/${uuidv4()}.txt`;
  const body = Buffer.from(`probe ${new Date().toISOString()}`);
  try {
    await b2.putObject({ key: probeKey, body, contentType: 'text/plain' });
    const head = await b2.headObject(probeKey);
    await b2.deleteObject(probeKey).catch(() => {});
    res.json({ ok: true, bucket: cfg.bucketName, region: cfg.region, sizeBytes: head.sizeBytes });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

const testSmtp = asyncHandler(async (req, res) => {
  const { to } = req.body;
  try {
    const out = await mailer.sendMail({
      to,
      subject: 'Lexxus — SMTP test',
      html: '<p>This is a test email from the Lexxus admin panel.</p>',
    });
    res.json({ ok: true, messageId: out.messageId });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

const testCloudflare = asyncHandler(async (_req, res) => {
  const cfg = appConfig.get('cloudflare') || {};
  if (!cfg.apiToken) throw AppError.badRequest('Cloudflare API token not set', 'CF_MISSING');
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${cfg.apiToken}` },
    });
    const json = await r.json();
    res.json({ ok: r.ok && json.success, status: json.result?.status, errors: json.errors });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

const testStripe = asyncHandler(async (_req, res) => {
  const secretKey = appConfig.get('stripe.secretKey');
  if (!secretKey) throw AppError.badRequest('Stripe secret key not configured', 'STRIPE_MISSING');
  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(secretKey, { apiVersion: '2024-04-10', telemetry: false });
    // List 1 product to verify credentials — minimal API call.
    await stripe.products.list({ limit: 1 });
    res.json({ ok: true, message: 'Stripe credentials valid' });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

const testRazorpay = asyncHandler(async (_req, res) => {
  const keyId     = appConfig.get('razorpay.keyId');
  const keySecret = appConfig.get('razorpay.keySecret');
  if (!keyId || !keySecret) throw AppError.badRequest('Razorpay credentials not configured', 'RAZORPAY_MISSING');
  try {
    const Razorpay = require('razorpay');
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    // Fetch account settings to verify credentials.
    await rzp.orders.all({ count: 1 });
    res.json({ ok: true, message: 'Razorpay credentials valid' });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/* ─── B2 storage stats ───────────────────────────────────────────── */

/**
 * GET /api/admin/integrations/storage/stats
 * Lists all objects in the B2 bucket (paginated internally) and returns:
 *   - totalFiles, totalBytes, folders breakdown, recentFiles, largestFiles
 * Results are cached in-memory for 2 minutes to avoid hammering B2.
 */
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_TTL_MS = 2 * 60 * 1000; // 2 minutes

const getStorageStats = asyncHandler(async (_req, res) => {
  const cfg = appConfig.get('b2') || {};
  if (!cfg.keyId || !cfg.appKey) {
    return res.status(503).json({ error: 'B2 credentials not configured' });
  }

  // Serve from cache if fresh
  if (_statsCache && Date.now() - _statsCacheAt < STATS_TTL_MS) {
    return res.json({ ..._statsCache, cached: true });
  }

  const folders = {};   // prefix → { files, bytes }
  const allFiles = [];  // { key, size, lastModified }
  let totalFiles = 0;
  let totalBytes = 0;

  try {
    for await (const obj of b2.listAll('')) {
      const key = obj.Key || '';
      const size = obj.Size || 0;
      const lastModified = obj.LastModified;

      totalFiles += 1;
      totalBytes += size;

      // Group by top-level prefix (e.g. "products/", "uploads/", "bundle/")
      const slash = key.indexOf('/');
      const prefix = slash >= 0 ? key.slice(0, slash) : '(root)';
      if (!folders[prefix]) folders[prefix] = { files: 0, bytes: 0 };
      folders[prefix].files += 1;
      folders[prefix].bytes += size;

      allFiles.push({ key, size, lastModified });
    }
  } catch (err) {
    return res.status(502).json({ error: `B2 list failed: ${err.message}` });
  }

  // Sort for recent + largest
  const byDate = [...allFiles].sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  const bySize = [...allFiles].sort((a, b) => b.size - a.size);

  const result = {
    bucket: cfg.bucketName,
    region: cfg.region,
    endpoint: cfg.endpoint,
    totalFiles,
    totalBytes,
    folders: Object.entries(folders)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
    recentFiles: byDate.slice(0, 15).map(({ key, size, lastModified }) => ({ key, size, lastModified })),
    largestFiles: bySize.slice(0, 10).map(({ key, size, lastModified }) => ({ key, size, lastModified })),
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  _statsCache = result;
  _statsCacheAt = Date.now();
  res.json(result);
});

/* ─── wiring ─────────────────────────────────────────────────────── */

router.get('/', getAll);
router.get('/storage/stats', getStorageStats);
router.put('/b2', validate(b2Schema), putB2);
router.put('/cloudflare', validate(cloudflareSchema), putCloudflare);
router.put('/smtp', validate(smtpSchema), putSmtp);
router.put('/zoho', validate(zohoSchema), putZoho);
router.put('/stripe', validate(stripeSchema), putStripe);
router.put('/razorpay', validate(razorpaySchema), putRazorpay);
router.put('/payments', validate(paymentsSchema), putPayments);
router.put('/limits', validate(limitsSchema), putLimits);
router.put('/observability', validate(observabilitySchema), putObservability);
router.post('/test/b2', testB2);
router.post('/test/smtp', validate(testEmailSchema), testSmtp);
router.post('/test/cloudflare', testCloudflare);
router.post('/test/stripe', testStripe);
router.post('/test/razorpay', testRazorpay);

module.exports = router;
