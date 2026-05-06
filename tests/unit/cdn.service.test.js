/**
 * Covers both CDN_DOMAIN branches of cdn.service.
 */

jest.mock('../../src/services/b2', () => ({
  presignGetUrl: jest.fn(async ({ key }) => `https://s3.us-east-005.backblazeb2.com/lexxus-files/${encodeURI(key)}?sig=test`),
}));

describe('cdn.service with CDN_DOMAIN', () => {
  beforeAll(() => {
    jest.resetModules();
    process.env.CDN_DOMAIN = 'files.lexxus.com';
    process.env.B2_ENDPOINT_HOST = 's3.us-east-005.backblazeb2.com';
  });

  it('publicUrl rewrites to CDN host', () => {
    // eslint-disable-next-line global-require
    const cdn = require('../../src/services/cdn.service');
    expect(cdn.publicUrl('products/x/y.zip')).toBe('https://files.lexxus.com/products/x/y.zip');
    expect(cdn.publicUrl(null)).toBeNull();
  });

  it('signedDownloadUrl rewrites host but preserves query', async () => {
    // eslint-disable-next-line global-require
    const cdn = require('../../src/services/cdn.service');
    const url = await cdn.signedDownloadUrl('products/x/y.zip');
    expect(url).toMatch(/^https:\/\/files\.lexxus\.com\//);
    expect(url).toMatch(/sig=test/);
  });
});

describe('cdn.service without CDN_DOMAIN', () => {
  beforeAll(() => {
    jest.resetModules();
    process.env.CDN_DOMAIN = '';
  });

  it('publicUrl falls back to raw B2 URL', () => {
    // eslint-disable-next-line global-require
    const cdn = require('../../src/services/cdn.service');
    const url = cdn.publicUrl('products/x/y.zip');
    expect(url).toContain('backblazeb2.com');
  });

  it('signedDownloadUrl returns the raw signed URL unchanged', async () => {
    // eslint-disable-next-line global-require
    const cdn = require('../../src/services/cdn.service');
    const url = await cdn.signedDownloadUrl('products/x/y.zip');
    expect(url).toContain('backblazeb2.com');
    expect(url).toMatch(/sig=test/);
  });
});
