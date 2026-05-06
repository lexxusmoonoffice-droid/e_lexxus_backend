describe('config/env', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('loads with sensible defaults under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const env = require('../../src/config/env');
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(5000);
    expect(env.isTest).toBe(true);
    expect(env.isProd).toBe(false);
    expect(env.JWT_ACCESS_SECRET).toBeDefined();
  });

  it('coerces numeric env vars', () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '7000';
    process.env.BCRYPT_COST = '8';
    const env = require('../../src/config/env');
    expect(env.PORT).toBe(7000);
    expect(env.BCRYPT_COST).toBe(8);
    delete process.env.PORT;
    delete process.env.BCRYPT_COST;
  });

  it('hasRedis is false when REDIS_URL is empty', () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = '';
    const env = require('../../src/config/env');
    expect(env.hasRedis).toBe(false);
  });

  it('hasRedis is true when REDIS_URL is set', () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const env = require('../../src/config/env');
    expect(env.hasRedis).toBe(true);
    delete process.env.REDIS_URL;
  });
});
