/**
 * Auth gates.
 *
 *   requireAuth      verify Bearer JWT, load user → req.user
 *   requireRole(...) ensure user.role ∈ allowed
 *   requireVerified  ensure user.verified === true
 */

const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../services/jwt.service');
const { isRevoked } = require('../services/tokenBlacklist.service');
const { User } = require('../models');

function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) throw AppError.unauthorized('Missing access token', 'NO_TOKEN');

    const decoded = verifyAccessToken(token); // throws TokenExpiredError / JsonWebTokenError
    if (decoded.jti && (await isRevoked(decoded.jti))) {
      throw AppError.unauthorized('Token revoked', 'TOKEN_REVOKED');
    }
    const user = await User.findById(decoded.sub);
    if (!user) throw AppError.unauthorized('User not found', 'USER_NOT_FOUND');
    if (user.status === 'suspended')
      throw AppError.forbidden('Account suspended', 'ACCOUNT_SUSPENDED');

    req.user = user;
    req.token = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(AppError.forbidden(`Requires role: ${allowed.join('|')}`, 'WRONG_ROLE'));
    }
    next();
  };
}

function requireVerified(req, res, next) {
  if (!req.user) return next(AppError.unauthorized());
  if (!req.user.verified) {
    return next(AppError.forbidden('Email verification required', 'EMAIL_NOT_VERIFIED'));
  }
  next();
}

const requireAdmin = requireRole('admin');

module.exports = { requireAuth, requireRole, requireVerified, requireAdmin };
