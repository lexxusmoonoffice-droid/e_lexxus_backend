const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');
const { toSlug } = require('../utils/slug');

const { Schema } = mongoose;

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    logo: String,
    hero: String,
    description: String,
    country: String,
    status: { type: String, enum: ['active', 'hidden'], default: 'active' },
  },
  { timestamps: true },
);

brandSchema.plugin(toJSON);
brandSchema.plugin(paginate);

brandSchema.pre('validate', function preValidate(next) {
  if (!this.slug && this.name) this.slug = toSlug(this.name);
  next();
});

module.exports = mongoose.model('Brand', brandSchema);
