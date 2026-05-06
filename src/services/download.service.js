/**
 * Download service.
 *
 *   listDownloads(userId)        unlocked items for the authenticated user
 *   redeemToken(user, token)     atomically check + bump downloadCount,
 *                                return per-product signed CDN URLs
 *   resendDownloadEmail(user, token)
 *
 * Per ADR-0006, a bundle expands into one signed URL per included
 * product (no on-the-fly archive in v1).
 */

const AppError = require('../utils/AppError');
const appConfig = require('./appConfig.service');
const { Order, Product } = require('../models');
const cdn = require('./cdn.service');
const { sendDownloadEmail } = require('./email.service');

const SIGNED_URL_TTL = 300; // 5 min

/* ────────── list (used by /api/downloads) ────────── */

async function listDownloads(userId) {
  const orders = await Order.find({
    buyer: userId,
    status: 'paid',
    downloadToken: { $exists: true, $ne: null },
  })
    .populate([
      { path: 'items.product', select: 'title slug thumbnail fileSizeMb formats' },
      { path: 'items.bundle', select: 'name slug image fileSizeMb formats' },
    ])
    .sort('-createdAt');

  return orders.flatMap((order) =>
    order.items.map((item) => ({
      orderId: order._id.toString(),
      type: item.type,
      product: item.product || null,
      bundle: item.bundle || null,
      qty: item.qty,
      downloadToken: order.downloadToken,
      tokenExpiresAt: order.tokenExpiresAt,
      downloadCount: order.downloadCount,
      downloadLimit: order.downloadLimit,
      purchasedAt: order.payment?.paidAt || order.createdAt,
    })),
  );
}

/* ────────── helpers ────────── */

async function buildProductDownload(productDoc) {
  const file = productDoc?.file?.b2FileName;
  if (!file) {
    return {
      productId: productDoc?._id?.toString(),
      title: productDoc?.title,
      thumbnail: productDoc?.thumbnail,
      url: null,
      reason: 'No file attached yet',
    };
  }
  const url = await cdn.signedDownloadUrl(file, { expiresIn: SIGNED_URL_TTL, attachment: true });
  return {
    productId: productDoc._id.toString(),
    title: productDoc.title,
    thumbnail: productDoc.thumbnail,
    url,
    expiresIn: SIGNED_URL_TTL,
    sizeMb: productDoc.fileSizeMb || null,
    formats: productDoc.formats || [],
  };
}

/**
 * Resolve why a token operation failed — converts an atomic-update
 * miss into a precise 404/403/410/429.
 */
async function diagnoseTokenFailure(token, userId) {
  const order = await Order.findOne({ downloadToken: token });
  if (!order) return AppError.notFound('Invalid download token', 'BAD_TOKEN');
  if (String(order.buyer) !== String(userId)) {
    return AppError.notFound('Invalid download token', 'BAD_TOKEN');
  }
  if (order.status !== 'paid') {
    return AppError.forbidden('Order is not in a downloadable state', 'NOT_PAID');
  }
  if (order.tokenExpiresAt && order.tokenExpiresAt <= new Date()) {
    return new AppError('Download link has expired', 410, 'TOKEN_EXPIRED');
  }
  if ((order.downloadCount || 0) >= (order.downloadLimit || appConfig.get('limits.downloadLimitPerOrder') || 5)) {
    return AppError.tooMany('Download limit reached.', 'DOWNLOAD_LIMIT');
  }
  return null;
}

/* ────────── getDownloadInfo (GET /:token — view only, no decrement) ────────── */

/**
 * Validates the token and returns order + product metadata WITHOUT
 * generating signed URLs and WITHOUT decrementing the download count.
 * Safe to call on every page load.
 */
