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
  const refreshToken = z.refreshToken || '';
  const accountId    = process.env.ZOHO_ACCOUNT_ID; // 60065293568

  // Zoho User ID from profile popup
  const zohoUserId   = '60044809916';

  if (!refreshToken) { console.error('No refresh token in DB'); process.exit(1); }

  // Get fresh access token
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  const tr = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tj = await tr.json();
  const token = tj.access_token;
  console.log('Token OK:', !!token, '| Scope:', tj.scope);

  const sessionBody = JSON.stringify({
    amount: 1.00, currency: 'INR', description: 'test', max_retry_count: 1,
    configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } },
  });

  // Test A: Standard (baseline)
  console.log('\n=== A: Standard (baseline) ===');
  const a = await fetch(`https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST', body: sessionBody,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
  });
  console.log('Status:', a.status, await a.text());

  // Test B: With X-com-zoho-payments-organizationid header
  console.log('\n=== B: With org ID header (user ID) ===');
  const b = await fetch(`https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST', body: sessionBody,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      'X-com-zoho-payments-organizationid': zohoUserId,
    },
  });
  console.log('Status:', b.status, await b.text());

  // Test C: With account_id as header instead
  console.log('\n=== C: account_id as header ===');
  const c = await fetch('https://payments.zoho.in/api/v1/paymentsessions', {
    method: 'POST', body: sessionBody,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      'X-com-zoho-payments-accountid': accountId,
    },
  });
  console.log('Status:', c.status, await c.text());

  // Test D: Try GET /accounts (no ID) to see what's accessible
  console.log('\n=== D: GET /accounts (list) ===');
  const d = await fetch('https://payments.zoho.in/api/v1/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  console.log('Status:', d.status, await d.text());

  // Test E: Try without account_id at all
  console.log('\n=== E: POST /paymentsessions (no account_id) ===');
  const e = await fetch('https://payments.zoho.in/api/v1/paymentsessions', {
    method: 'POST', body: sessionBody,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
  });
  console.log('Status:', e.status, await e.text());
}

main().catch(e => { console.error(e.message); process.exit(1); });
