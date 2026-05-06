const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/wishlist.controller');
const v = require('../validators/user.validator');

const router = express.Router();

router.use(requireAuth);

router.get('/', ctrl.get);
router.post('/', validate(v.wishlistAddSchema), ctrl.add);
router.delete('/:type/:id', validate(v.cartItemTypeParam, 'params'), ctrl.remove);

module.exports = router;
