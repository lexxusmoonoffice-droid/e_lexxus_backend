const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');
const { toSlug } = require('../utils/slug');

const { Schema } = mongoose;

const fileSchema = new Schema(
  {
    b2FileId: String,
    b2FileName: String,
    cdnUrl: String,
    originalName: String,
    sizeBytes: Number,
    mimeType: String,
    checksum: String,
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    description: { type: String, required: true },
    brand: { type: Schema.Types.ObjectId, ref: 'Brand', index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subCategory: { type: Schema.Types.ObjectId, ref: 'Category' },
    tags: { type: [String], index: true, default: [] },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    isFree: { type: Boolean, default: false },
    attributes: {
      material: String,
      style: String,
      color: String,
      dimensions: { w: Number, l: Number, h: Number },
    },
    fileSizeMb: Number,
    formats: { type: [String], default: [] },
    file: { type: fileSchema, default: () => ({}) },
    thumbnail: String,
    hoverImage: String,
    images: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['draft', 'review', 'published', 'removed'],
      default: 'draft',
      index: true,
    },
    publishedAt: Date,
    views: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    downloadCount: { type: Number, default: 0, min: 0 },
    rating: {
      avg: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    seo: {
      title: String,
      description: String,
      ogImage: String,
    },
  },
  { timestamps: true },
);

productSchema.plugin(toJSON);
productSchema.plugin(paginate);

productSchema.index({ title: 'text', description: 'text', tags: 'text' });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ brand: 1, status: 1 });
productSchema.index({ status: 1, downloadCount: -1 });

productSchema.pre('validate', function preValidate(next) {
  if (!this.slug && this.title) this.slug = toSlug(this.title);
  if (this.price === 0) this.isFree = true;
  if (!this.publishedAt && this.status === 'published') this.publishedAt = new Date();
  next();
});

module.exports = mongoose.model('Product', productSchema);
