const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const socialLinkSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

socialLinkSchema.plugin(toJSON);

module.exports = mongoose.model('SocialLink', socialLinkSchema);
