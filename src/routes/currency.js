const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const cacheControl = require('../middleware/cacheControl');
const { getRates } = require('../services/currency.service');

const router = express.Router();

router.get(
  '/rates',
  cacheControl(86_400, { swr: 86_400 }),
  asyncHandler(async (req, res) => {
    res.json(await getRates());
  }),
);

module.exports = router;
