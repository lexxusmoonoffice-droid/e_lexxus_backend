/**
 * Upload integration tests — B2 service is mocked, so we exercise
 * presign/confirm route logic + magic-byte checks without hitting
 * a real bucket.
 */

jest.mock('../../src/services/b2', () => ({
  presignPutUrl: jest.fn(async ({ key }) => `https://mock.b2/${encodeURI(key)}?sig=test`),
  presignGetUrl: jest.fn(async ({ key }) => `https://mock.b2/${encodeURI(key)}?get=1`),
  headObject: jest.fn(),
  readRange: jest.fn(),
  putObject: jest.fn(async () => ({})),
  deleteObject: jest.fn(async () => ({})),
  listAll: jest.fn(),
}));

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const b2 = require('../../src/services/b2');
const { Product } = require('../../src/models');

setupDB();
const app = buildApp();

const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const JUNK_HEAD = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef]);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/uploads/product-file/presign', () => {
  it('401 without auth', async () => {
    const res = await request(app)
      .post('/api/uploads/product-file/presign')
      .send({ filename: 'a.zip', mimeType: 'application/zip', size: 100 });
    expect(res.status).toBe(401);
  });

  it('403 for buyers', async () => {
    const buyer = await f.makeUser({ role: 'buyer' });
    const res = await request(app)
      .post('/api/uploads/product-file/presign')
      .set('Authorization', bearer(buyer))
      .send({ filename: 'a.zip', mimeType: 'application/zip', size: 100 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WRONG_ROLE');
  });

  it('returns presigned URL + fileKey under creator prefix for creators', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const res = await request(app)
      .post('/api/uploads/product-file/presign')
      .set('Authorization', bearer(creator))
      .send({ filename: 'asset.zip', mimeType: 'application/zip', size: 1024 });
    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toMatch(/^https:\/\/mock\.b2\//);
    expect(res.body.fileKey.startsWith(`products/${creator._id}/`)).toBe(true);
    expect(res.body.expiresIn).toBe(900);
    expect(b2.presignPutUrl).toHaveBeenCalledTimes(1);
  });

  it('rejects non-ZIP mime', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const res = await request(app)
      .post('/api/uploads/product-file/presign')
      .set('Authorization', bearer(creator))
      .send({ filename: 'a.exe', mimeType: 'application/octet-stream', size: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_MIME');
  });

  it('rejects oversize', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const res = await request(app)
      .post('/api/uploads/product-file/presign')
      .set('Authorization', bearer(creator))
      .send({ filename: 'huge.zip', mimeType: 'application/zip', size: 5 * 1024 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_LARGE');
  });
});

describe('POST /api/uploads/product-file/confirm', () => {
  it('attaches valid ZIP to creator-owned product', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator });
    const fileKey = `products/${creator._id}/abc/asset.zip`;
    b2.headObject.mockResolvedValueOnce({ sizeBytes: 1024, mimeType: 'application/zip', etag: 'deadbeef' });
    b2.readRange.mockResolvedValueOnce(ZIP_HEAD);

    const res = await request(app)
      .post('/api/uploads/product-file/confirm')
      .set('Authorization', bearer(creator))
      .send({ fileKey, productId: product._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.product.file.b2FileName).toBe(fileKey);
    expect(res.body.product.file.sizeBytes).toBe(1024);
    expect(res.body.product.fileSizeMb).toBeCloseTo(0);

    const updated = await Product.findById(product._id);
    expect(updated.file.b2FileName).toBe(fileKey);
  });

  it('blocks attaching to another creator\'s product', async () => {
    const owner = await f.makeUser({ role: 'creator' });
    const intruder = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator: owner });
    const fileKey = `products/${owner._id}/abc/asset.zip`;
    const res = await request(app)
      .post('/api/uploads/product-file/confirm')
      .set('Authorization', bearer(intruder))
      .send({ fileKey, productId: product._id.toString() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_OWNER');
  });

  it('blocks fileKey under wrong creator prefix', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator });
    const res = await request(app)
      .post('/api/uploads/product-file/confirm')
      .set('Authorization', bearer(creator))
      .send({
        fileKey: `products/somebody-else/abc/asset.zip`,
        productId: product._id.toString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_KEY');
  });

  it('rejects non-ZIP magic bytes and deletes the bad object', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator });
    const fileKey = `products/${creator._id}/abc/fake.zip`;
    b2.headObject.mockResolvedValueOnce({ sizeBytes: 16, mimeType: 'application/zip', etag: 'x' });
    b2.readRange.mockResolvedValueOnce(JUNK_HEAD);

    const res = await request(app)
      .post('/api/uploads/product-file/confirm')
      .set('Authorization', bearer(creator))
      .send({ fileKey, productId: product._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_ZIP');
    expect(b2.deleteObject).toHaveBeenCalledWith(fileKey);
  });
});

describe('POST /api/uploads/image/presign', () => {
  it('returns presigned URL under correct prefix', async () => {
    const u = await f.makeUser();
    const res = await request(app)
      .post('/api/uploads/image/presign')
      .set('Authorization', bearer(u))
      .send({
        filename: 'avatar.png',
        mimeType: 'image/png',
        size: 50_000,
        kind: 'avatar',
      });
    expect(res.status).toBe(200);
    expect(res.body.fileKey.startsWith(`images/avatar/${u._id}/`)).toBe(true);
  });

  it('rejects unknown kind', async () => {
    const u = await f.makeUser();
    const res = await request(app)
      .post('/api/uploads/image/presign')
      .set('Authorization', bearer(u))
      .send({ filename: 'a.png', mimeType: 'image/png', size: 100, kind: 'banana' });
    expect(res.status).toBe(422);
  });

  it('rejects non-image mime', async () => {
    const u = await f.makeUser();
    const res = await request(app)
      .post('/api/uploads/image/presign')
      .set('Authorization', bearer(u))
      .send({ filename: 'a.txt', mimeType: 'text/plain', size: 100, kind: 'avatar' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_MIME');
  });
});

describe('POST /api/uploads/image/confirm', () => {
  it('attaches avatar URL to user', async () => {
    const u = await f.makeUser();
    const fileKey = `images/avatar/${u._id}/abc/me.png`;
    b2.headObject.mockResolvedValueOnce({ sizeBytes: 2048, mimeType: 'image/png', etag: 'x' });
    b2.readRange.mockResolvedValueOnce(PNG_HEAD);

    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(u))
      .send({ fileKey, kind: 'avatar', refId: u._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.urls.original).toContain(fileKey);
  });

  it('blocks file key from a different user', async () => {
    const u = await f.makeUser();
    const fileKey = `images/avatar/some-other-user/abc/me.png`;
    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(u))
      .send({ fileKey, kind: 'avatar' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_KEY');
  });

  it('rejects non-image magic bytes and deletes the bad object', async () => {
    const u = await f.makeUser();
    const fileKey = `images/avatar/${u._id}/abc/fake.png`;
    b2.headObject.mockResolvedValueOnce({ sizeBytes: 16, mimeType: 'image/png', etag: 'x' });
    b2.readRange.mockResolvedValueOnce(JUNK_HEAD);
    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(u))
      .send({ fileKey, kind: 'avatar' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_IMAGE');
    expect(b2.deleteObject).toHaveBeenCalledWith(fileKey);
  });
});
