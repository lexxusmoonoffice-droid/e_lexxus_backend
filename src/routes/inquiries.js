const express = require('express');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/inquiry.controller');
const v = require('../validators/inquiry.validator');

const router = express.Router();

// Public route for form submission
router.post('/', validate(v.inquiryCreate), ctrl.createInquiry);

module.exports = router;
