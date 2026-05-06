/**
 * User profile / GDPR helpers.
 */

const { User, Cart, Wishlist, Order, Review, Notification, RefreshToken } =
  require('../models');

async function getMe(userId) {
  const user = await User.findById(userId);
  return user;
}

async function updateMe(userId, payload) {
  const allowed = {};
  if (payload.name !== undefined) allowed.name = payload.name;
  if (payload.bio !== undefined) allowed.bio = payload.bio;
  if (payload.avatar !== undefined) allowed.avatar = payload.avatar;
  await User.updateOne({ _id: userId }, { $set: allowed });
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
