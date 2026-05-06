/**
 * Direct tests for the toJSON + paginate plugins (independent of any model).
 */
const mongoose = require('mongoose');
const { setupDB } = require('../helpers/db');
const toJSON = require('../../src/models/plugins/toJSON');
const paginate = require('../../src/models/plugins/paginate');

setupDB();

const schema = new mongoose.Schema(
  {
    name: String,
    secret: { type: String, select: false },
    publicNote: String,
  },
  { timestamps: true, toJSON: { hide: ['publicNote'] } },
);
schema.plugin(toJSON);
schema.plugin(paginate);
const Thing = mongoose.model('Thing', schema);

describe('toJSON plugin', () => {
  it('renames _id to id and strips select:false + hide list', async () => {
    const doc = await Thing.create({ name: 'x', secret: 'shh', publicNote: 'gone' });
    const json = doc.toJSON();
    expect(json.id).toBeDefined();
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.secret).toBeUndefined();
    expect(json.publicNote).toBeUndefined();
    expect(json.name).toBe('x');
  });
});

describe('paginate plugin', () => {
  beforeEach(async () => {
    await Thing.deleteMany({});
    for (let i = 0; i < 25; i += 1) {
      // small stagger so sort is deterministic
      // eslint-disable-next-line no-await-in-loop
      await Thing.create({ name: `n-${i}` });
    }
  });

  it('default page/limit', async () => {
    const r = await Thing.paginate();
    expect(r.total).toBe(25);
    expect(r.limit).toBe(20);
    expect(r.page).toBe(1);
    expect(r.pages).toBe(2);
    expect(r.data.length).toBe(20);
  });

  it('honours explicit page + limit', async () => {
    const r = await Thing.paginate({}, { page: 2, limit: 10 });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(10);
    expect(r.data.length).toBe(10);
  });

  it('clamps limit to 100', async () => {
    const r = await Thing.paginate({}, { limit: 9999 });
    expect(r.limit).toBe(100);
  });

  it('returns empty pages=1 when no docs', async () => {
    await Thing.deleteMany({});
    const r = await Thing.paginate();
    expect(r.total).toBe(0);
    expect(r.pages).toBe(1);
    expect(r.data.length).toBe(0);
  });
});
