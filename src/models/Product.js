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
    description: { type: String, default: '' },
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
      default: 'published',
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

// ── productCount denormalization ──────────────────────────────────────────────

productSchema.pre('save', async function trackCategoryChange() {
  this._wasNew = this.isNew;
  if (!this.isNew && this.isModified('category')) {
    const prev = await mongoose.model('Product').findById(this._id).select('category').lean();
    this._prevCategory = prev?.category ?? null;
  }
});

productSchema.post('save', async function syncCountOnSave() {
  const Category = mongoose.model('Category');
  if (this._wasNew) {
    if (this.category) await Category.updateOne({ _id: this.category }, { $inc: { productCount: 1 } });
  } else if (this._prevCategory !== undefined) {
    const oldId = this._prevCategory?.toString();
    const newId = this.category?.toString();
    if (oldId !== newId) {
      if (oldId) await Category.updateOne({ _id: oldId }, { $inc: { productCount: -1 } });
      if (newId) await Category.updateOne({ _id: newId }, { $inc: { productCount: 1 } });
    }
  }
});

productSchema.post('findOneAndDelete', async function syncCountOnDelete(doc) {
  if (doc?.category) {
    await mongoose.model('Category').updateOne({ _id: doc.category }, { $inc: { productCount: -1 } });
  }
});

productSchema.pre('deleteMany', async function captureDeletedCategories() {
  const docs = await mongoose.model('Product').find(this.getFilter()).select('category').lean();
  this._deletedCategories = docs.map((d) => d.category).filter(Boolean);
});

productSchema.post('deleteMany', async function syncCountOnBulkDelete() {
  if (!this._deletedCategories?.length) return;
  const Category = mongoose.model('Category');
  const counts = {};
  for (const catId of this._deletedCategories) {
    const k = catId.toString();
    counts[k] = (counts[k] || 0) + 1;
  }
  await Promise.all(
    Object.entries(counts).map(([id, n]) =>
      Category.updateOne({ _id: id }, { $inc: { productCount: -n } }),
    ),
  );
});

module.exports = mongoose.model('Product', productSchema);
