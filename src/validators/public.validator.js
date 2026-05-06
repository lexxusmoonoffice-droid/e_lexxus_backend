/**
 * Shared zod schemas for public-storefront query strings.
 */
const { z } = require('zod');

const positiveInt = z.coerce.number().int().positive();

const listQuerySchema = z
  .object({
    page: positiveInt.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    sort: z.string().optional(),
    q: z.string().trim().optional(),
  })
  .passthrough();

const productListQuerySchema = listQuerySchema.extend({
  category: z.string().optional(),
  subCategory: z.string().optional(),
  brand: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  free: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === 'true' || v === '1')),
});

const slugParamSchema = z.object({
  slug: z.string().min(1),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'q must be at least 2 chars'),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

module.exports = {
  listQuerySchema,
  productListQuerySchema,
  slugParamSchema,
  searchQuerySchema,
};
