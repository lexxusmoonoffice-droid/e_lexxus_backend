/**
 * Settings — singleton document. Accessed via Settings.getSettings().
 */
const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON');

const { Schema } = mongoose;

const settingsSchema = new Schema(
  {
    storeName: { type: String, default: 'Lexxus' },
    supportEmail: String,
    defaultCurrency: { type: String, default: 'INR' },
    payments: {
      zohoEnabled: { type: Boolean, default: true },
      stripeEnabled: { type: Boolean, default: false },
      paypalEnabled: { type: Boolean, default: false },
    },
    social: {
      twitter: String,
      instagram: String,
      youtube: String,
      linkedin: String,
      facebook: String,
    },
    seo: {
      siteTitle: String,
      siteDescription: String,
      ogImage: String,
    },
    legal: {
      privacyUrl: String,
      termsUrl: String,
      refundUrl: String,
    },
    integrations: {
      zoho: {
        clientId: { type: String },
        clientSecret: { type: String, select: false },
        refreshToken: { type: String, select: false },
        webhookSecret: { type: String, select: false },
        signingKey: { type: String, select: false },  // Developer Space → Authentication Keys
        apiKey: { type: String },                      // Frontend checkout widget key
        accountId: { type: String },                   // Zoho Payments merchant account ID
        apiBase: { type: String },
        accountsHost: { type: String, default: 'https://accounts.zoho.in' },
        scope: { type: String },
        connectedAt: Date,
        connectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      },
      b2: {
        keyId: { type: String },
        appKey: { type: String, select: false },
        bucketName: { type: String },
        region: { type: String },
        endpoint: { type: String },
        endpointHost: { type: String },
        cdnDomain: { type: String },
      },
      cloudflare: {
        accountId: { type: String },
        apiToken: { type: String, select: false },
      },
      smtp: {
        host: { type: String },
        port: { type: Number },
        secure: { type: Boolean },
        user: { type: String },
        pass: { type: String, select: false },
        mailFrom: { type: String },
      },
    },
    limits: {
      downloadTokenTtlDays: { type: Number },
      downloadLimitPerOrder: { type: Number },
      downloadRateLimitPerHour: { type: Number },
      globalRateLimitPer15Min: { type: Number },
    },
    observability: {
      sentryDsn: { type: String, select: false },
    },
  },
  { timestamps: true },
);

settingsSchema.plugin(toJSON);

settingsSchema.statics.getSettings = async function getSettings() {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
