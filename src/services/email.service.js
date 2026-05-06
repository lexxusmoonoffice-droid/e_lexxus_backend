/**
 * Higher-level email helpers — wrap the template registry +
 * emailQueue so callers just say "send the X email".
 *
 *   await sendVerifyEmail(user, rawToken);
 *
 * Under Redis, emails are enqueued to BullMQ with retry/dead-letter.
 * Without Redis (dev/test), they send synchronously through
 * `mailer.service` (which itself logs rather than sending when
 * SMTP creds are absent).
 */

const env = require('../config/env');
const appConfig = require('./appConfig.service');
const { enqueueEmail } = require('../jobs/emailQueue');

function verifyEmailUrl(token) {
  return `${env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
}
function resetPasswordUrl(token) {
  return `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
}
function downloadUrl(token) {
  return `${env.FRONTEND_URL}/account/downloads?token=${encodeURIComponent(token)}`;
}
function orderUrl(orderId) {
  return `${env.FRONTEND_URL}/account/orders/${orderId}`;
}

/** Normalise a Mongoose doc or plain object so templates can use `.name`. */
function toJson(doc) {
  if (!doc) return {};
  if (typeof doc.toJSON === 'function') return doc.toJSON();
  return doc;
}

async function sendVerifyEmail(user, rawToken) {
  return enqueueEmail({
    template: 'verify-email',
    to: user.email,
    data: { user: toJson(user), url: verifyEmailUrl(rawToken) },
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  return enqueueEmail({
    template: 'password-reset',
    to: user.email,
    data: { user: toJson(user), url: resetPasswordUrl(rawToken) },
  });
}

async function sendWelcomeEmail(user) {
  return enqueueEmail({
    template: 'welcome',
    to: user.email,
    data: { user: toJson(user), frontendUrl: env.FRONTEND_URL },
  });
}

async function sendOrderConfirmationEmail(user, order) {
  const url = order.downloadToken
    ? downloadUrl(order.downloadToken)
    : orderUrl(order._id);
  return enqueueEmail({
    template: 'order-confirmation',
    to: order.billing?.email || user.email,
    data: {
      user: toJson(user),
      order: toJson(order),
      downloadUrl: url,
      orderUrl: orderUrl(order._id),
    },
  });
}

async function sendDownloadEmail(user, order, rawToken) {
  return enqueueEmail({
    template: 'download-link',
    to: order.billing?.email || user.email,
    data: {
      user: toJson(user),
      order: toJson(order),
      url: downloadUrl(rawToken),
      ttlDays: appConfig.get('limits.downloadTokenTtlDays') || 30,
      limit: appConfig.get('limits.downloadLimitPerOrder') || 5,
    },
  });
}

async function sendRefundEmail(user, order) {
  return enqueueEmail({
    template: 'refund',
    to: order.billing?.email || user.email,
    data: { user: toJson(user), order: toJson(order) },
  });
}

async function sendPaymentFailedEmail(user, order) {
  return enqueueEmail({
    template: 'payment-failed',
    to: order.billing?.email || user.email,
    data: {
      user: toJson(user),
      order: toJson(order),
      retryUrl: `${env.FRONTEND_URL}/checkout`,
    },
  });
}

async function sendAccountSuspendedEmail(user, supportEmail) {
  return enqueueEmail({
    template: 'account-suspended',
    to: user.email,
    data: { user: toJson(user), supportEmail },
  });
}

async function sendOtpEmail(user, otp) {
  return enqueueEmail({
    template: 'otp-login',
    to: user.email,
    data: { user: toJson(user), otp },
  });
}

module.exports = {
  sendVerifyEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendDownloadEmail,
  sendRefundEmail,
  sendPaymentFailedEmail,
  sendAccountSuspendedEmail,
  sendOtpEmail,
};