async function getDownloadInfo(user, token) {
  const order = await Order.findOne({
    downloadToken: token,
    buyer: user._id,
    status: 'paid',
  }).populate([
    { path: 'items.product', select: 'title thumbnail fileSizeMb formats file' },
    { path: 'items.bundle', select: 'name image fileSizeMb formats', populate: { path: 'productIds', select: 'title thumbnail fileSizeMb' } },
  ]);

  if (!order) {
    const why = await diagnoseTokenFailure(token, user._id);
    throw why || AppError.notFound('Invalid download token', 'BAD_TOKEN');
  }

  if (order.tokenExpiresAt && order.tokenExpiresAt <= new Date()) {
    throw new AppError('Download link has expired', 410, 'TOKEN_EXPIRED');
  }

  const remaining = Math.max(0, (order.downloadLimit || 5) - (order.downloadCount || 0));

  const items = order.items.map((item) => {
    if (item.type === 'product') {
      const p = item.product;
      return {
        type: 'product',
        productId: p?._id?.toString(),
        title: p?.title,
        thumbnail: p?.thumbnail,
        hasFile: !!(p?.file?.b2FileName),
        sizeMb: p?.fileSizeMb || null,
        formats: p?.formats || [],
      };
    }
    // bundle
    return {
      type: 'bundle',
      bundleId: item.bundle?._id?.toString(),
      name: item.bundle?.name,
      image: item.bundle?.image,
      products: (item.bundle?.productIds || []).map((p) => ({
        productId: p?._id?.toString(),
        title: p?.title,
        thumbnail: p?.thumbnail,
        hasFile: !!(p?.file?.b2FileName),
      })),
    };
  });

  return {
    order: {
      id: order._id.toString(),
      purchasedAt: order.payment?.paidAt || order.createdAt,
      downloadCount: order.downloadCount || 0,
      downloadLimit: order.downloadLimit || 5,
      remaining,
      tokenExpiresAt: order.tokenExpiresAt,
    },
    items,
  };
}

/* ────────── useDownload (POST /:token/use — decrement + signed URL) ────────── */

/**
 * Atomically checks the limit, increments downloadCount, and returns
 * signed CDN URLs. Called only when the user explicitly clicks a
 * download button — this is the action that "uses" one download slot.
 */
async function useDownload(user, token) {
  const order = await Order.findOneAndUpdate(
    {
      downloadToken: token,
      buyer: user._id,
      status: 'paid',
      tokenExpiresAt: { $gt: new Date() },
      $expr: { $lt: [{ $ifNull: ['$downloadCount', 0] }, { $ifNull: ['$downloadLimit', 5] }] },
    },
    { $inc: { downloadCount: 1 } },
    { new: true },
  ).populate([
    { path: 'items.product' },
    { path: 'items.bundle', populate: { path: 'productIds' } },
  ]);

  if (!order) {
    const why = await diagnoseTokenFailure(token, user._id);
    throw why || AppError.notFound('Invalid download token', 'BAD_TOKEN');
  }

  // Build signed URLs for every item
  const items = await Promise.all(
    order.items.map(async (item) => {
      if (item.type === 'product') {
        return { type: 'product', ...(await buildProductDownload(item.product)) };
      }
      const products = await Promise.all((item.bundle?.productIds || []).map(buildProductDownload));
      return {
        type: 'bundle',
        bundleId: item.bundle?._id?.toString(),
        name: item.bundle?.name,
        image: item.bundle?.image,
        products,
      };
    }),
  );

  return {
    order: {
      id: order._id.toString(),
      purchasedAt: order.payment?.paidAt || order.createdAt,
      downloadCount: order.downloadCount,
      downloadLimit: order.downloadLimit,
      remaining: Math.max(0, order.downloadLimit - order.downloadCount),
      tokenExpiresAt: order.tokenExpiresAt,
    },
    items,
  };
}

/* ────────── resend ────────── */

async function resendDownloadEmail(user, token) {
  const order = await Order.findOne({ downloadToken: token, buyer: user._id });
  if (!order) throw AppError.notFound('Invalid download token', 'BAD_TOKEN');
  if (order.status !== 'paid') {
    throw AppError.forbidden('Order is not paid', 'NOT_PAID');
  }
  if (order.tokenExpiresAt && order.tokenExpiresAt <= new Date()) {
    throw new AppError('Download link has expired', 410, 'TOKEN_EXPIRED');
  }
  await sendDownloadEmail(user, order, token).catch(() => {});
  return { sentTo: order.billing?.email || user.email };
}

module.exports = { listDownloads, getDownloadInfo, useDownload, resendDownloadEmail };
