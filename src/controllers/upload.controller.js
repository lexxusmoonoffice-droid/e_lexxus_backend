const asyncHandler = require('../utils/asyncHandler');
const uploadService = require('../services/upload.service');
const b2 = require('../services/b2');
const AppError = require('../utils/AppError');

const presignProductFile = asyncHandler(async (req, res) => {
  const out = await uploadService.presignProductFile({
    creatorId: req.user._id,
    ...req.body,
  });
  res.json(out);
});

const confirmProductFile = asyncHandler(async (req, res) => {
  const product = await uploadService.confirmProductFile({
    user: req.user,
    ...req.body,
  });
  res.json({ product });
});

const presignImage = asyncHandler(async (req, res) => {
  const out = await uploadService.presignImage({
    user: req.user,
    ...req.body,
  });
  res.json(out);
});

const confirmImage = asyncHandler(async (req, res) => {
  const out = await uploadService.confirmImage({
    user: req.user,
    ...req.body,
  });
  res.json(out);
});

const uploadImageDirect = asyncHandler(async (req, res) => {
  if (!req.file) throw require('../utils/AppError').badRequest('No file provided', 'NO_FILE');
  const out = await uploadService.uploadImageDirect({
    user: req.user,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    kind: req.body.kind,
    refId: req.body.refId || undefined,
    role: req.body.role || undefined,
  });
  res.status(201).json(out);
});

const uploadProductFileDirect = asyncHandler(async (req, res) => {
  if (!req.file) throw require('../utils/AppError').badRequest('No file provided', 'NO_FILE');
  const out = await uploadService.uploadProductFileDirect({
    user: req.user,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    productId: req.body.productId || undefined,
  });
  res.status(201).json(out);
});

/**
 * GET /uploads/proxy?key=ENCODED_KEY
 * Public (no auth) — generates a short-lived signed B2 URL and redirects to it.
 * Used when CDN_DOMAIN is not configured (local dev / self-hosted without CDN).
 */
const proxyImage = asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key || typeof key !== 'string') {
    throw AppError.badRequest('Missing or invalid key', 'NO_KEY');
  }
  // Restrict to image paths only — prevent this being used as an arbitrary B2 proxy.
  if (!key.startsWith('images/')) {
    throw AppError.badRequest('Key must start with images/', 'BAD_KEY');
  }
  const signedUrl = await b2.presignGetUrl({ key, expiresIn: 3600, attachment: false });
  // Cache the redirect in the browser for 55 minutes (just under the 1-hour expiry).
  res.setHeader('Cache-Control', 'private, max-age=3300');
  return res.redirect(302, signedUrl);
});

module.exports = {
  presignProductFile,
  confirmProductFile,
  presignImage,
  confirmImage,
  uploadImageDirect,
  uploadProductFileDirect,
  proxyImage,
};
