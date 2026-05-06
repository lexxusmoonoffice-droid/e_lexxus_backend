const request = require('supertest');
const express = require('express');
const { ZodError, z } = require('zod');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const requestId = require('../../src/middleware/requestId');
const { errorHandler, notFoundHandler } = require('../../src/middleware/error');
const AppError = require('../../src/utils/AppError');
const asyncHandler = require('../../src/utils/asyncHandler');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);

  app.get(
    '/throw/app',
    asyncHandler(async () => {
      throw AppError.badRequest('bad input', 'BAD_INPUT', { field: 'email' });
    }),
  );

  app.get(
    '/throw/zod',
    asyncHandler(async () => {
      z.object({ name: z.string() }).parse({});
    }),
  );

  app.get(
    '/throw/mongoose-validation',
    asyncHandler(async () => {
      const err = new mongoose.Error.ValidationError(null);
      err.errors = { name: { path: 'name', message: 'required' } };
      throw err;
    }),
  );

  app.get(
    '/throw/cast',
    asyncHandler(async () => {
      throw new mongoose.Error.CastError('ObjectId', 'abc', 'productId');
    }),
  );

  app.get(
    '/throw/dup',
    asyncHandler(async () => {
      const err = new Error('dup');
      err.code = 11000;
      err.keyValue = { email: 'foo@bar.com' };
      throw err;
    }),
  );

  app.get(
    '/throw/jwt-expired',
    asyncHandler(async () => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    }),
  );

  app.get(
    '/throw/jwt-invalid',
    asyncHandler(async () => {
      throw new jwt.JsonWebTokenError('invalid signature');
    }),
  );

  app.get(
    '/throw/unknown',
    asyncHandler(async () => {
      throw new Error('mystery');
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  const app = buildTestApp();

  it('AppError → status + code + details', async () => {
    const res = await request(app).get('/throw/app');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad input', code: 'BAD_INPUT', details: { field: 'email' } });
  });

  it('ZodError → 422 VALIDATION_ERROR with details', async () => {
    const res = await request(app).get('/throw/zod');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('Mongoose ValidationError → 422', async () => {
    const res = await request(app).get('/throw/mongoose-validation');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('Mongoose CastError → 400 BAD_ID', async () => {
    const res = await request(app).get('/throw/cast');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_ID');
  });

  it('Duplicate-key (E11000) → 409 DUPLICATE_KEY', async () => {
    const res = await request(app).get('/throw/dup');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });

  it('TokenExpiredError → 401 TOKEN_EXPIRED', async () => {
    const res = await request(app).get('/throw/jwt-expired');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('JsonWebTokenError → 401 INVALID_TOKEN', async () => {
    const res = await request(app).get('/throw/jwt-invalid');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('Unknown error → 500 INTERNAL_ERROR', async () => {
    const res = await request(app).get('/throw/unknown');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });
});
