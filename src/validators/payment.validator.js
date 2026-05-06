const { z } = require('zod');
const mongoose = require('mongoose');

const objectId = z
  .string()
  .refine((s) => mongoose.isValidObjectId(s), { message: 'Invalid id' });

const createOrderSchema = z.object({
  billing: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().optional(),
    country: z.string().trim().min(2).max(2),
  }),
});

const orderIdParam = z.object({ id: objectId });

module.exports = { createOrderSchema, orderIdParam };
