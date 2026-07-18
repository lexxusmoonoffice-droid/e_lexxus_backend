/**
 * Auth controller — thin: shape req → call service → shape res.
 * The refresh token is set as an httpOnly cookie *and* returned in
 * the JSON body so non-browser clients (mobile/CLI) can use it too.
 */

const env = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');
const googleAuth = require('../services/googleAuth.service');
const AppError = require('../utils/AppError');
const { verifyAccessToken, signAccessToken } = require('../services/jwt.service');
const tokenBlacklist = require('../services/tokenBlacklist.service');

const { REFRESH_COOKIE, refreshCookieOptions } = authService;

function getRequestMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function getRefreshFromRequest(req) {
  return req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
}

const register = asyncHandler(async (req, res) => {
  const { user, _verifyToken } = await authService.register(req.body);
  const body = { user, message: 'Registered. Check your email to verify.' };
  // In dev/test, return the token to make manual + automated testing trivial.
  if (!env.isProd) body.verifyToken = _verifyToken;
  res.status(201).json(body);
});

const login = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken, user } = await authService.login({
    ...req.body,
    ...getRequestMeta(req),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken, refreshToken, user });
});

const refresh = asyncHandler(async (req, res) => {
  const token = getRefreshFromRequest(req);
  if (!token) throw AppError.unauthorized('No refresh token', 'NO_REFRESH');
  const { accessToken, refreshToken, user } = await authService.refresh({
    refreshToken: token,
    ...getRequestMeta(req),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken, refreshToken, user });
});

const logout = asyncHandler(async (req, res) => {
  // Revoke refresh token (DB)
  const refreshToken = getRefreshFromRequest(req);
  await authService.logout(refreshToken);
  // Best-effort: blacklist the current access token's jti so it can't
  // be used during its 15-min life.
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const decoded = verifyAccessToken(auth.slice(7).trim());
      if (decoded.jti) await tokenBlacklist.revoke(decoded.jti, decoded.exp);
    } catch {
      /* ignore — already expired / invalid */
    }
  }
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: 0 });
  res.status(204).end();
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.body.token);
  res.json({ user, message: 'Email verified' });
});

const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.user);
  res.json({ message: 'Verification email sent' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  res.json({ message: 'If the email exists, a reset link has been sent.' });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: 'Password updated. You can now log in.' });
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({ user: req.user, ...req.body });
  res.json({ message: 'Password changed.' });
});

const sendOtp = asyncHandler(async (req, res) => {
  await authService.sendOtp(req.body.email);
  res.json({ message: 'OTP sent to your email.' });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken, user } = await authService.verifyOtp({
    ...req.body,
    ...getRequestMeta(req),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken, refreshToken, user });
});

// Redirect browser to Google consent screen.
const googleRedirect = asyncHandler(async (req, res) => {
  const next = req.query.next || '/account';
  const url = googleAuth.buildRedirectUrl(next);
  res.redirect(url);
});

// Google sends the user back here with ?code=...&state=...
const googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const next = state ? Buffer.from(state, 'base64').toString('utf8') : '/account';
  const frontendBase = env.FRONTEND_URL;

  if (error || !code) {
    return res.redirect(`${frontendBase}/login?error=google_cancelled`);
  }

  try {
    const tokens = await googleAuth.exchangeCode(code);
    const profile = await googleAuth.getProfile(tokens.access_token);
    const user = await googleAuth.findOrCreateUser(profile);

    const accessToken = signAccessToken(user);
    const refreshToken = await authService.issueRefreshToken(user, getRequestMeta(req));

    const params = new URLSearchParams({ accessToken, refreshToken, next });
    return res.redirect(`${frontendBase}/auth/callback?${params}`);
  } catch (err) {
    const params = new URLSearchParams({ error: err.message || 'google_error', next });
    return res.redirect(`${frontendBase}/login?${params}`);
  }
});

const googleAuthHandler = asyncHandler(async (req, res) => {
  if (req.query.code || req.query.error) {
    return googleCallback(req, res);
  }
  return googleRedirect(req, res);
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  googleRedirect,
  googleCallback,
  googleAuthHandler,
  sendOtp,
  verifyOtp,
};
