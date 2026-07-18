const asyncHandler = require('../utils/asyncHandler');
const { Inquiry } = require('../models');

const createInquiry = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, topic, subject, message } = req.body;

  const inquiry = await Inquiry.create({
    firstName,
    lastName,
    email,
    topic,
    subject,
    message,
  });

  res.status(201).json({ inquiry });
});

module.exports = { createInquiry };
