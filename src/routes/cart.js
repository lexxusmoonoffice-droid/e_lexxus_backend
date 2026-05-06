const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/cart.controller');
const v = require('../validators/user.validator');

const router = express.Router();

router.use(requireAuth);

router.get('/', ctrl.get);
router.post('/items', validate(v.cartAddSchema), ctrl.add);
router.patch(
  '/items/:type/:id',
  validate(v.cartItemTypeParam, 'params'),
  validate(v.cartUpdateSchema),
  ctrl.update,
);
router.delete('/items/:type/:id', validate(v.cartItemTypeParam, 'params'), ctrl.remove);
router.delete('/', ctrl.clear);
router.post('/merge', validate(v.cartMergeSchema), ctrl.merge);

module.exports = router;
