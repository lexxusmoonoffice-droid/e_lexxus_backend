const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { Product, Bundle, Category, Brand, AuditLog } = require('../../src/models');

setupDB();
const app = buildApp();

async function admin() {
  const user = await f.makeUser({ role: 'admin' });
  return { user, auth: bearer(user) };
}

describe('Admin /products', () => {
  it('gates with 403 for buyers', async () => {
    const buyer = await f.makeUser({ role: 'buyer' });
    const res = await request(app).get('/api/admin/products').set('Authorization', bearer(buyer));
    expect(res.status).toBe(403);
  });

  it('list shows drafts (public endpoint hides them)', async () => {
    const { auth } = await admin();
    await f.makeProduct({ status: 'draft', title: 'Draft One' });
    await f.makeProduct({ status: 'published', title: 'Live' });
    const res = await request(app).get('/api/admin/products').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('create + update + delete writes audit entries', async () => {
    const { auth } = await admin();
    const cat = await f.makeCategory();

    const created = await request(app)
      .post('/api/admin/products')
      .set('Authorization', auth)
      .send({
        title: 'Admin Product',
        description: 'd',
        category: cat._id.toString(),
        price: 500,
      });
    expect(created.status).toBe(201);
    const id = created.body.product.id;

    const updated = await request(app)
      .put(`/api/admin/products/${id}`)
      .set('Authorization', auth)
      .send({ title: 'Renamed' });
    expect(updated.body.product.title).toBe('Renamed');

    const patched = await request(app)
      .patch(`/api/admin/products/${id}/status`)
      .set('Authorization', auth)
      .send({ status: 'published' });
    expect(patched.body.product.status).toBe('published');

    const del = await request(app).delete(`/api/admin/products/${id}`).set('Authorization', auth);
    expect(del.status).toBe(204);

    const audits = await AuditLog.find({ entity: 'Product' }).sort('createdAt');
    expect(audits.map((a) => a.action)).toEqual([
      'product.create',
      'product.update',
      'product.status',
      'product.delete',
    ]);
  });

  it('bulk publish changes status across many', async () => {
    const { auth } = await admin();
    const p1 = await f.makeProduct({ status: 'draft' });
    const p2 = await f.makeProduct({ status: 'draft' });
    const res = await request(app)
      .post('/api/admin/products/bulk')
      .set('Authorization', auth)
      .send({ ids: [p1._id, p2._id], action: 'publish' });
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(2);
    const fresh = await Product.find({ _id: { $in: [p1._id, p2._id] } });
    expect(fresh.every((p) => p.status === 'published')).toBe(true);
  });
});

describe('Admin /bundles', () => {
  it('creates + lists + deletes a bundle', async () => {
    const { auth } = await admin();
    const product = await f.makeProduct();

    const created = await request(app)
      .post('/api/admin/bundles')
      .set('Authorization', auth)
      .send({
        name: 'Admin Bundle',
        productIds: [product._id.toString()],
        bundlePrice: 100,
        originalPrice: 200,
      });
    expect(created.status).toBe(201);
    expect(created.body.bundle.savingsPct).toBe(50);

    const list = await request(app).get('/api/admin/bundles').set('Authorization', auth);
    expect(list.body.total).toBe(1);

    const del = await request(app).delete(`/api/admin/bundles/${created.body.bundle.id}`).set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(await Bundle.countDocuments()).toBe(0);
  });
});

describe('Admin /categories + /brands', () => {
  it('Categories CRUD full cycle', async () => {
    const { auth } = await admin();
    const c = await request(app)
      .post('/api/admin/categories')
      .set('Authorization', auth)
      .send({ name: 'Tables' });
    expect(c.status).toBe(201);
    expect(c.body.category.slug).toBe('tables');

    const upd = await request(app)
      .put(`/api/admin/categories/${c.body.category.id}`)
      .set('Authorization', auth)
      .send({ name: 'Tables & Desks' });
    expect(upd.body.category.name).toBe('Tables & Desks');

    const del = await request(app)
      .delete(`/api/admin/categories/${c.body.category.id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(await Category.countDocuments()).toBe(0);
  });

  it('Brands CRUD', async () => {
    const { auth } = await admin();
    const b = await request(app).post('/api/admin/brands').set('Authorization', auth).send({ name: 'Acme' });
    expect(b.status).toBe(201);
    expect(b.body.brand.slug).toBe('acme');

    await request(app).delete(`/api/admin/brands/${b.body.brand.id}`).set('Authorization', auth);
    expect(await Brand.countDocuments()).toBe(0);
  });
});
