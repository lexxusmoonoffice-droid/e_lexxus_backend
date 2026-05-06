const { z } = require('zod');
const mongoose = require('mongoose');

const objectId = z
  .string()
  .refine((s) => mongoose.isValidObjectId(s), { message: 'Invalid id' });

const filename = z.string().min(1).max(260);
const mimeType = z.string().min(1).max(120);
const size = z.coerce.number().int().positive();

const productFilePresignSchema = z.object({ filename, mimeType, size });

const productFileConfirmSchema = z.object({
  fileKey: z.string().min(1),
  productId: objectId,
});

const imagePresignSchema = z.object({
  filename,
  mimeType,
  size,
  kind: z.enum(['product', 'bundle', 'blog', 'hero', 'avatar']),
});

const imageConfirmSchema = z.object({
  fileKey: z.string().min(1),
  kind: z.enum(['product', 'bundle', 'blog', 'hero', 'avatar']),
  refId: objectId.optional(),
  role: z.enum(['thumbnail', 'gallery']).optional(),
});

module.exports = {
  productFilePresignSchema,
  productFileConfirmSchema,
  imagePresignSchema,
  imageConfirmSchema,
};
