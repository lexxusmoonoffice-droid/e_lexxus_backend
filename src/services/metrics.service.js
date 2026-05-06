/**
 * Prometheus metrics. Call `middleware()` once in the Express chain
 * and `registerRoute(app)` to expose `/metrics`.
 *
 *   - http_requests_total{method,route,status}
 *   - http_request_duration_seconds{method,route,status}
 *   - plus default Node process metrics from prom-client.
 */

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const requestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const requestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  registers: [register],
});

function middleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      // Use the matched route pattern when available to avoid a
      // `/products/abc123` blowing up cardinality.
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : req.path;
      const labels = {
        method: req.method,
        route: route || 'unknown',
        status: String(res.statusCode),
      };
      requestsTotal.inc(labels);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      requestDuration.observe(labels, seconds);
    });
    next();
  };
}

function registerRoute(app) {
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
}

function _reset() {
  register.resetMetrics();
}

module.exports = { middleware, registerRoute, _reset, register };
