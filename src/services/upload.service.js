/**
 * Upload service — pre-signed PUT URLs for direct-to-B2 uploads,
 * confirm-step that validates the uploaded object (magic bytes,
 * size) and links it to the right entity (Product / Bundle / Blog
 * post / Hero slide / User avatar).
 *
 *   1. Client → POST /presign      → backend returns presigned PUT URL + fileKey
 *   2. Client → PUT to B2 directly (no backend bandwidth)
 *   3. Client → POST /confirm      → backend validates + persists
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const fileVal = require('../utils/fileValidation');
const b2 = require('./b2');
const cdn = require('./cdn.service');
const { Product, Bundle, BlogPost, HeroSlide, User } = require('../models');

// Lazy require — sharp loads native bindings; we don't want to pay
// the cost in tests that don't use it.
function getSharp() {
  // eslint-disable-next-line global-require
  return require('sharp');
}

const IMAGE_KIND_TO_PREFIX = {
  product: 'images/product',
  bundle: 'images/bundle',
  blog: 'images/blog',
  hero: 'images/hero',
  avatar: 'images/avatar',
  brand: 'images/brand',
  category: 'images/category',
};

/* ────────── helpers ────────── */

function safeFilename(name) {
  const base = path.basename(name);
  return slugify(base, { lower: true, strict: false }).slice(0, 200) || 'file';
}

function makeProductFileKey(creatorId, filename) {
  return `products/${creatorId}/${uuidv4()}/${safeFilename(filename)}`;
}

function makeImageKey(kind, userId, filename) {
  const prefix = IMAGE_KIND_TO_PREFIX[kind];
  return `${prefix}/${userId}/${uuidv4()}/${safeFilename(filename)}`;
}

/* ────────── product ZIP file ────────── */

async function presignProductFile({ creatorId, filename, mimeType, size }) {
  try {
    fileVal.assertZipMime(mimeType);
    fileVal.assertSize(size, fileVal.MAX_ZIP_BYTES);
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }
  const fileKey = makeProductFileKey(creatorId, filename);
  const uploadUrl = await b2.presignPutUrl({
    key: fileKey,
    contentType: mimeType,
    expiresIn: 900,
    metadata: { uploadedBy: String(creatorId) },
  });
  return { uploadUrl, fileKey, expiresIn: 900 };
}

async function confirmProductFile({ user, fileKey, productId }) {
  const product = await Product.findById(productId);
  if (!product) throw AppError.notFound('Product not found');
  // Only the product's creator (or an admin) can attach a file.
  if (
    user.role !== 'admin' &&
    product.creator.toString() !== user._id.toString()
  ) {
    throw AppError.forbidden('Not your product', 'NOT_OWNER');
  }
  // The fileKey must live under the creator's prefix to prevent cross-user attaches.
  const expectedPrefix = `products/${product.creator.toString()}/`;
  if (!fileKey.startsWith(expectedPrefix)) {
    throw AppError.badRequest('File key does not match this product', 'BAD_KEY');
  }

  const head = await b2.headObject(fileKey).catch(() => null);
  if (!head) throw AppError.badRequest('Uploaded object not found in storage', 'NO_OBJECT');
  try {
    fileVal.assertSize(head.sizeBytes, fileVal.MAX_ZIP_BYTES);
    fileVal.assertZipMime(head.mimeType || 'application/zip');
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }

  // Magic-byte verification — read first 4 bytes, must be PK*
  const head4 = await b2.readRange(fileKey, 3);
  if (!fileVal.isZip(head4)) {
    // Anti-poisoning: delete the bad object so it doesn't linger.
    await b2.deleteObject(fileKey).catch(() => {});
    throw AppError.badRequest('Uploaded file is not a valid ZIP', 'NOT_ZIP');
  }

  product.file = {
    b2FileId: head.etag,
    b2FileName: fileKey,
    cdnUrl: cdn.publicUrl(fileKey),
    originalName: path.basename(fileKey),
    sizeBytes: head.sizeBytes,
    mimeType: head.mimeType || 'application/zip',
    checksum: head.etag, // ETag = MD5 for single-part uploads on B2/S3
  };
  product.fileSizeMb = Math.round((head.sizeBytes / (1024 * 1024)) * 10) / 10;
  await product.save();
  return product;
}

