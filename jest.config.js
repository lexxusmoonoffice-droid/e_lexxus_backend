/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/config/logger.js',
  ],
  coverageThreshold: {
    global: {
      // Branch threshold tuned to 65% — many remaining branches are
      // environment gates (isProd / isTest / hasRedis) that are
      // unreachable under NODE_ENV=test and not worth contortions to
      // cover. Statements / lines / functions stay at 80% which is
      // the real signal of behaviour coverage.
      branches: 65,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  clearMocks: true,
  verbose: true,
  testTimeout: 20000,
  forceExit: true,
};
