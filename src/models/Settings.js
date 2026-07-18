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
      zohoEnabled:     { type: Boolean, default: true },
      stripeEnabled:   { type: Boolean, default: false },
      razorpayEnabled: { type: Boolean, default: false },
      // Which provider handles checkout when multiple are enabled
      defaultProvider: { type: String, enum: ['zoho', 'stripe', 'razorpay'], default: 'zoho' },
    },
    social: {
      type: Map,
      of: String,
      default: {},
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
    contact: {
      email: { type: String, default: 'hello@lexxus.com' },
      phone: { type: String, default: '+1 (800) 123-4567' },
      address: { type: String, default: '340 Pine Street, New York, NY 10001' },
      hours: { type: String, default: 'Mon–Fri, 9am–6pm EST' },
      locationLabel: { type: String, default: 'New York, NY' },
      locationImage: { type: String, default: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=80' },
      responseTimes: {
        general: { type: String, default: '24–48 hrs' },
        technical: { type: String, default: '24 hrs' },
        billing: { type: String, default: '4–8 hrs' },
        partnerships: { type: String, default: '2–3 days' },
      },
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
      stripe: {
        secretKey:     { type: String, select: false }, // sk_live_... / sk_test_...
        webhookSecret: { type: String, select: false }, // whsec_...
        currency:      { type: String, default: 'inr' }, // ISO 4217 lowercase
      },
      razorpay: {
        keyId:         { type: String },                 // rzp_live_... (public — goes to frontend)
        keySecret:     { type: String, select: false },  // secret key
        webhookSecret: { type: String, select: false },  // webhook signing secret
        currency:      { type: String, default: 'INR' }, // ISO 4217 uppercase
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
