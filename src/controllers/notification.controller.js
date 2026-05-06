const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');

const list = asyncHandler(async (req, res) => {
  res.json(await notificationService.listMine(req.user._id, req.query));
});

const read = asyncHandler(async (req, res) => {
  res.json({ notification: await notificationService.markRead(req.user._id, req.params.id) });
});

const readAll = asyncHandler(async (req, res) => {
  res.json(await notificationService.markAllRead(req.user._id));
});

module.exports = { list, read, readAll };
