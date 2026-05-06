const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const { Schema } = mongoose;

const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    bundle: { type: Schema.Types.ObjectId, ref: 'Bundle' },
    qty: { type: Number, default: 1, min: 1 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

cartSchema.plugin(toJSON);

module.exports = mongoose.model('Cart', cartSchema);
