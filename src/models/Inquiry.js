const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');

const { Schema } = mongoose;

const inquirySchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    topic: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['unread', 'read'], default: 'unread', index: true },
  },
  { timestamps: true },
);

inquirySchema.plugin(toJSON);
inquirySchema.plugin(paginate);

inquirySchema.index({ createdAt: -1, status: 1 });

module.exports = mongoose.model('Inquiry', inquirySchema);
