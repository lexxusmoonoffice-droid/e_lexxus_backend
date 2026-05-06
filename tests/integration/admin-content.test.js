const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { BlogPost, HeroSlide } = require('../../src/models');

setupDB();
const app = buildApp();

async function admin() {
  const user = await f.makeUser({ role: 'admin' });
  return { user, auth: bearer(user) };
}

describe('Admin /blog', () => {
  it('CRUD cycle', async () => {
    const { auth, user } = await admin();
    const created = await request(app)
      .post('/api/admin/blog')
      .set('Authorization', auth)
      .send({ title: 'Hello Admin', excerpt: 'x', content: '<p>body</p>', status: 'published' });
    expect(created.status).toBe(201);
    expect(created.body.post.slug).toBe('hello-admin');
    expect(created.body.post.authorName).toBe(user.name);

    const list = await request(app).get('/api/admin/blog').set('Authorization', auth);
    expect(list.body.total).toBe(1);

    const upd = await request(app)
      .put(`/api/admin/blog/${created.body.post.id}`)
      .set('Authorization', auth)
      .send({ title: 'Renamed' });
    expect(upd.body.post.title).toBe('Renamed');

    const del = await request(app)
      .delete(`/api/admin/blog/${created.body.post.id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(await BlogPost.countDocuments()).toBe(0);
  });
});

describe('Admin /hero-slides', () => {
  it('CRUD + toggle + reorder', async () => {
    const { auth } = await admin();
    const base = { img: 'https://x/y.jpg', title: ['L1', 'L2'], sub: 'sub', cta: 'Go', href: '/' };

    const s1 = await request(app).post('/api/admin/hero-slides').set('Authorization', auth).send({ ...base, order: 0 });
    const s2 = await request(app).post('/api/admin/hero-slides').set('Authorization', auth).send({ ...base, order: 1 });
    expect(s1.status).toBe(201);

    const list = await request(app).get('/api/admin/hero-slides').set('Authorization', auth);
    expect(list.body.data).toHaveLength(2);

    const toggle = await request(app)
      .patch(`/api/admin/hero-slides/${s1.body.slide.id}/toggle`)
      .set('Authorization', auth);
    expect(toggle.body.slide.active).toBe(false);

    const reorder = await request(app)
      .put('/api/admin/hero-slides/reorder')
      .set('Authorization', auth)
      .send({ ids: [s2.body.slide.id, s1.body.slide.id] });
    expect(reorder.status).toBe(200);
    expect(reorder.body.data[0].id).toBe(s2.body.slide.id);

    await request(app).delete(`/api/admin/hero-slides/${s1.body.slide.id}`).set('Authorization', auth);
    await request(app).delete(`/api/admin/hero-slides/${s2.body.slide.id}`).set('Authorization', auth);
    expect(await HeroSlide.countDocuments()).toBe(0);
  });
});
