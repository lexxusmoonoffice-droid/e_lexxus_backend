/**
 * In test mode, enqueueEmail always runs synchronously through the
 * mailer.service. We mock `sendMail` and verify the rendered payload.
 */

jest.mock('../../src/services/mailer.service', () => ({
  sendMail: jest.fn(async () => ({ messageId: 'mock' })),
}));

const { sendMail } = require('../../src/services/mailer.service');
const { enqueueEmail } = require('../../src/jobs/emailQueue');

beforeEach(() => {
  sendMail.mockClear();
});

describe('emailQueue', () => {
  it('under NODE_ENV=test enqueueEmail goes synchronous', async () => {
    const res = await enqueueEmail({
      template: 'welcome',
      to: 'x@y.com',
      data: { user: { name: 'X' }, frontendUrl: 'https://x' },
    });
    expect(res.mode).toBe('sync');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe('x@y.com');
    expect(call.subject).toMatch(/Welcome/);
    expect(call.html).toContain('X');
  });

  it('swallows send errors so the caller is never blocked', async () => {
    sendMail.mockRejectedValueOnce(new Error('boom'));
    const res = await enqueueEmail({
      template: 'welcome',
      to: 'x@y.com',
      data: { user: { name: 'X' }, frontendUrl: 'https://x' },
    });
    expect(res.mode).toBe('sync');
  });

  it('errors on unknown template (thrown by renderer, still caught)', async () => {
    const res = await enqueueEmail({ template: 'does-not-exist', to: 'a@b.com', data: {} });
    expect(res.mode).toBe('sync');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
