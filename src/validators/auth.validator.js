const { z } = require('zod');

const email = z.string().trim().toLowerCase().email('Invalid email');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');
const name = z.string().trim().min(1).max(120);

const registerSchema = z.object({ name, email, password });

const loginSchema = z.object({ email, password });

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: password,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

const updateProfileSchema = z.object({
  name: name.optional(),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
};
