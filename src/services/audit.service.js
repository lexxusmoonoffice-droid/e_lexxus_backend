/**
 * Audit log helper.
 *
 *   logAction(req, 'product.update', 'Product', id, { before, after })
 *
 * Never blocks the caller — failures are logged and swallowed.
 */

const { AuditLog } = require('../models');
const logger = require('../config/logger');

async function logAction(req, action, entity, entityId, { before, after } = {}) {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      before,
      after,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (err) {
    logger.warn('audit.logAction failed', { action, message: err.message });
  }
}

async function list(query = {}) {
  const filter = {};
  if (query.entity) filter.entity = query.entity;
  if (query.action) filter.action = query.action;
  if (query.actor) filter.actor = query.actor;
  if (query.entityId) filter.entityId = query.entityId;
  return AuditLog.paginate(filter, {
    page: query.page,
    limit: query.limit,
    sort: '-createdAt',
    populate: { path: 'actor', select: 'name email role' },
  });
}

module.exports = { logAction, list };
