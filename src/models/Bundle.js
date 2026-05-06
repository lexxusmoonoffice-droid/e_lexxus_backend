const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');
const { toSlug } = require('../utils/slug');

const { Schema } = mongoose;

const bundleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    tag: String,
    badge: String,
    description: String,
    image: String,
    images: { type: [String], default: [] },
    productIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'Bundle must include at least one product'],
    },
    bundlePrice: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: 0 },
    savingsPct: { type: Number, default: 0 },
    modelCount: { type: Number, default: 0 },
    fileSizeMb: Number,
    formats: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['draft', 'published', 'removed'],
      default: 'draft',
      index: true,
    },
    publishedAt: Date,
  },
  { timestamps: true },
);

bundleSchema.plugin(toJSON);
bundleSchema.plugin(paginate);

bundleSchema.pre('validate', function preValidate(next) {
  if (!this.slug && this.name) this.slug = toSlug(this.name);
  this.modelCount = (this.productIds || []).length;
  if (this.originalPrice && this.originalPrice > 0 && this.bundlePrice >= 0) {
    const pct = ((this.originalPrice - this.bundlePrice) / this.originalPrice) * 100;
    this.savingsPct = Math.max(0, Math.round(pct));
  }
  if (!this.publishedAt && this.status === 'published') this.publishedAt = new Date();
  next();
});

module.exports = mongoose.model('Bundle', bundleSchema);
