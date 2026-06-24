#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  await mongoose.connection.collection('settings').updateOne(
    {},
    { $unset: { 'integrations.zoho.refreshToken': '', 'integrations.zoho.connectedAt': '', 'integrations.zoho.scope': '' } }
  );
  console.log('Old Zoho refresh token cleared from MongoDB.');
  await mongoose.disconnect();
}).catch(e => { console.error(e.message); process.exit(1); });