/* ────────── images ────────── */

async function presignImage({ user, filename, mimeType, size, kind }) {
  if (!IMAGE_KIND_TO_PREFIX[kind]) {
    throw AppError.badRequest(`Unknown image kind "${kind}"`, 'BAD_KIND');
  }
  try {
    fileVal.assertImageMime(mimeType);
    fileVal.assertSize(size, fileVal.MAX_IMAGE_BYTES);
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }
  const fileKey = makeImageKey(kind, user._id, filename);
  const uploadUrl = await b2.presignPutUrl({
    key: fileKey,
    contentType: mimeType,
    expiresIn: 900,
    metadata: { uploadedBy: String(user._id), kind },
  });
  return { uploadUrl, fileKey, expiresIn: 900 };
}

const VARIANT_WIDTHS = { thumbnail: 400, card: 800, full: 1600 };

/**
 * Generate Sharp variants and upload alongside the original.
 * Returns `{ original, thumbnail, card, full }` URLs (always public).
 */
async function generateVariants(originalKey) {
  const sharp = getSharp();
  // Pull the original. Range read up to 10MB cap (assertSize was already applied).
  const buf = await b2.readRange(originalKey, fileVal.MAX_IMAGE_BYTES - 1);
  const urls = { original: cdn.publicUrl(originalKey) };
  for (const [name, width] of Object.entries(VARIANT_WIDTHS)) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sharp(buf)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const variantKey = originalKey.replace(/(\.[^.]+)?$/, `.${name}.webp`);
    // eslint-disable-next-line no-await-in-loop
    await b2.putObject({ key: variantKey, body: out, contentType: 'image/webp' });
    urls[name] = cdn.publicUrl(variantKey);
  }
  return urls;
}

async function attachImageToEntity({ kind, refId, fileKey, urls, role }) {
  if (kind === 'avatar') {
    await User.updateOne({ _id: refId }, { $set: { avatar: urls.thumbnail || urls.original } });
    return;
  }
  if (kind === 'product') {
    let update;
    if (role === 'thumbnail') {
      update = { thumbnail: urls.card || urls.original };
    } else if (role === 'hover') {
      update = { hoverImage: urls.card || urls.original };
    } else {
      update = { $addToSet: { images: urls.full || urls.original } };
    }
    await Product.updateOne({ _id: refId }, update);
    return;
  }
  if (kind === 'bundle') {
    await Bundle.updateOne({ _id: refId }, role === 'thumbnail'
      ? { image: urls.card || urls.original }
      : { $addToSet: { images: urls.full || urls.original } });
    return;
  }
  if (kind === 'blog') {
    await BlogPost.updateOne({ _id: refId }, { $set: { image: urls.full || urls.original } });
    return;
  }
  if (kind === 'hero') {
    await HeroSlide.updateOne({ _id: refId }, { $set: { img: urls.full || urls.original } });
    return;
  }
  if (kind === 'brand') {
    const { Brand } = require('../models');
    await Brand.updateOne({ _id: refId }, { $set: { logo: urls.full || urls.original } });
    return;
  }
  if (kind === 'category') {
    const { Category } = require('../models');
    await Category.updateOne({ _id: refId }, { $set: { image: urls.full || urls.original } });
  }
}

