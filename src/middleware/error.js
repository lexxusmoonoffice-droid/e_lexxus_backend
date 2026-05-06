/**
 * Centralised error handler.
 * Maps known error types (AppError, Mongoose, JWT, Zod) to HTTP responses.
 * Hides stack traces in production.
 */

const { ZodError } = require('zod');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

// 404 — last route in the chain
function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`, 'ROUTE_NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Invalid input';
    details = err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_ID';
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    message = `Duplicate value for ${Object.keys(err.keyValue || {}).join(', ')}`;
    details = err.keyValue;
  } else if (err instanceof jwt.TokenExpiredError) {
    status = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  } else if (err instanceof jwt.JsonWebTokenError) {
    status = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err.status && err.status < 500) {
    status = err.status;
    code = err.code || 'BAD_REQUEST';
    message = err.message;
  }

  // Log: 5xx as error, 4xx as warn, with request context
  const logPayload = {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    status,
    code,
    userId: req.user?.id,
    ...(env.isProd ? {} : { stack: err.stack }),
  };
  if (status >= 500) logger.error(`[err] ${message}`, logPayload);
  else logger.warn(`[err] ${message}`, logPayload);

  const body = { error: message, code };
  if (details !== undefined) body.details = details;
  if (!env.isProd && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}

module.exports = { errorHandler, notFoundHandler };
