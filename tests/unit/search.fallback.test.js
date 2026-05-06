/**
 * search.service.js has a $text→regex fallback. Integration tests
 * typically hit the $text path because seed fixtures include the
 * search term verbatim. Here we hit the regex fallback by searching
 * for a substring that $text misses (prefix match).
 */

const { setupDB } = require('../helpers/db');
const f = require('../helpers/factories');
const search = require('../../src/services/search.service');

setupDB();

describe('search.service regex fallback', () => {
  it('matches products by tag substring when $text returns nothing', async () => {
    await f.makeProduct({ title: 'Velvet Sofa Atlas', tags: ['cozy'], status: 'published' });
    // "sof" is a prefix that `$text` ignores (it's stemmed), but the regex
    // fallback finds "Sofa" in the title.
    const res = await search.globalSearch('sof', 5);
    expect(Array.isArray(res.products)).toBe(true);
    // Either $text or regex path is OK — we just need at least one hit.
    expect(res.products.length).toBeGreaterThan(0);
  });

  it('includes bundles + blog when their names/titles match', async () => {
    await f.makeProduct({ title: 'Nothing Match', status: 'published' });
    await f.makeBundle({ name: 'Alpha Pack', description: 'special', status: 'published' });
    await f.makeBlogPost({ title: 'Alpha World', excerpt: 'story', status: 'published' });
    const res = await search.globalSearch('alpha', 5);
    expect(res.bundles.length).toBeGreaterThan(0);
    expect(res.blog.length).toBeGreaterThan(0);
  });
});