async function confirmImage({ user, fileKey, kind, refId, role }) {
  if (!IMAGE_KIND_TO_PREFIX[kind]) {
    throw AppError.badRequest(`Unknown image kind "${kind}"`, 'BAD_KIND');
  }
  // Key must live under this user's prefix (cross-user defence).
  const expectedPrefix = `${IMAGE_KIND_TO_PREFIX[kind]}/${user._id.toString()}/`;
  if (!fileKey.startsWith(expectedPrefix)) {
    throw AppError.badRequest('File key does not belong to you', 'BAD_KEY');
  }

  const head = await b2.headObject(fileKey).catch(() => null);
  if (!head) throw AppError.badRequest('Uploaded object not found', 'NO_OBJECT');
  try {
    fileVal.assertSize(head.sizeBytes, fileVal.MAX_IMAGE_BYTES);
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }

  // Magic-byte check
  const first16 = await b2.readRange(fileKey, 15);
  const detected = fileVal.isImage(first16);
  if (!detected) {
    await b2.deleteObject(fileKey).catch(() => {});
    throw AppError.badRequest('Uploaded file is not a valid image', 'NOT_IMAGE');
  }

  // Variant generation can be skipped (e.g. tests) by setting `skipVariants`.
  let urls;
  if (env.isTest) {
    urls = { original: cdn.publicUrl(fileKey) };
  } else {
    urls = await generateVariants(fileKey);
  }

  if (refId) {
    await attachImageToEntity({ kind, refId, fileKey, urls, role });
  }

  return { urls, kind };
}

/* ────────── direct (proxy) uploads ──────────
 * For environments where the browser cannot PUT directly to B2
 * (CORS unconfigured / local dev). The server receives the multipart
 * upload, validates it, stores it on B2, generates variants, and
 * returns the same shape the presign+confirm pair would have produced.
 */

async function uploadImageDirect({
  user, buffer, filename, mimeType, kind, refId, role,
}) {
  if (!IMAGE_KIND_TO_PREFIX[kind]) {
    throw AppError.badRequest(`Unknown image kind "${kind}"`, 'BAD_KIND');
  }
  try {
    fileVal.assertImageMime(mimeType);
    fileVal.assertSize(buffer.length, fileVal.MAX_IMAGE_BYTES);
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }
  // Magic-byte verification on the in-memory buffer, before upload.
  if (!fileVal.isImage(buffer.slice(0, 16))) {
    throw AppError.badRequest('Uploaded file is not a valid image', 'NOT_IMAGE');
  }

  const fileKey = makeImageKey(kind, user._id, filename);
  await b2.putObject({ key: fileKey, body: buffer, contentType: mimeType });

  let urls;
  if (env.isTest) {
    urls = { original: cdn.publicUrl(fileKey) };
  } else {
    urls = await generateVariants(fileKey);
  }

  if (refId) {
    await attachImageToEntity({ kind, refId, fileKey, urls, role });
  }
  return { fileKey, urls, kind };
}

async function uploadProductFileDirect({
  user, buffer, filename, mimeType, productId,
}) {
  try {
    fileVal.assertZipMime(mimeType);
    fileVal.assertSize(buffer.length, fileVal.MAX_ZIP_BYTES);
  } catch (e) {
    throw AppError.badRequest(e.message, e.code);
  }
  if (!fileVal.isZip(buffer.slice(0, 4))) {
    throw AppError.badRequest('Uploaded file is not a valid ZIP', 'NOT_ZIP');
  }

  const creatorId = user._id.toString();
  let product = null;
  if (productId) {
    product = await Product.findById(productId);
    if (!product) throw AppError.notFound('Product not found');
    if (
      user.role !== 'admin' &&
      product.creator.toString() !== creatorId
    ) {
      throw AppError.forbidden('Not your product', 'NOT_OWNER');
    }
  }
  const fileOwner = product ? product.creator.toString() : creatorId;
  const fileKey = makeProductFileKey(fileOwner, filename);

  await b2.putObject({ key: fileKey, body: buffer, contentType: mimeType });

  const fileMeta = {
    b2FileId: fileKey,
    b2FileName: fileKey,
    cdnUrl: cdn.publicUrl(fileKey),
    originalName: path.basename(filename),
    sizeBytes: buffer.length,
    mimeType,
  };
  const fileSizeMb = Math.round((buffer.length / (1024 * 1024)) * 10) / 10;

  if (product) {
    product.file = fileMeta;
    product.fileSizeMb = fileSizeMb;
    await product.save();
  }
  return { fileKey, file: fileMeta, fileSizeMb, product };
}

module.exports = {
  presignProductFile,
  confirmProductFile,
  presignImage,
  confirmImage,
  uploadImageDirect,
  uploadProductFileDirect,
  // exposed for tests + admin manual triggers:
  generateVariants,
  makeProductFileKey,
  makeImageKey,
};
