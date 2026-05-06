const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/notification.controller');
const v = require('../validators/user.validator');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate(v.listQuerySchema, 'query'), ctrl.list);
router.patch('/read-all', ctrl.readAll);
router.patch('/:id/read', validate(v.idParamSchema, 'params'), ctrl.read);

module.exports = router;
