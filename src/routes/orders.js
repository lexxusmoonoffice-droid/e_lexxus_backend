const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/order.controller');
const v = require('../validators/user.validator');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate(v.listQuerySchema, 'query'), ctrl.list);
router.get('/:id', validate(v.idParamSchema, 'params'), ctrl.detail);

module.exports = router;
