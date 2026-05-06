const AppError = require('../utils/AppError');
const { Notification } = require('../models');

async function listMine(userId, query = {}) {
  const filter = { user: userId };
  if (query.status === 'unread') filter.read = false;
  if (query.status === 'read') filter.read = true;
  return Notification.paginate(filter, {
    page: query.page,
    limit: query.limit,
    sort: '-createdAt',
  });
}

async function markRead(userId, id) {
  const n = await Notification.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: { read: true } },
    { new: true },
  );
  if (!n) throw AppError.notFound('Notification not found');
  return n;
}

async function markAllRead(userId) {
  const r = await Notification.updateMany(
    { user: userId, read: false },
    { $set: { read: true } },
  );
  return { updated: r.modifiedCount };
}

/** Helper used by other services to enqueue an in-app notification. */
async function notify(userId, { type, title, body, link }) {
  return Notification.create({ user: userId, type, title, body, link });
}

module.exports = { listMine, markRead, markAllRead, notify };
