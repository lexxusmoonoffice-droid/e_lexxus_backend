const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { SocialLink } = require('../models');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const links = await SocialLink.find({ active: true }).sort('order platform');
    res.json({ links });
  })
);

module.exports = router;
