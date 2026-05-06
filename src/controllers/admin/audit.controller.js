const asyncHandler = require('../../utils/asyncHandler');
const audit = require('../../services/audit.service');

const list = asyncHandler(async (req, res) => {
  res.json(await audit.list(req.query));
});

module.exports = { list };
