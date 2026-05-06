const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');
const { toSlug } = require('../utils/slug');

const { Schema } = mongoose;

const blogPostSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 250 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    excerpt: { type: String, maxlength: 500 },
    content: String,
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: String,
    image: String,
    tags: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: Date,
    viewCount: { type: Number, default: 0, min: 0 },
    seo: {
      title: String,
      description: String,
      ogImage: String,
    },
  },
  { timestamps: true },
);

blogPostSchema.plugin(toJSON);
blogPostSchema.plugin(paginate);

blogPostSchema.pre('validate', function preValidate(next) {
  if (!this.slug && this.title) this.slug = toSlug(this.title);
  if (!this.publishedAt && this.status === 'published') this.publishedAt = new Date();
  next();
});

module.exports = mongoose.model('BlogPost', blogPostSchema);
