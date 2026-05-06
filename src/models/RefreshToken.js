const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    tokenHash: { type: String, required: true, select: false },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL
    revokedAt: Date,
    userAgent: String,
    ip: String,
    replacedBy: String,
  },
  { timestamps: true },
);

refreshTokenSchema.plugin(toJSON);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
