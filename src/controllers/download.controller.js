const asyncHandler = require('../utils/asyncHandler');
const downloadService = require('../services/download.service');

// GET /downloads — list all purchased items (no count change)
const list = asyncHandler(async (req, res) => {
  res.json({ data: await downloadService.listDownloads(req.user._id) });
});

// GET /downloads/:token — view token info + product list, NO count decrement
const info = asyncHandler(async (req, res) => {
  res.json(await downloadService.getDownloadInfo(req.user, req.params.token));
});

// POST /downloads/:token/use — decrement count + return signed URLs (actual download)
const use = asyncHandler(async (req, res) => {
  res.json(await downloadService.useDownload(req.user, req.params.token));
});

// POST /downloads/:token/resend — resend email
const resend = asyncHandler(async (req, res) => {
  const out = await downloadService.resendDownloadEmail(req.user, req.params.token);
  res.json({ message: 'Download link emailed', ...out });
});

module.exports = { list, info, use, resend };
