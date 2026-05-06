const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');
const paginate = require('./plugins/paginate');

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: String,
    body: String,
    link: String,
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

notificationSchema.plugin(toJSON);
notificationSchema.plugin(paginate);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
