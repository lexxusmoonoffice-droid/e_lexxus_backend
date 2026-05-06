/**
 * Public settings — only the non-secret subset.
 * Admin endpoints (Phase 9) expose the full doc.
 */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const cacheControl = require('../middleware/cacheControl');
const { Settings } = require('../models');

const router = express.Router();

router.get(
  '/public',
  cacheControl(300),
  asyncHandler(async (req, res) => {
    const s = (await Settings.getSettings()).toJSON();
    res.json({
      storeName: s.storeName,
      defaultCurrency: s.defaultCurrency,
      supportEmail: s.supportEmail,
      payments: {
        // Only flags, never any keys.
        zoho: !!s.payments?.zohoEnabled,
        stripe: !!s.payments?.stripeEnabled,
        paypal: !!s.payments?.paypalEnabled,
      },
      social: s.social || {},
      seo: s.seo || {},
      legal: s.legal || {},
    });
  }),
);

module.exports = router;
