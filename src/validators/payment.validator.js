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
  // Optional provider override — admin/testing only; defaults to appConfig
  provider: z.enum(['zoho', 'stripe', 'razorpay']).optional(),
  // Currency the customer selected (INR or USD). Defaults to INR if omitted.
  currency: z.enum(['INR', 'USD']).optional(),
});

const orderIdParam = z.object({ id: objectId });

const verifyRazorpaySchema = z.object({
  razorpayOrderId:   z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  orderId:           objectId,  // Lexxus Order._id
});

module.exports = { createOrderSchema, orderIdParam, verifyRazorpaySchema };
