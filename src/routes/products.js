const express = require('express');
const validate = require('../middleware/validate');
const cacheControl = require('../middleware/cacheControl');
const ctrl = require('../controllers/product.controller');
const reviewCtrl = require('../controllers/review.controller');
const { productListQuerySchema, slugParamSchema } = require('../validators/public.validator');

const router = express.Router();

// IMPORTANT: register named routes BEFORE the /:slug catch-all.
router.get('/featured', cacheControl(60), ctrl.featured);
router.get('/trending', cacheControl(60), ctrl.trending);
router.get('/new-arrivals', cacheControl(60), ctrl.newArrivals);
router.get('/', cacheControl(60), validate(productListQuerySchema, 'query'), ctrl.list);
router.get(
  '/:slug/reviews',
  cacheControl(60),
  validate(slugParamSchema, 'params'),
  reviewCtrl.listForProduct,
);
router.get('/:slug', cacheControl(300), validate(slugParamSchema, 'params'), ctrl.detail);

module.exports = router;
