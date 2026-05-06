const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const { Schema } = mongoose;

const wishlistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    bundleIds: [{ type: Schema.Types.ObjectId, ref: 'Bundle' }],
  },
  { timestamps: true },
);

wishlistSchema.plugin(toJSON);

module.exports = mongoose.model('Wishlist', wishlistSchema);
