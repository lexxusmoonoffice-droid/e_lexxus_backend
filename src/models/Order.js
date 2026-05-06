const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');

const { Schema } = mongoose;

const orderItemSchema = new Schema(
  {
    type: { type: String, enum: ['product', 'bundle'], required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    bundle: { type: Schema.Types.ObjectId, ref: 'Bundle' },
    qty: { type: Number, default: 1, min: 1 },
    priceAtPurchase: { type: Number, required: true, min: 0 },
    title: String,
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: {
      type: [orderItemSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'Order must have at least one item'],
    },
    creators: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'cancelled'],
      default: 'pending',
      index: true,
    },
    payment: {
      zohoPaymentId: { type: String, index: true },
      zohoOrderId: { type: String, index: true },
      method: String,
      paidAt: Date,
      refundedAt: Date,
    },
    billing: {
      name: String,
      email: String,
      country: String,
    },
    downloadToken: { type: String, unique: true, sparse: true, index: true },
    downloadCount: { type: Number, default: 0, min: 0 },
    downloadLimit: { type: Number, default: 5, min: 1 },
    tokenExpiresAt: Date,
    notes: String,
    ipAtCheckout: String,
    userAgentAtCheckout: String,
  },
  { timestamps: true },
);

orderSchema.plugin(toJSON);
orderSchema.plugin(paginate);

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
