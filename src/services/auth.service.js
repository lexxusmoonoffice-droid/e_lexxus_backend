/**
 * Auth business logic — all the stateful work for the auth flow:
 * register, login, refresh-rotation (with reuse-detection), logout,
 * email verify, password reset, password change.
 *
 * Controllers stay thin — they shape requests/responses and call here.
 */

const env = require('../config/env');
const AppError = require('../utils/AppError');
const { hashPassword, comparePassword } = require('../utils/password');
const { randomToken, hashToken, sha256 } = require('../utils/token');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  expiryOf,
} = require('./jwt.service');
const { User, RefreshToken } = require('../models');
const {
  sendVerifyEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendOtpEmail,
} = require('./email.service');

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const RESET_TTL_MS = 60 * 60 * 1000; // 1 h

// ── helpers ──────────────────────────────────────────────────────

async function issueRefreshToken(user, { ip, userAgent, family } = {}) {
  const { token, jti, family: fam } = signRefreshToken({
    userId: user._id,
    family: family || undefined,
  });
  const decoded = verifyRefreshToken(token);
  await RefreshToken.create({
    user: user._id,
    jti,
    family: fam,
    tokenHash: sha256(token),
    expiresAt: expiryOf(decoded),
    userAgent,
    ip,
  });
  return token;
}

async function issueVerifyToken(user) {
  const raw = randomToken();
  user.emailVerifyTokenHash = hashToken(raw);
  user.emailVerifyTokenExpiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  await user.save();
  return raw;
}

async function issueResetToken(user) {
  const raw = randomToken();
  user.passwordResetTokenHash = hashToken(raw);
  user.passwordResetTokenExpiresAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();
  return raw;
}

function publicUser(user) {
  return user.toJSON();
}

// ── flows ────────────────────────────────────────────────────────

async function register({ name, email, password }) {
  const existing = await User.findOne({ email });
  if (existing) throw AppError.conflict('Email already in use', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(password);
  const user = await User.create({ name, email, passwordHash, role: 'buyer' });

  const rawVerifyToken = await issueVerifyToken(user);
  await sendVerifyEmail(user, rawVerifyToken);

  return {
    user: publicUser(user),
    // Returned to ease testing; in tests we read this directly.
    // In production this never appears in the API response — controllers strip it.
    _verifyToken: rawVerifyToken,
  };
}

async function login({ email, password, ip, userAgent }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) throw AppError.unauthorized('Invalid email or password', 'BAD_CREDENTIALS');
  if (user.status === 'suspended') throw AppError.forbidden('Account suspended', 'ACCOUNT_SUSPENDED');

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw AppError.unauthorized('Invalid email or password', 'BAD_CREDENTIALS');

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user, { ip, userAgent });
  return { accessToken, refreshToken, user: publicUser(user) };
}

async function refresh({ refreshToken, ip, userAgent }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH');
  }

  const stored = await RefreshToken.findOne({ jti: decoded.jti }).select('+tokenHash');
  if (!stored) throw AppError.unauthorized('Refresh token not recognised', 'UNKNOWN_REFRESH');

  // Reuse detection — if the stored token is already revoked, the
  // attacker has the old token. Revoke the entire family + force re-login.
  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { family: stored.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw AppError.unauthorized('Refresh token reused — please log in again', 'REFRESH_REUSED');
  }

  // Sanity: the presented token's hash must match.
  if (stored.tokenHash !== sha256(refreshToken)) {
    throw AppError.unauthorized('Refresh token mismatch', 'INVALID_REFRESH');
  }

  const user = await User.findById(stored.user);
  if (!user || user.status === 'suspended') {
    throw AppError.unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  }

  // Rotate: revoke this jti, mint a new one in the same family.
  const newRefresh = await issueRefreshToken(user, {
    ip,
    userAgent,
    family: stored.family,
  });
  const newDecoded = verifyRefreshToken(newRefresh);
  stored.revokedAt = new Date();
  stored.replacedBy = newDecoded.jti;
  await stored.save();

  const accessToken = signAccessToken(user);
  return { accessToken, refreshToken: newRefresh, user: publicUser(user) };
}

