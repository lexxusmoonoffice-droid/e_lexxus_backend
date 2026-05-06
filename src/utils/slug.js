/**
 * Slug helpers — wraps `slugify` with project defaults.
 */
const slugify = require('slugify');

const opts = { lower: true, strict: true, trim: true };

function toSlug(input = '') {
  return slugify(String(input), opts);
}

/**
 * Ensure a slug is unique within a model. Appends `-2`, `-3`, ... until free.
 */
async function uniqueSlug(Model, base, currentId = null) {
  const baseSlug = toSlug(base) || 'item';
  let candidate = baseSlug;
  let n = 2;
  while (true) {
    const filter = { slug: candidate };
    if (currentId) filter._id = { $ne: currentId };
    const exists = await Model.exists(filter);
    if (!exists) return candidate;
    candidate = `${baseSlug}-${n}`;
    n += 1;
  }
}

module.exports = { toSlug, uniqueSlug };
