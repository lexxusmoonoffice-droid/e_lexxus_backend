#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const s = await mongoose.connection.collection('settings').findOne({});
  const z = s?.integrations?.zoho || {};

  const clientId     = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = z.refreshToken || process.env.ZOHO_REFRESH_TOKEN;
  const accountId    = process.env.ZOHO_ACCOUNT_ID;
  const apiKey       = process.env.ZOHO_API_KEY;
  await mongoose.disconnect();

  console.log('=== Credentials ===');
  console.log('clientId:       ', clientId);
  console.log('clientSecret:   ', clientSecret ? clientSecret.substring(0,12) + '...' : '(empty)');
  console.log('refreshToken:   ', refreshToken ? refreshToken.substring(0,20) + '...' : '(empty)');
  console.log('accountId:      ', accountId);
  console.log('apiKey:         ', apiKey ? apiKey.substring(0,20) + '...' : '(empty)');

  // ── Step 1: Refresh OAuth token ─────────────────────────────────────
  console.log('\n=== Step 1: OAuth token refresh ===');
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  const tokenJson = await tokenRes.json();
  console.log('Status:', tokenRes.status);
  console.log('Response:', JSON.stringify(tokenJson, null, 2));

  const accessToken = tokenJson.access_token;

  // ── Step 2: Test Payments API with OAuth token ───────────────────────
  if (accessToken) {
    console.log('\n=== Step 2: Payments API with OAuth token ===');
    const testBody = JSON.stringify({
      amount: 1.00,
      currency: 'INR',
      description: 'diagnostic-test',
      max_retry_count: 1,
      configurations: {
        hosted_page_parameters: {
          description: 'diagnostic-test',
          success_url: 'https://3dshop.lexxusmoon.com/checkout/success',
          failure_url: 'https://3dshop.lexxusmoon.com/checkout/cancel',
        },
      },
    });
    const apiUrl = `https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`;
    const apiRes = await fetch(apiUrl, {
      method:  'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: testBody,
    });
    const apiText = await apiRes.text();
    console.log('Status:', apiRes.status);
    console.log('Response:', apiText);
  } else {
    console.log('\nSkipping API test — no access token obtained.');
  }

  // ── Step 3: Test with API key ────────────────────────────────────────
  if (apiKey) {
    console.log('\n=== Step 3: Payments API with API key ===');
    const testBody = JSON.stringify({
      amount: 1.00,
      currency: 'INR',
      description: 'diagnostic-test-apikey',
      max_retry_count: 1,
      configurations: {
        hosted_page_parameters: {
          description: 'diagnostic-test-apikey',
          success_url: 'https://3dshop.lexxusmoon.com/checkout/success',
          failure_url: 'https://3dshop.lexxusmoon.com/checkout/cancel',
        },
      },
    });
    const apiUrl = `https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`;
    const apiRes = await fetch(apiUrl, {
      method:  'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: testBody,
    });
    const apiKeyText = await apiRes.text();
    console.log('Status:', apiRes.status);
    console.log('Response:', apiKeyText);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
