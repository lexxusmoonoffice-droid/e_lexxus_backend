const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/review.controller');
const v = require('../validators/user.validator');

const router = express.Router();

// Auth-required CRUD (mounted at /api/reviews)
router.get('/mine', requireAuth, ctrl.listMine);
router.post('/', requireAuth, validate(v.reviewCreateSchema), ctrl.create);
router.put('/:id', requireAuth, validate(v.idParamSchema, 'params'), validate(v.reviewUpdateSchema), ctrl.update);
router.delete('/:id', requireAuth, validate(v.idParamSchema, 'params'), ctrl.remove);

module.exports = router;
