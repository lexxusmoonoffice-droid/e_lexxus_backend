/**
 * toJSON plugin
 *  - renames `_id` → `id`
 *  - strips `__v`
 *  - strips any field declared `select: false` (e.g. passwordHash)
 *  - strips fields listed in schema.options.toJSON.hide
 */
module.exports = function toJSONPlugin(schema) {
  const hidden = new Set();

  schema.eachPath((path, schemaType) => {
    if (schemaType.options && schemaType.options.select === false) {
      hidden.add(path);
    }
  });

  const extra = (schema.options.toJSON && schema.options.toJSON.hide) || [];
  extra.forEach((p) => hidden.add(p));

  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      hidden.forEach((p) => {
        delete ret[p];
      });
      return ret;
    },
  });
};
