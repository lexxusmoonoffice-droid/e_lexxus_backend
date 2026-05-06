/**
 * validate(schema, source = 'body') — runs a zod schema against the
 * given request part. On success, replaces req[source] with the
 * parsed value (so coercions and defaults apply). On failure, throws
 * a ZodError which the central error handler maps to a 422.
 *
 *   router.post('/x', validate(loginSchema), handler);
 *   router.get('/x',  validate(querySchema, 'query'), handler);
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    req[source] = schema.parse(req[source] ?? {});
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = validate;
