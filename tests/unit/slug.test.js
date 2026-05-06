const { setupDB } = require('../helpers/db');
const { toSlug, uniqueSlug } = require('../../src/utils/slug');
const Brand = require('../../src/models/Brand');

setupDB();

describe('toSlug', () => {
  it('lowercases and strips junk', () => {
    expect(toSlug('Wall Deco!')).toBe('wall-deco');
    expect(toSlug('  HELLO   World  ')).toBe('hello-world');
    expect(toSlug('Café & Crème')).toMatch(/cafe.*creme/);
  });

  it('returns empty for empty input', () => {
    expect(toSlug('')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('returns base when not taken', async () => {
    const slug = await uniqueSlug(Brand, 'New Brand');
    expect(slug).toBe('new-brand');
  });

  it('appends -2, -3 when taken', async () => {
    await Brand.create({ name: 'X', slug: 'x' });
    const s2 = await uniqueSlug(Brand, 'X');
    expect(s2).toBe('x-2');
    await Brand.create({ name: 'X', slug: 'x-2' });
    const s3 = await uniqueSlug(Brand, 'X');
    expect(s3).toBe('x-3');
  });

  it('ignores currentId when generating (allows updates)', async () => {
    const b = await Brand.create({ name: 'Y', slug: 'y' });
    const s = await uniqueSlug(Brand, 'Y', b._id);
    expect(s).toBe('y');
  });
});
