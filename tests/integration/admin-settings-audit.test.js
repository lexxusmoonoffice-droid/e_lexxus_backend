const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const f = require('../helpers/factories');
const { bearer } = require('../helpers/auth');
const { AuditLog } = require('../../src/models');

setupDB();
const app = buildApp();

async function admin() {
  const user = await f.makeUser({ role: 'admin' });
  return { user, auth: bearer(user) };
}

describe('Admin /settings', () => {
  it('GET then PUT returns updated settings and writes audit entry', async () => {
    const { auth } = await admin();
    const get1 = await request(app).get('/api/admin/settings').set('Authorization', auth);
    expect(get1.status).toBe(200);
    expect(get1.body.settings.storeName).toBe('Lexxus');

    const put = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', auth)
      .send({ storeName: 'Lexxus Premium', payments: { stripeEnabled: true } });
    expect(put.status).toBe(200);
    expect(put.body.settings.storeName).toBe('Lexxus Premium');
    expect(put.body.settings.payments.stripeEnabled).toBe(true);

    const audits = await AuditLog.find({ entity: 'Settings' });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('settings.update');
  });
});

describe('Admin /audit-log', () => {
  it('lists audit entries; filterable by entity', async () => {
    const { user, auth } = await admin();
    // Generate a couple of audit entries by mutating something.
    const cat = await request(app)
      .post('/api/admin/categories')
      .set('Authorization', auth)
      .send({ name: 'Audit Test' });
    await request(app)
      .delete(`/api/admin/categories/${cat.body.category.id}`)
      .set('Authorization', auth);

    const all = await request(app).get('/api/admin/audit-log').set('Authorization', auth);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.data[0].actor.email).toBe(user.email);

    const filtered = await request(app)
      .get('/api/admin/audit-log?entity=Category')
      .set('Authorization', auth);
    expect(filtered.body.data.every((a) => a.entity === 'Category')).toBe(true);
  });
});
