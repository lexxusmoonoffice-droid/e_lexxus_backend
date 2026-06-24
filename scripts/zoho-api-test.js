#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function main() {
  const apiKey    = process.env.ZOHO_API_KEY;
  const accountId = process.env.ZOHO_ACCOUNT_ID;

  console.log('Testing API Key:', apiKey?.substring(0, 30) + '...');
  console.log('Account ID:', accountId);

  const h = {
    Authorization: `Zoho-oauthtoken ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Test 1: GET account info
  console.log('\n--- GET /accounts/' + accountId + ' ---');
  const r1 = await fetch(`https://payments.zoho.in/api/v1/accounts/${accountId}`, { headers: h });
  console.log('Status:', r1.status, await r1.text());

  // Test 2: Create ₹1 test session
  console.log('\n--- POST /paymentsessions ---');
  const r2 = await fetch(`https://payments.zoho.in/api/v1/paymentsessions?account_id=${accountId}`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      amount: 1.00,
      currency: 'INR',
      description: 'api-test',
      max_retry_count: 1,
      configurations: {
        hosted_page_parameters: {
          description: 'api-test',
          success_url: 'https://3dshop.lexxusmoon.com/checkout/success',
          failure_url: 'https://3dshop.lexxusmoon.com/checkout/cancel',
        },
      },
    }),
  });
  console.log('Status:', r2.status, await r2.text());
}

main().catch(e => { console.error(e.message); process.exit(1); });
