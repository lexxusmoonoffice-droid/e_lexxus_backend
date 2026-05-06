/**
 * Clear stale Zoho credentials from Settings DB so .env values take effect.
 * Run once: `node scripts/clear-zoho.js`
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const dns = require('dns');
if (process.env.MONGODB_DNS_SERVERS) {
  dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
}
const mongoose = require('mongoose');
const { Settings } = require('../src/models');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const before = await Settings.findOne({}, '+integrations.zoho.clientSecret +integrations.zoho.refreshToken +integrations.zoho.webhookSecret');
  console.log('BEFORE:', JSON.stringify(before?.integrations?.zoho || {}, null, 2));

  await Settings.updateOne({}, {
    $unset: {
      'integrations.zoho.clientId': '',
      'integrations.zoho.clientSecret': '',
      'integrations.zoho.refreshToken': '',
      'integrations.zoho.webhookSecret': '',
      'integrations.zoho.connectedAt': '',
      'integrations.zoho.connectedBy': '',
      'integrations.zoho.scope': '',
    },
  });

  const after = await Settings.findOne({}, '+integrations.zoho.clientSecret +integrations.zoho.refreshToken +integrations.zoho.webhookSecret');
  console.log('AFTER:', JSON.stringify(after?.integrations?.zoho || {}, null, 2));
  console.log('\n✅ Zoho settings cleared. Backend will now use .env values.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
