#!/usr/bin/env node
/**
 * Promote a user to admin role.
 * Usage:  node scripts/make-admin.js <email>
 * Example: node scripts/make-admin.js test@lexxusmoon.com
 */
/* eslint-disable no-console */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const env = require('../src/config/env');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/make-admin.js <email>');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const result = await mongoose.connection.collection('users').findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { $set: { role: 'admin' } },
    { returnDocument: 'after' }
  );

  if (!result) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`✅ ${result.email} is now role="${result.role}"`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
