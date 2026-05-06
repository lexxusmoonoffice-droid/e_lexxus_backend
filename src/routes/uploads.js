const express = require('express');
const multer = require('multer');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/upload.controller');
const v = require('../validators/upload.validator');
const fileVal = require('../utils/fileValidation');

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileVal.MAX_IMAGE_BYTES },
});
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileVal.MAX_ZIP_BYTES },
});

router.use(requireAuth);

// Product ZIP file — only creators or admins
router.post(
  '/product-file/presign',
  requireRole('creator', 'admin'),
  validate(v.productFilePresignSchema),
  ctrl.presignProductFile,
);
router.post(
  '/product-file/confirm',
  requireRole('creator', 'admin'),
  validate(v.productFileConfirmSchema),
  ctrl.confirmProductFile,
);
// Direct (proxy) ZIP upload — server handles the B2 PUT. Used when the
// browser cannot reach B2 directly (CORS not configured / local dev).
router.post(
  '/product-file',
  requireRole('creator', 'admin'),
  zipUpload.single('file'),
  ctrl.uploadProductFileDirect,
);

// Images — any authenticated user can presign their own avatar; the
// confirm step decides which entity it gets attached to.
router.post('/image/presign', validate(v.imagePresignSchema), ctrl.presignImage);
router.post('/image/confirm', validate(v.imageConfirmSchema), ctrl.confirmImage);
router.post('/image', imageUpload.single('file'), ctrl.uploadImageDirect);

module.exports = router;
