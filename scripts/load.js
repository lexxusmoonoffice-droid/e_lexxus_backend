#!/usr/bin/env node
/**
 * Load test for the public storefront API.
 * Runs a 30s @ 50-concurrency burst against the hot read paths and
 * prints percentile latencies.
 *
 *   npm run load                       # default port 5050
 *   API_URL=http://... npm run load
 *
 * Usage during Phase 14/15: run first to baseline, then after any
 * major change to spot regressions.
 */

/* eslint-disable no-console */
const autocannon = require('autocannon');

const BASE = process.env.API_URL || 'http://localhost:5050/api';
const DURATION = Number(process.env.DURATION || 30);
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);

const TARGETS = [
  { name: 'products list', path: '/products?limit=24' },
  { name: 'featured',      path: '/products/featured' },
  { name: 'trending',      path: '/products/trending' },
  { name: 'new arrivals',  path: '/products/new-arrivals' },
  { name: 'categories',    path: '/categories' },
  { name: 'brands',        path: '/brands' },
  { name: 'bundles',       path: '/bundles' },
  { name: 'hero slides',   path: '/hero-slides' },
  { name: 'health',        path: '/health' },
];

async function run() {
  for (const t of TARGETS) {
    const url = `${BASE}${t.path}`;
    // eslint-disable-next-line no-await-in-loop
    const result = await new Promise((resolve, reject) => {
      const inst = autocannon(
        { url, duration: DURATION, connections: CONNECTIONS, timeout: 10 },
        (err, r) => (err ? reject(err) : resolve(r)),
      );
      autocannon.track(inst, { renderProgressBar: false });
    });
    print(t.name, result);
  }
}

function print(name, r) {
  const req = r.requests;
  const lat = r.latency;
  console.log(`\n── ${name} (${r.url}) ──`);
  console.log(
    `   req/s  avg ${req.average.toFixed(0)}  · stddev ${req.stddev.toFixed(0)}  · total ${r.requests.total}`,
  );
  console.log(
    `   latency p50 ${lat.p50}ms · p95 ${lat.p97_5}ms · p99 ${lat.p99}ms · max ${lat.max}ms`,
  );
  const errors = (r['non2xx'] || 0) + (r.errors || 0) + (r.timeouts || 0);
  if (errors > 0) console.log(`   ⚠ ${errors} non-2xx / errors / timeouts`);
}

run().catch((err) => {
  console.error('load test failed:', err);
  process.exit(1);
});
