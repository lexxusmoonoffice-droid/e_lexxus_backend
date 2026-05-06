/**
 * Mounts `/api/docs` (Swagger UI) and `/api/docs/openapi.json`.
 * In production, gated behind `?key=<DOCS_KEY>` if `DOCS_KEY` is set.
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const env = require('../config/env');
const spec = require('../docs/openapi');

const router = express.Router();

function gate(req, res, next) {
  if (!env.isProd) return next();
  const expected = process.env.DOCS_KEY;
  if (!expected) return next(); // docs open if no key configured
  if (req.query.key === expected) return next();
  return res.status(401).json({ error: 'Docs locked', code: 'DOCS_LOCKED' });
}

router.get('/openapi.json', gate, (req, res) => res.json(spec));
router.use('/', gate, swaggerUi.serveFiles(spec), swaggerUi.setup(spec, {
  customSiteTitle: 'Lexxus API docs',
  swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
}));

module.exports = router;
