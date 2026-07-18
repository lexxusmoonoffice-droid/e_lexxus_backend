const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { Inquiry } = require('../../models');
const audit = require('../../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== 'All') {
    filter.status = req.query.status;
  }
  if (req.query.q) {
    const searchRegex = new RegExp(req.query.q, 'i');
    filter.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { subject: searchRegex },
      { message: searchRegex },
    ];
  }

  const result = await Inquiry.paginate(filter, {
    page: req.query.page,
    limit: req.query.limit,
    sort: '-createdAt',
  });
  res.json(result);
});

const detail = asyncHandler(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry) throw AppError.notFound('Inquiry not found');
  res.json({ inquiry });
});

const patchStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (status !== 'unread' && status !== 'read') {
    throw AppError.badRequest('status must be "unread" or "read"', 'BAD_STATUS');
  }
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry) throw AppError.notFound('Inquiry not found');

  const beforeStatus = inquiry.status;
  inquiry.status = status;
  await inquiry.save();

  await audit.logAction(req, 'inquiry.status', 'Inquiry', inquiry._id, {
    before: { status: beforeStatus },
    after: { status },
  });

  res.json({ inquiry });
});

const remove = asyncHandler(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry) throw AppError.notFound('Inquiry not found');
  await inquiry.deleteOne();

  await audit.logAction(req, 'inquiry.delete', 'Inquiry', req.params.id, {
    before: { email: inquiry.email, subject: inquiry.subject },
  });
  res.status(204).end();
});

module.exports = { list, detail, patchStatus, remove };
