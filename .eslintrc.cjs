module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['airbnb-base', 'plugin:jest/recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  plugins: ['jest'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-underscore-dangle': ['error', { allow: ['_id', '__v'] }],
    'no-use-before-define': ['error', { functions: false, classes: true }],
    'consistent-return': 'off',
    'class-methods-use-this': 'off',
    'import/no-extraneous-dependencies': [
      'error',
      { devDependencies: ['tests/**', 'scripts/**', '**/*.test.js'] },
    ],
    'max-len': ['warn', { code: 100, ignoreUrls: true, ignoreStrings: true }],
    'object-curly-newline': 'off',
    'arrow-body-style': 'off',
    camelcase: ['error', { properties: 'never' }],
  },
};
