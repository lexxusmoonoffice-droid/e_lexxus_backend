const env = require('../config/env');
const AppError = require('../utils/AppError');
const { User } = require('../models');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function getCallbackUrl() {
  return `${env.API_URL}/api/auth/google/callback`;
}

function buildRedirectUrl(next) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw AppError.badRequest('Google OAuth is not configured', 'GOOGLE_NOT_CONFIGURED');
  }
  const state = next ? Buffer.from(next).toString('base64') : '';
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getCallbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getCallbackUrl(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw AppError.badRequest(`Google token exchange failed: ${text.slice(0, 100)}`, 'GOOGLE_TOKEN_ERROR');
  }
  return res.json();
}

async function getProfile(googleAccessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  });
  if (!res.ok) throw AppError.badRequest('Failed to fetch Google profile', 'GOOGLE_PROFILE_ERROR');
  return res.json();
}

async function findOrCreateUser(profile) {
  // 1. Find by googleId
  let user = await User.findOne({ googleId: profile.id }).select('+googleId');
  if (user) {
    user.lastLoginAt = new Date();
    await user.save();
    return user;
  }

  // 2. Find by email — link existing account
  user = await User.findOne({ email: profile.email.toLowerCase() });
  if (user) {
    if (user.status === 'suspended') throw AppError.forbidden('Account suspended', 'ACCOUNT_SUSPENDED');
    user.googleId = profile.id;
    if (!user.avatar && profile.picture) user.avatar = profile.picture;
    user.verified = true;
    user.lastLoginAt = new Date();
    await user.save();
    return user;
  }

  // 3. Create new user
  user = await User.create({
    name: profile.name,
    email: profile.email.toLowerCase(),
    googleId: profile.id,
    avatar: profile.picture || '',
    role: 'buyer',
    verified: true,
    status: 'active',
    lastLoginAt: new Date(),
  });
  return user;
}

module.exports = { buildRedirectUrl, exchangeCode, getProfile, findOrCreateUser };
