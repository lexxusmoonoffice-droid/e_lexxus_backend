/**
 * JWT helpers — sign + verify access and refresh tokens.
 *
 *  Access:  short-lived (15m default), HS256, payload {sub, role, type}.
 *  Refresh: long-lived (7d default),   HS256, payload {sub, jti, family, type}.
 *           jti + family let us rotate and detect reuse.
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

function signAccessToken(user) {
  const payload = {
    sub: user.id || user._id?.toString(),
    role: user.role,
    type: 'access',
    jti: uuidv4(),
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL });
}

function signRefreshToken({ userId, jti = uuidv4(), family = uuidv4() }) {
  const token = jwt.sign(
    { sub: String(userId), jti, family, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_TTL },
  );
  return { token, jti, family };
}

function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (decoded.type !== 'access') throw new jwt.JsonWebTokenError('Wrong token type');
  return decoded;
}

function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (decoded.type !== 'refresh') throw new jwt.JsonWebTokenError('Wrong token type');
  return decoded;
}

/** Get expiry of a verified payload as a Date. */
function expiryOf(decoded) {
  return new Date(decoded.exp * 1000);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiryOf,
};
