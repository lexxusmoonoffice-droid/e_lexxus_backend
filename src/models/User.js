const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    passwordHash: { type: String, select: false },
    googleId: { type: String, sparse: true, unique: true, select: false },
    role: {
      type: String,
      enum: ['buyer', 'creator', 'admin'],
      default: 'buyer',
      index: true,
    },
    verified: { type: Boolean, default: false },
    avatar: String,
    bio: { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    payoutInfo: {
      accountNumber: String,
      ifsc: String,
      upiId: String,
    },
    totalEarnings: { type: Number, default: 0, min: 0 },
    lastLoginAt: Date,
    // Email verification + password reset — only the SHA-256 hash is stored.
    emailVerifyTokenHash: { type: String, select: false },
    emailVerifyTokenExpiresAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetTokenExpiresAt: { type: Date, select: false },
    // OTP login
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.plugin(toJSON);
userSchema.plugin(paginate);

userSchema.virtual('initials').get(function initials() {
  return (this.name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
});

module.exports = mongoose.model('User', userSchema);
