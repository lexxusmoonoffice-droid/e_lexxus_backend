/**
 * End-to-end email flow check: register → expect verify email,
 * login → reset → expect reset email. mailer.service is mocked to
 * intercept outgoing mail.
 */

jest.mock('../../src/services/mailer.service', () => ({
  sendMail: jest.fn(async () => ({ messageId: 'mock' })),
}));

const request = require('supertest');
const { setupDB } = require('../helpers/db');
const buildApp = require('../../src/app');
const { sendMail } = require('../../src/services/mailer.service');
const { User } = require('../../src/models');

setupDB();
const app = buildApp();

beforeEach(() => {
  sendMail.mockClear();
});

describe('Email pipeline end-to-end', () => {
  it('registration enqueues the verify email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alex Novak',
      email: 'alex@lexxus.com',
      password: 'pa$$word123',
    });
    expect(res.status).toBe(201);

    // One call in test mode (synchronous).
    expect(sendMail).toHaveBeenCalled();
    const [{ to, subject, html }] = sendMail.mock.calls[0];
    expect(to).toBe('alex@lexxus.com');
    expect(subject).toMatch(/Verify/);
    expect(html).toContain('Alex Novak');
    expect(html).toMatch(/verify-email\?token=/);
  });

  it('forgot-password sends reset email when the user exists', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'B',
      email: 'b@lexxus.com',
      password: 'pa$$word123',
    });
    sendMail.mockClear();

    await request(app).post('/api/auth/forgot-password').send({ email: 'b@lexxus.com' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].subject).toMatch(/Reset/);
  });

  it('forgot-password for unknown email does NOT send', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@x.com' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
