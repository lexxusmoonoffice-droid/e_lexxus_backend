const { z } = require('zod');
const mongoose = require('mongoose');

const objectId = z
  .string()
  .refine((s) => mongoose.isValidObjectId(s), { message: 'Invalid id' });

const cartItemTypeParam = z.object({
  type: z.enum(['product', 'bundle']),
  id: objectId,
});

const cartAddSchema = z
  .object({
    productId: objectId.optional(),
    bundleId: objectId.optional(),
    qty: z.coerce.number().int().min(1).max(99).default(1),
  })
  .refine((v) => !!v.productId !== !!v.bundleId, {
    message: 'Provide exactly one of productId or bundleId',
  });

const cartUpdateSchema = z.object({
  qty: z.coerce.number().int().min(1).max(99),
});

const cartMergeSchema = z.object({
  items: z
    .array(
      z
        .object({
          productId: objectId.optional(),
          bundleId: objectId.optional(),
          qty: z.coerce.number().int().min(1).max(99).default(1),
        })
        .refine((v) => !!v.productId !== !!v.bundleId, {
          message: 'Each item needs exactly one of productId or bundleId',
        }),
    )
    .max(100),
});

const wishlistAddSchema = z
  .object({
    productId: objectId.optional(),
    bundleId: objectId.optional(),
  })
  .refine((v) => !!v.productId !== !!v.bundleId, {
    message: 'Provide exactly one of productId or bundleId',
  });

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
});

const reviewCreateSchema = z.object({
  productId: objectId,
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const reviewUpdateSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
});

const idParamSchema = z.object({ id: objectId });

const slugParamSchema = z.object({ slug: z.string().min(1) });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
});

module.exports = {
  cartItemTypeParam,
  cartAddSchema,
  cartUpdateSchema,
  cartMergeSchema,
  wishlistAddSchema,
  updateProfileSchema,
  reviewCreateSchema,
  reviewUpdateSchema,
  idParamSchema,
  slugParamSchema,
  listQuerySchema,
};
