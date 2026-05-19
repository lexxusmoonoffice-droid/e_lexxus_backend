const express = require('express');
const validate = require('../middleware/validate');
const cacheControl = require('../middleware/cacheControl');
const ctrl = require('../controllers/category.controller');
const { slugParamSchema } = require('../validators/public.validator');

const router = express.Router();

router.get('/', cacheControl(60), ctrl.tree);
router.get('/tree-with-previews', cacheControl(60), ctrl.treeWithPreviews);
router.get('/:slug', cacheControl(300), validate(slugParamSchema, 'params'), ctrl.detail);

module.exports = router;
