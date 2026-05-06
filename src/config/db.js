/**
 * Mongoose connection helper.
 * Connect once on boot; tests use mongodb-memory-server and bypass this.
 *
 * `mongodb+srv://` URIs require a DNS SRV lookup. If that fails with
 * `querySrv ECONNREFUSED`, set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 in .env
 * or use MongoDB Atlas’s standard (non-SRV) connection string.
 */

const dns = require('dns');
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

mongoose.set('strictQuery', true);

let isConnected = false;

function applyMongoDnsServers() {
  const raw = env.MONGODB_DNS_SERVERS?.trim();
  if (!raw) return;
  const servers = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!servers.length) return;
  dns.setServers(servers);
  logger.info('mongo: using MONGODB_DNS_SERVERS for SRV resolution', { servers });
}

async function connect(uri = env.MONGODB_URI) {
  if (isConnected) return mongoose.connection;

  mongoose.connection.on('connected', () => {
    logger.info('mongo: connected', { host: mongoose.connection.host });
  });
  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('mongo: disconnected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error('mongo: error', { message: err.message });
  });

  applyMongoDnsServers();

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      autoIndex: !env.isProd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('querySrv')) {
      logger.error(
        'mongo: SRV DNS lookup failed for mongodb+srv URI. Fix: set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 in backend/.env, ' +
          'or in Atlas → Connect use the standard mongodb://… connection string (not SRV). ' +
          'Underlying error:',
        { message: msg }
      );
    }
    throw err;
  }
  isConnected = true;
  return mongoose.connection;
}

async function disconnect() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}

function isHealthy() {
  return mongoose.connection.readyState === 1; // 1 = connected
}

module.exports = { connect, disconnect, isHealthy, mongoose };
