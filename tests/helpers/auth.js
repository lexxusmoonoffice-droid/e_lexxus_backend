/**
 * Auth test helpers — issue an access token for a given user without
 * going through the full HTTP login flow.
 */
const { signAccessToken } = require('../../src/services/jwt.service');

function bearer(user) {
  return `Bearer ${signAccessToken(user)}`;
}

module.exports = { bearer };
