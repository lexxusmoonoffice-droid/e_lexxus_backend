/**
 * User profile / GDPR helpers.
 */

const { User, Cart, Wishlist, Order, Review, Notification, RefreshToken } =
  require('../models');
const { issueVerifyToken } = require('./auth.service');
const { sendVerifyNewEmailEmail } = require('./email.service');

async function getMe(userId) {
  const user = await User.findById(userId);
  return user;
}

async function updateMe(userId, payload) {
  const allowed = {};
  if (payload.name !== undefined) allowed.name = payload.name;
  if (payload.bio !== undefined) allowed.bio = payload.bio;
  if (payload.avatar !== undefined) allowed.avatar = payload.avatar;

  let pendingEmailChange = null; // { user, newEmail, rawToken } — populated if email changed

  if (payload.email !== undefined) {
    const newEmail = String(payload.email).toLowerCase().trim();
    const current = await User.findById(userId).select('email');
    if (!current) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }
    if (newEmail !== current.email) {
      // Check the new address isn't already in use.
      const taken = await User.findOne({ email: newEmail, _id: { $ne: userId } })
        .select('_id')
        .lean();
      if (taken) {
        const err = new Error('Email already in use');
        err.status = 409;
        throw err;
      }
      // Stage the new address — don't touch `email` or `verified` yet.
      // We'll send a confirmation link to the new address; the switch
      // happens in auth.service verifyEmail() when the link is clicked.
      allowed.pendingEmail = newEmail;
      pendingEmailChange = { newEmail };
    }
  }

  await User.updateOne({ _id: userId }, { $set: allowed });

  // After saving, issue the verify token and send the confirmation email.
  if (pendingEmailChange) {
    const freshUser = await User.findById(userId).select('+pendingEmail');
    const rawToken = await issueVerifyToken(freshUser);
    await sendVerifyNewEmailEmail(freshUser, pendingEmailChange.newEmail, rawToken);
  }

  return getMe(userId);
}

/**
 * GDPR delete — wipes all rows for this user. We retain `Order` rows
 * (financial record) but anonymise the buyer + billing fields so the
 * data is no longer linked to the user.
 */
async function deleteMe(userId) {
  await Promise.all([
    Cart.deleteOne({ user: userId }),
    Wishlist.deleteOne({ user: userId }),
    Review.deleteMany({ user: userId }),
    Notification.deleteMany({ user: userId }),
    RefreshToken.deleteMany({ user: userId }),
    Order.updateMany(
      { buyer: userId },
      { $set: { 'billing.name': 'Deleted user', 'billing.email': 'deleted@local' } },
    ),
  ]);
  await User.deleteOne({ _id: userId });
}

/** GDPR export — bundles everything we have on the user into a single JSON. */
async function exportMe(userId) {
  const [user, cart, wishlist, orders, reviews, notifications] = await Promise.all([
    User.findById(userId),
    Cart.findOne({ user: userId }),
    Wishlist.findOne({ user: userId }),
    Order.find({ buyer: userId }),
    Review.find({ user: userId }),
    Notification.find({ user: userId }),
  ]);
  return { user, cart, wishlist, orders, reviews, notifications };
}

module.exports = { getMe, updateMe, deleteMe, exportMe };
