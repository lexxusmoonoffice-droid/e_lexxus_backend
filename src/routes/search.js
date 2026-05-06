const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const cacheControl = require('../middleware/cacheControl');
const { searchQuerySchema } = require('../validators/public.validator');
const { globalSearch } = require('../services/search.service');

const router = express.Router();

router.get(
  '/',
  cacheControl(60),
  validate(searchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await globalSearch(req.query.q, req.query.limit));
  }),
);

module.exports = router;
