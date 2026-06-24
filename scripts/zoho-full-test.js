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
  const apiKey       = process.env.ZOHO_API_KEY;

  console.log('=== Credentials Check ===');
  console.log('clientId:     ', clientId);
  console.log('refreshToken: ', refreshToken ? refreshToken.substring(0,20)+'...' : 'EMPTY');
  console.log('accountId:    ', accountId);
  console.log('apiKey:       ', apiKey?.substring(0,20)+'...');

  // Step 1: Get fresh OAuth access token
  console.log('\n=== OAuth Refresh ===');
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  const tr = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tj = await tr.json();
  console.log('Status:', tr.status, '| Scope:', tj.scope, '| api_domain:', tj.api_domain);
  const accessToken = tj.access_token;

  if (!accessToken) { console.error('No access token. Refresh token may be missing/expired.'); process.exit(1); }

  const payload = JSON.stringify({
    amount: 1.00, currency: 'INR', description: 'test',
    max_retry_count: 1,
    configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/checkout/success', failure_url: 'https://3dshop.lexxusmoon.com/checkout/cancel' } },
  });

  // Test A: Standard URL + OAuth token
  console.log('\n=== A: payments.zoho.in + OAuth token ===');
  const a = await fetch(`https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST', body: payload,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
  });
  console.log('Status:', a.status, await a.text());

  // Test B: account_id in body
  console.log('\n=== B: account_id in body ===');
  const pb = JSON.stringify({ account_id: accountId, amount: 1.00, currency: 'INR', description: 'test', max_retry_count: 1, configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } } });
  const b = await fetch('https://payments.zoho.in/api/v1/paymentsessions', {
    method: 'POST', body: pb,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
  });
  console.log('Status:', b.status, await b.text());

  // Test C: path-style account_id
  console.log('\n=== C: /accounts/{id}/paymentsessions ===');
  const c = await fetch(`https://payments.zoho.in/api/v1/accounts/${accountId}/paymentsessions`, {
    method: 'POST', body: payload,
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
  });
  console.log('Status:', c.status, await c.text());

  // Test D: Check account info GET
  console.log('\n=== D: GET account info ===');
  const d = await fetch(`https://payments.zoho.in/api/v1/accounts/${accountId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  console.log('Status:', d.status, await d.text());

  // Test E: List all payments (simple read)
  console.log('\n=== E: GET /payments ===');
  const e = await fetch(`https://payments.zoho.in/api/v1/payments?account_id=${accountId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  console.log('Status:', e.status, await e.text());
}

main().catch(e => { console.error(e.message); process.exit(1); });
