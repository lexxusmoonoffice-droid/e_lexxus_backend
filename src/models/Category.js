const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');
const { toSlug } = require('../utils/slug');

const { Schema } = mongoose;

const bannerSchema = new Schema({
  img: { type: String, required: true },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  href: { type: String, default: '' },
});

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    image: String,
    order: { type: Number, default: 0 },
    productCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'hidden'], default: 'active' },
    banners: { type: [bannerSchema], default: [] },
  },
  { timestamps: true },
);

categorySchema.plugin(toJSON);
categorySchema.plugin(paginate);

categorySchema.pre('validate', function preValidate(next) {
  if (!this.slug && this.name) this.slug = toSlug(this.name);
  next();
});

module.exports = mongoose.model('Category', categorySchema);
