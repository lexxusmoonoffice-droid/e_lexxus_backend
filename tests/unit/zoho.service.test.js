/**
 * Note: Node 18+ uses native `fetch` built on undici, which is NOT
 * intercepted by nock. We mock `global.fetch` directly with jest.
 *
 * Env vars must be set before requiring zoho.service so the cached
 * `env` config picks them up.
 */

jest.resetModules();
process.env.ZOHO_CLIENT_ID = 'test-client';
process.env.ZOHO_CLIENT_SECRET = 'test-secret';
process.env.ZOHO_REFRESH_TOKEN = 'test-refresh';
process.env.ZOHO_WEBHOOK_SECRET = 'test-webhook-secret';

const crypto = require('crypto');
// eslint-disable-next-line global-require
const cache = require('../../src/services/cache.service');
// eslint-disable-next-line global-require
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

describe('zoho.service — OAuth', () => {
  it('refreshAccessToken hits the OAuth endpoint and returns the token', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-abc', expires_in: 3600 }));
    const t = await zoho.refreshAccessToken();
    expect(t).toBe('tok-abc');
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/accounts\.zoho\.in\/oauth\/v2\/token/);
    expect(url).toMatch(/grant_type=refresh_token/);
  });

  it('throws on non-200 response', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'denied' }, 401));
    await expect(zoho.refreshAccessToken()).rejects.toThrow(/Zoho OAuth failed/);
  });

  it('getAccessToken caches subsequent calls', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1' }));
    const a = await zoho.getAccessToken();
    const b = await zoho.getAccessToken();
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('zoho.service — verifyWebhookSignature', () => {
  it('accepts a valid HMAC', () => {
    const body = Buffer.from('{"event_type":"payment.success"}');
    const sig = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(body)
      .digest('hex');
    expect(zoho.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = Buffer.from('{"event_type":"payment.success"}');
    const sig = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(body)
      .digest('hex');
    const tampered = Buffer.from('{"event_type":"payment.SUCCESS"}');
    expect(zoho.verifyWebhookSignature(tampered, sig)).toBe(false);
  });

  it('rejects when signature missing or wrong shape', () => {
    expect(zoho.verifyWebhookSignature(Buffer.from('x'), '')).toBe(false);
    expect(zoho.verifyWebhookSignature(Buffer.from('x'), null)).toBe(false);
    expect(zoho.verifyWebhookSignature(Buffer.from('x'), 'not-hex')).toBe(false);
  });
});
