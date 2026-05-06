const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const { Schema } = mongoose;

const heroSlideSchema = new Schema(
  {
    order: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
    img: { type: String, required: true },
    tag: String,
    title: {
      type: [String],
      validate: [(v) => Array.isArray(v) && v.length === 2, 'title must have exactly 2 lines'],
    },
    sub: String,
    cta: String,
    href: String,
    accent: String,
  },
  { timestamps: true },
);

heroSlideSchema.plugin(toJSON);

module.exports = mongoose.model('HeroSlide', heroSlideSchema);
