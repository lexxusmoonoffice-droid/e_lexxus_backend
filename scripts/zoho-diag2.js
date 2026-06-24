#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const s = await mongoose.connection.collection('settings').findOne({});
  const z = s?.integrations?.zoho || {};
  await mongoose.disconnect();

  const clientId     = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = z.refreshToken || process.env.ZOHO_REFRESH_TOKEN;
  const accountId    = process.env.ZOHO_ACCOUNT_ID;

  // Get fresh access token
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const { access_token } = await tokenRes.json();
  if (!access_token) { console.error('No access token'); process.exit(1); }
  console.log('Access token obtained OK\n');

  const h = { Authorization: `Zoho-oauthtoken ${access_token}`, 'Content-Type': 'application/json' };

  // Test 1: GET /accounts (list all accounts)
  console.log('=== GET /accounts ===');
  const r1 = await fetch('https://payments.zoho.in/api/v1/accounts', { headers: h });
  console.log('Status:', r1.status, '\n', await r1.text(), '\n');

  // Test 2: GET /accounts/{account_id} (get specific account)
  console.log(`=== GET /accounts/${accountId} ===`);
  const r2 = await fetch(`https://payments.zoho.in/api/v1/accounts/${accountId}`, { headers: h });
  console.log('Status:', r2.status, '\n', await r2.text(), '\n');

  // Test 3: Try without account_id query param
  console.log('=== POST /paymentsessions (no account_id) ===');
  const r3 = await fetch('https://payments.zoho.in/api/v1/paymentsessions', {
    method: 'POST', headers: h,
    body: JSON.stringify({ amount: 1, currency: 'INR', description: 'test', max_retry_count: 1, configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } } }),
  });
  console.log('Status:', r3.status, '\n', await r3.text(), '\n');

  // Test 4: Try zohoapis.in (the api_domain returned by the token)
  console.log(`=== POST zohoapis.in/payments/v1/paymentsessions?account_id=${accountId} ===`);
  const r4 = await fetch(`https://www.zohoapis.in/payments/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ amount: 1, currency: 'INR', description: 'test', max_retry_count: 1, configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } } }),
  });
  console.log('Status:', r4.status, '\n', await r4.text(), '\n');

  // Test 5: Different base URL format
  console.log(`=== POST zohoapis.in/payments/v1/accounts/${accountId}/paymentsessions ===`);
  const r5 = await fetch(`https://www.zohoapis.in/payments/v1/accounts/${accountId}/paymentsessions`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ amount: 1, currency: 'INR', description: 'test', max_retry_count: 1, configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } } }),
  });
  console.log('Status:', r5.status, '\n', await r5.text(), '\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
