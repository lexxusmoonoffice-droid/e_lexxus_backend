/**
 * Spin up an in-memory MongoDB for the duration of a test file.
 *
 *   const { setupDB } = require('../helpers/db');
 *   setupDB();
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;

function setupDB() {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { autoIndex: true });
    // Force-build all known indexes before any test runs (so unique
    // constraints work on the very first write).
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });

  afterEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });
}

module.exports = { setupDB };
