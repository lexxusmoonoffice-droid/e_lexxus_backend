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
  const accountId    = process.env.ZOHO_ACCOUNT_ID;

  if (!refreshToken) { console.error('No refresh token in DB'); process.exit(1); }

  // Get fresh access token
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  const tr = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tj = await tr.json();
  const token = tj.access_token;
  console.log('Token scope:', tj.scope);
  console.log('Token api_domain:', tj.api_domain);

  const h = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };

  // Try with api_domain from token response
  const apiDomain = tj.api_domain; // https://www.zohoapis.in
  console.log('\n=== Try api_domain base URL ===');
  const r1 = await fetch(`${apiDomain}/payments/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ amount: 1, currency: 'INR', description: 'test', max_retry_count: 1, configurations: { hosted_page_parameters: { description: 'test', success_url: 'https://3dshop.lexxusmoon.com/', failure_url: 'https://3dshop.lexxusmoon.com/' } } }),
  });
  console.log('Status:', r1.status, (await r1.text()).substring(0, 200));

  // Try different token scope — maybe ZohoPayments needs extra scope
  console.log('\n=== Try new token with explicit payments scope ===');
  const body2 = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, scope: 'ZohoPayments.fullaccess.all' });
  const tr2 = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body2.toString(),
  });
  const tj2 = await tr2.json();
  console.log('Scoped token response:', JSON.stringify(tj2).substring(0, 200));

  // Check token info - what user/org is this token for?
  console.log('\n=== Token Info (who am I?) ===');
  const ri = await fetch('https://accounts.zoho.in/oauth/v2/tokeninfo', {
    method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  console.log('Status:', ri.status, await ri.text());

  // Try userinfo
  console.log('\n=== User Info ===');
  const ru = await fetch('https://accounts.zoho.in/oauth/user/info', {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  console.log('Status:', ru.status, await ru.text());
}

main().catch(e => { console.error(e.message); process.exit(1); });
