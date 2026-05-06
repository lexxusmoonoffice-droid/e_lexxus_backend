const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/auth.controller');
const v = require('../validators/auth.validator');

const router = express.Router();

router.post('/register', authLimiter, validate(v.registerSchema), ctrl.register);
router.post('/login', authLimiter, validate(v.loginSchema), ctrl.login);
router.post('/refresh', authLimiter, ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/me', requireAuth, ctrl.me);

router.post('/verify-email', validate(v.verifyEmailSchema), ctrl.verifyEmail);
router.post('/resend-verification', requireAuth, ctrl.resendVerification);

router.post('/forgot-password', authLimiter, validate(v.forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validate(v.resetPasswordSchema), ctrl.resetPassword);
router.put(
  '/change-password',
  requireAuth,
  validate(v.changePasswordSchema),
  ctrl.changePassword,
);

// OTP login
router.post('/send-otp', authLimiter, ctrl.sendOtp);
router.post('/verify-otp', authLimiter, ctrl.verifyOtp);

// Google OAuth — browser navigates directly to these (not XHR)
router.get('/google', ctrl.googleRedirect);
router.get('/google/callback', ctrl.googleCallback);

module.exports = router;