async function logout(refreshToken) {
  if (!refreshToken) return;
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return; // silent — no token to revoke
  }
  await RefreshToken.updateOne(
    { jti: decoded.jti, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);
  const user = await User.findOne({
    emailVerifyTokenHash: tokenHash,
    emailVerifyTokenExpiresAt: { $gt: new Date() },
  }).select('+emailVerifyTokenHash +emailVerifyTokenExpiresAt +pendingEmail');
  if (!user) throw AppError.badRequest('Invalid or expired verification link', 'BAD_VERIFY_TOKEN');

  const isEmailChange = !!user.pendingEmail;

  // Email-change flow: promote the staged address to the live email.
  if (isEmailChange) {
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
  }

  user.verified = true;
  user.emailVerifyTokenHash = undefined;
  user.emailVerifyTokenExpiresAt = undefined;
  await user.save();

  // Only send the welcome email on initial signup verification.
  if (!isEmailChange) {
    await sendWelcomeEmail(user);
  }

  return publicUser(user);
}

async function resendVerification(user) {
  if (user.verified) throw AppError.badRequest('Already verified', 'ALREADY_VERIFIED');
  const fresh = await User.findById(user._id);
  const raw = await issueVerifyToken(fresh);
  await sendVerifyEmail(fresh, raw);
}

async function forgotPassword(email) {
  const user = await User.findOne({ email });
  // Don't leak whether the email exists — return success either way.
  if (!user) return;
  const raw = await issueResetToken(user);
  await sendPasswordResetEmail(user, raw);
}

async function resetPassword({ token, newPassword }) {
  const tokenHash = hashToken(token);
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetTokenExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetTokenExpiresAt');
  if (!user) throw AppError.badRequest('Invalid or expired reset link', 'BAD_RESET_TOKEN');

  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenHash = undefined;
  user.passwordResetTokenExpiresAt = undefined;
  await user.save();

  // Security hygiene — invalidate every existing refresh token.
  await RefreshToken.updateMany(
    { user: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return publicUser(user);
}

async function changePassword({ user, currentPassword, newPassword }) {
  const fresh = await User.findById(user._id).select('+passwordHash');
  if (!fresh) throw AppError.unauthorized();
  const ok = await comparePassword(currentPassword, fresh.passwordHash);
  if (!ok) throw AppError.unauthorized('Current password is incorrect', 'BAD_CREDENTIALS');

  fresh.passwordHash = await hashPassword(newPassword);
  await fresh.save();

  await RefreshToken.updateMany(
    { user: fresh._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

// ── OTP login ────────────────────────────────────────────────────

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function sendOtp(email) {
  const user = await User.findOne({ email });
  if (!user) throw AppError.notFound('No account with this email', 'USER_NOT_FOUND');
  if (user.status === 'suspended') throw AppError.forbidden('Account suspended', 'ACCOUNT_SUSPENDED');

  const otp = generateOtp();
  user.otpHash = hashToken(otp);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  await user.save();
  await sendOtpEmail(user, otp);
}

async function verifyOtp({ email, otp, ip, userAgent }) {
  const user = await User.findOne({ email })
    .select('+otpHash +otpExpiresAt');
  if (!user) throw AppError.unauthorized('Invalid code', 'BAD_OTP');
  if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
    throw AppError.unauthorized('Code expired — request a new one', 'OTP_EXPIRED');
  }
  if (user.otpHash !== hashToken(otp)) {
    throw AppError.unauthorized('Invalid code', 'BAD_OTP');
  }

  // Consume OTP
  user.otpHash = undefined;
  user.otpExpiresAt = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user, { ip, userAgent });
  return { accessToken, refreshToken, user: publicUser(user) };
}

// ── refresh-cookie helpers (used by the controller) ──────────────

const REFRESH_COOKIE = 'refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.isProd ? 'lax' : 'lax',
    secure: env.isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  REFRESH_COOKIE,
  refreshCookieOptions,
  sendOtp,
  verifyOtp,
  // exported for tests and internal use:
  issueRefreshToken,
  issueVerifyToken,
};
