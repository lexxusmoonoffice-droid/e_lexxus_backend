#!/usr/bin/env node
/**
 * Post-deploy smoke test. Hits the critical read endpoints and
 * verifies they return 2xx with the expected shape. Exit 0 if all
 * pass, 1 otherwise — perfect for a CI "verify after promote" step.
 *
 *   npm run smoke
 *   API_URL=https://api.lexxus.com/api npm run smoke
 */

/* eslint-disable no-console */
const BASE = process.env.API_URL || 'http://localhost:5050/api';

const checks = [
  {
    name: 'GET /health',
    path: '/health',
    assert: (r, j) => r.status === 200 && j.status === 'ok' && j.db !== undefined,
  },
  {
    name: 'GET /ready',
    path: '/ready',
    // 200 when DB is up, 503 otherwise. Both are "the service is reachable".
    assert: (r) => r.status === 200 || r.status === 503,
  },
  {
    name: 'GET /products (list)',
    path: '/products?limit=1',
    assert: (r, j) => r.status === 200 && Array.isArray(j.data) && typeof j.total === 'number',
  },
  {
    name: 'GET /categories',
    path: '/categories',
    assert: (r, j) => r.status === 200 && Array.isArray(j.data),
  },
  {
    name: 'GET /bundles',
    path: '/bundles?limit=1',
    assert: (r, j) => r.status === 200 && Array.isArray(j.data),
  },
  {
    name: 'GET /hero-slides',
    path: '/hero-slides',
    assert: (r, j) => r.status === 200 && Array.isArray(j.data),
  },
  {
    name: 'GET /settings/public',
    path: '/settings/public',
    assert: (r, j) => r.status === 200 && typeof j.storeName === 'string',
  },
  {
    name: 'GET /currency/rates',
    path: '/currency/rates',
    assert: (r, j) => r.status === 200 && typeof j.rates === 'object',
  },
  {
    name: 'GET /docs/openapi.json',
    path: '/docs/openapi.json',
    assert: (r, j) => r.status === 200 && j.openapi && Array.isArray(j.tags),
  },
];

async function run() {
  let failed = 0;
  for (const c of checks) {
    const url = `${BASE}${c.path}`;
    let res, json, ok = false;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
      json = await res.json().catch(() => ({}));
      ok = c.assert(res, json);
    } catch (err) {
      ok = false;
      json = { error: err.message };
    }
    if (ok) {
      console.log(`✓ ${c.name}`);
    } else {
      failed += 1;
      console.log(`✗ ${c.name}  [${res?.status}]`, JSON.stringify(json).slice(0, 160));
    }
  }
  console.log(`\n${failed === 0 ? 'All good.' : `${failed} failure(s).`}`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
