const { z } = require('zod');

const inquiryCreate = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(200),
  topic: z.string().trim().min(1, 'Topic is required').max(100),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  message: z.string().trim().min(1, 'Message is required').max(5000),
});

module.exports = {
  inquiryCreate,
};
