const asyncHandler = require('../utils/asyncHandler');
const uploadService = require('../services/upload.service');

const presignProductFile = asyncHandler(async (req, res) => {
  const out = await uploadService.presignProductFile({
    creatorId: req.user._id,
    ...req.body,
  });
  res.json(out);
});

const confirmProductFile = asyncHandler(async (req, res) => {
  const product = await uploadService.confirmProductFile({
    user: req.user,
    ...req.body,
  });
  res.json({ product });
});

const presignImage = asyncHandler(async (req, res) => {
  const out = await uploadService.presignImage({
    user: req.user,
    ...req.body,
  });
  res.json(out);
});

const confirmImage = asyncHandler(async (req, res) => {
  const out = await uploadService.confirmImage({
    user: req.user,
    ...req.body,
  });
  res.json(out);
});

const uploadImageDirect = asyncHandler(async (req, res) => {
  if (!req.file) throw require('../utils/AppError').badRequest('No file provided', 'NO_FILE');
  const out = await uploadService.uploadImageDirect({
    user: req.user,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    kind: req.body.kind,
    refId: req.body.refId || undefined,
    role: req.body.role || undefined,
  });
  res.status(201).json(out);
});

const uploadProductFileDirect = asyncHandler(async (req, res) => {
  if (!req.file) throw require('../utils/AppError').badRequest('No file provided', 'NO_FILE');
  const out = await uploadService.uploadProductFileDirect({
    user: req.user,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    productId: req.body.productId || undefined,
  });
  res.status(201).json(out);
});

module.exports = {
  presignProductFile,
  confirmProductFile,
  presignImage,
  confirmImage,
  uploadImageDirect,
  uploadProductFileDirect,
};
