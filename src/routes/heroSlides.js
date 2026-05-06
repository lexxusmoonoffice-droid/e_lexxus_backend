const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const cacheControl = require('../middleware/cacheControl');
const cache = require('../services/cache.service');
const { HeroSlide } = require('../models');

const router = express.Router();

router.get(
  '/',
  cacheControl(3600),
  asyncHandler(async (req, res) => {
    const slides = await cache.wrap(
      'active',
      3600,
      async () => HeroSlide.find({ active: true }).sort('order createdAt'),
      { tag: 'hero-slides' },
    );
    res.json({ data: slides });
  }),
);

module.exports = router;
