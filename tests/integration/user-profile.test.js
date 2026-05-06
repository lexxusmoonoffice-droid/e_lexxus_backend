const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { User } = require('../../src/models');

setupDB();
const app = buildApp();

describe('Users — profile', () => {
  it('GET /me returns current user', async () => {
    const u = await f.makeUser({ name: 'Alex' });
    const res = await request(app).get('/api/users/me').set('Authorization', bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Alex');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('PUT /me updates name + bio', async () => {
    const u = await f.makeUser();
    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', bearer(u))
      .send({ name: 'New Name', bio: 'Hi' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('New Name');
    expect(res.body.user.bio).toBe('Hi');
  });

  it('PUT /me/password changes password (alias for auth/change-password)', async () => {
    const u = await f.makeUser({ password: 'first1234' });
    const res = await request(app)
      .put('/api/users/me/password')
      .set('Authorization', bearer(u))
      .send({ currentPassword: 'first1234', newPassword: 'second1234' });
    expect(res.status).toBe(200);
  });

  it('GET /me/export returns all user data', async () => {
    const u = await f.makeUser();
    const res = await request(app).get('/api/users/me/export').set('Authorization', bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(u.id);
    expect(res.body).toHaveProperty('orders');
    expect(res.body).toHaveProperty('reviews');
  });

  it('DELETE /me wipes the user (GDPR)', async () => {
    const u = await f.makeUser();
    const res = await request(app).delete('/api/users/me').set('Authorization', bearer(u));
    expect(res.status).toBe(204);
    const gone = await User.findById(u._id);
    expect(gone).toBeNull();
  });

  it('all profile routes 401 without auth', async () => {
    expect((await request(app).get('/api/users/me')).status).toBe(401);
    expect((await request(app).put('/api/users/me').send({})).status).toBe(401);
    expect((await request(app).delete('/api/users/me')).status).toBe(401);
    expect((await request(app).get('/api/users/me/export')).status).toBe(401);
  });
});
