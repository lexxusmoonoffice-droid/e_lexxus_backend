const AppError = require('../../src/utils/AppError');

describe('AppError', () => {
  it('defaults to 500 / INTERNAL_ERROR', () => {
    const err = new AppError('boom');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes named factories', () => {
    expect(AppError.badRequest('x').statusCode).toBe(400);
    expect(AppError.unauthorized().statusCode).toBe(401);
    expect(AppError.forbidden().statusCode).toBe(403);
    expect(AppError.notFound().statusCode).toBe(404);
    expect(AppError.conflict('dup').statusCode).toBe(409);
    expect(AppError.unprocessable('bad', 'X', { a: 1 }).details).toEqual({ a: 1 });
    expect(AppError.tooMany().statusCode).toBe(429);
  });

  it('carries optional details', () => {
    const err = AppError.badRequest('x', 'BAD', { field: 'email' });
    expect(err.details).toEqual({ field: 'email' });
  });
});
