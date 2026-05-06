const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { downloadLimiter, resendLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/download.controller');

const router = express.Router();

router.use(requireAuth);

// List the user's unlocked items (no rate limit — read-only).
router.get('/', ctrl.list);

// View token info + product list — read-only, NO count decrement, no rate limit.
router.get('/:token', ctrl.info);

// Actually use a download slot — decrements count, returns signed URLs.
// Called only when the user explicitly clicks the Download button.
router.post('/:token/use', downloadLimiter, ctrl.use);

// Resend the download link by email — separate lenient limiter (5/hour).
router.post('/:token/resend', resendLimiter, ctrl.resend);

module.exports = router;
