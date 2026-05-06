/**
 * Attach a request ID for tracing.
 * Honours an inbound `x-request-id`; otherwise generates one.
 * Echoed back as a response header.
 */
const { nanoid } = require('nanoid');

module.exports = function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || nanoid(16);
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
};
