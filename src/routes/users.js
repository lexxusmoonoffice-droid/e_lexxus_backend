const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');
const v = require('../validators/user.validator');
const authV = require('../validators/auth.validator');

const router = express.Router();

router.use(requireAuth);

router.get('/me', ctrl.me);
router.put('/me', validate(v.updateProfileSchema), ctrl.update);
router.delete('/me', ctrl.remove);
router.get('/me/export', ctrl.exportData);
router.put('/me/password', validate(authV.changePasswordSchema), ctrl.changePassword);

module.exports = router;
