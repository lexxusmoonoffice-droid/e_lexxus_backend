/**
 * Covers `attachImageToEntity` branches in upload.service:
 * product.thumbnail, product.gallery, bundle.image, bundle.gallery,
 * blog.image, hero.img, user.avatar. B2 mocked as usual.
 */

jest.mock('../../src/services/b2', () => ({
  presignPutUrl: jest.fn(async ({ key }) => `https://mock.b2/${encodeURI(key)}`),
  presignGetUrl: jest.fn(async ({ key }) => `https://mock.b2/${encodeURI(key)}`),
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
const { Product, Bundle, BlogPost, HeroSlide, User } = require('../../src/models');

setupDB();
const app = buildApp();

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  jest.clearAllMocks();
  b2.headObject.mockResolvedValue({ sizeBytes: 2048, mimeType: 'image/png', etag: 'x' });
  b2.readRange.mockResolvedValue(PNG_HEAD);
});

async function uploadFor(user, kind, refId, role) {
  const fileKey = `images/${kind}/${user._id}/abc/me.png`;
  const res = await request(app)
    .post('/api/uploads/image/confirm')
    .set('Authorization', bearer(user))
    .send({ fileKey, kind, refId, role });
  expect(res.status).toBe(200);
  return res.body.urls.original;
}

describe('attachImageToEntity', () => {
  it('product thumbnail', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator });
    const url = await uploadFor(creator, 'product', product._id.toString(), 'thumbnail');
    const updated = await Product.findById(product._id);
    expect(updated.thumbnail).toBe(url);
  });

  it('product gallery appends to images', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const product = await f.makeProduct({ creator, images: ['http://existing'] });
    const url = await uploadFor(creator, 'product', product._id.toString(), 'gallery');
    const updated = await Product.findById(product._id);
    expect(updated.images).toContain(url);
    expect(updated.images).toContain('http://existing');
  });

  it('bundle thumbnail', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const bundle = await f.makeBundle();
    const url = await uploadFor(creator, 'bundle', bundle._id.toString(), 'thumbnail');
    const updated = await Bundle.findById(bundle._id);
    expect(updated.image).toBe(url);
  });

  it('bundle gallery appends to images', async () => {
    const creator = await f.makeUser({ role: 'creator' });
    const bundle = await f.makeBundle();
    const url = await uploadFor(creator, 'bundle', bundle._id.toString(), 'gallery');
    const updated = await Bundle.findById(bundle._id);
    expect(updated.images).toContain(url);
  });

  it('blog post image', async () => {
    const user = await f.makeUser();
    const post = await f.makeBlogPost();
    const url = await uploadFor(user, 'blog', post._id.toString());
    const updated = await BlogPost.findById(post._id);
    expect(updated.image).toBe(url);
  });

  it('hero slide image', async () => {
    const user = await f.makeUser();
    const slide = await f.makeHeroSlide();
    const url = await uploadFor(user, 'hero', slide._id.toString());
    const updated = await HeroSlide.findById(slide._id);
    expect(updated.img).toBe(url);
  });

  it('avatar updates current user', async () => {
    const user = await f.makeUser();
    const url = await uploadFor(user, 'avatar', user._id.toString());
    const updated = await User.findById(user._id);
    expect(updated.avatar).toBe(url);
  });

  it('confirm without refId does not crash and still returns urls', async () => {
    const user = await f.makeUser();
    const fileKey = `images/avatar/${user._id}/abc/me.png`;
    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(user))
      .send({ fileKey, kind: 'avatar' }); // no refId
    expect(res.status).toBe(200);
    expect(res.body.urls.original).toContain(fileKey);
  });

  it('rejects oversize image at confirm step', async () => {
    const user = await f.makeUser();
    b2.headObject.mockResolvedValueOnce({ sizeBytes: 20 * 1024 * 1024, mimeType: 'image/png' });
    const fileKey = `images/avatar/${user._id}/abc/big.png`;
    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(user))
      .send({ fileKey, kind: 'avatar' });
    expect(res.status).toBe(400);
  });

  it('rejects confirm when object is missing in B2', async () => {
    const user = await f.makeUser();
    b2.headObject.mockRejectedValueOnce(new Error('not found'));
    const fileKey = `images/avatar/${user._id}/abc/missing.png`;
    const res = await request(app)
      .post('/api/uploads/image/confirm')
      .set('Authorization', bearer(user))
      .send({ fileKey, kind: 'avatar' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_OBJECT');
  });

  it('rejects presign with bad kind', async () => {
    const user = await f.makeUser();
    const res = await request(app)
      .post('/api/uploads/image/presign')
      .set('Authorization', bearer(user))
      .send({ filename: 'a.png', mimeType: 'image/png', size: 100, kind: 'junk' });
    expect(res.status).toBe(422); // zod enum mismatch
  });
});
