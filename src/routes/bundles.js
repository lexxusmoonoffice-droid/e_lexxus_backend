const express = require('express');
const validate = require('../middleware/validate');
const cacheControl = require('../middleware/cacheControl');
const ctrl = require('../controllers/bundle.controller');
const { listQuerySchema, slugParamSchema } = require('../validators/public.validator');

const router = express.Router();

router.get('/', cacheControl(300), validate(listQuerySchema, 'query'), ctrl.list);
router.get('/:slug', cacheControl(300), validate(slugParamSchema, 'params'), ctrl.detail);

module.exports = router;
