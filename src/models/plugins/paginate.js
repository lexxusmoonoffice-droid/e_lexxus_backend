/**
 * paginate plugin — adds Model.paginate(filter, options).
 *
 * options:
 *   page, limit (default 1, 20; clamped 1..100)
 *   sort       string or object (default '-createdAt')
 *   select     projection
 *   populate   string | array | object — passed to query.populate
 *   lean       boolean (default false)
 *
 * returns { data, page, limit, total, pages }
 */
module.exports = function paginatePlugin(schema) {
  schema.statics.paginate = async function paginate(filter = {}, options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
    const sort = options.sort || '-createdAt';
    const skip = (page - 1) * limit;

    const query = this.find(filter).sort(sort).skip(skip).limit(limit);
    if (options.select) query.select(options.select);
    if (options.populate) {
      const pops = Array.isArray(options.populate) ? options.populate : [options.populate];
      pops.forEach((p) => query.populate(p));
    }
    if (options.lean) query.lean();

    const [data, total] = await Promise.all([query.exec(), this.countDocuments(filter)]);

    return {
      data,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  };
};
