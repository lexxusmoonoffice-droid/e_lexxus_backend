const asyncHandler = require('../../utils/asyncHandler');
const { Settings } = require('../../models');
const audit = require('../../services/audit.service');
const appConfig = require('../../services/appConfig.service');

const get = asyncHandler(async (req, res) => {
  const settings = await Settings.getSettings();
  res.json({ settings });
});

const update = asyncHandler(async (req, res) => {
  const before = await Settings.getSettings();
  const settings = await Settings.findOneAndUpdate(
    {},
    { $set: req.body },
    { new: true, upsert: true, runValidators: true },
  );
  await audit.logAction(req, 'settings.update', 'Settings', settings._id, {
    before: before.toJSON(),
    after: settings.toJSON(),
  });
  // Refresh the in-memory config cache so new values take effect immediately
  await appConfig.reload().catch(() => {});
  res.json({ settings });
});

module.exports = { get, update };
