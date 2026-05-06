const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userProfile.service');
const authService = require('../services/auth.service');

const me = asyncHandler(async (req, res) => {
  res.json({ user: (await userService.getMe(req.user._id)).toJSON() });
});

const update = asyncHandler(async (req, res) => {
  const user = await userService.updateMe(req.user._id, req.body);
  res.json({ user: user.toJSON() });
});

const remove = asyncHandler(async (req, res) => {
  await userService.deleteMe(req.user._id);
  res.status(204).end();
});

const exportData = asyncHandler(async (req, res) => {
  res.json(await userService.exportMe(req.user._id));
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({ user: req.user, ...req.body });
  res.json({ message: 'Password changed.' });
});

module.exports = { me, update, remove, exportData, changePassword };
