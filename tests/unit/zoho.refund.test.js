/**
 * Covers Zoho refundPayment + createCheckoutSession happy/error paths
 * which aren't hit by the main payment flow tests.
 */

jest.resetModules();
process.env.ZOHO_CLIENT_ID = 'c';
process.env.ZOHO_CLIENT_SECRET = 's';
process.env.ZOHO_REFRESH_TOKEN = 'r';
process.env.ZOHO_WEBHOOK_SECRET = 'w';

const cache = require('../../src/services/cache.service');
const zoho = require('../../src/services/zoho.service');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  cache._resetMemory();
  global.fetch = jest.fn();
});

describe('zoho.refundPayment', () => {
  it('happy path', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ refund_id: 'r-1' }));
    const res = await zoho.refundPayment({ paymentId: 'pay-1', amount: 100, reason: 'test' });
    expect(res).toEqual({ refund_id: 'r-1' });
    const [url] = global.fetch.mock.calls[1];
    expect(url).toMatch(/\/payments\/pay-1\/refunds$/);
  });

  it('throws on non-2xx from Zoho', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'denied' }, 400));
    await expect(
      zoho.refundPayment({ paymentId: 'pay-1', amount: 100 }),
    ).rejects.toThrow(/Zoho refund failed/);
  });
});

describe('zoho.createCheckoutSession', () => {
  it('sends amount in paise + returns paymentUrl', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ session_id: 's-1', payment_url: 'https://pay/s-1' }));
    const res = await zoho.createCheckoutSession({
      amount: 100,
      description: 'test',
      referenceId: 'o-1',
      redirectUrl: 'r',
      cancelUrl: 'c',
      customer: { email: 'x@y.com', name: 'x' },
    });
    expect(res.paymentUrl).toBe('https://pay/s-1');
    expect(res.sessionId).toBe('s-1');
    const body = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(body.amount).toBe(10000); // 100 rupees → 10_000 paise
  });

  it('throws on non-2xx', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 422));
    await expect(
      zoho.createCheckoutSession({
        amount: 100,
        description: 'x',
        referenceId: 'o',
        redirectUrl: 'r',
        cancelUrl: 'c',
        customer: { email: 'e', name: 'n' },
      }),
    ).rejects.toThrow(/Zoho session creation failed/);
  });
});

describe('zoho.refreshAccessToken error surface', () => {
  it('throws with helpful message when creds missing', async () => {
    // Temporarily unset — use jest.isolateModules for a clean re-require
    jest.isolateModules(() => {
      delete process.env.ZOHO_CLIENT_ID;
      // eslint-disable-next-line global-require
      const z = require('../../src/services/zoho.service');
      expect(z.refreshAccessToken()).rejects.toThrow(/Zoho credentials not configured/);
    });
  });
});
