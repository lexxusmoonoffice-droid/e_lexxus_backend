/**
 * Audit log helper.
 *
 *   logAction(req, 'product.update', 'Product', id, { before, after })
 *
 * Never blocks the caller — failures are logged and swallowed.
 */

const { AuditLog, User } = require('../models');
const logger = require('../config/logger');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const matchingActors = await User.find({ $or: [{ email: rx }, { name: rx }] })
      .select('_id')
      .lean();
    const actorIds = matchingActors.map((u) => u._id);

    const or = [
      { action: rx },
      { entity: rx },
      { entityId: rx },
      { ip: rx },
    ];
    if (actorIds.length) or.push({ actor: { $in: actorIds } });

    filter.$and = [...(filter.$and || []), { $or: or }];
  }

  return AuditLog.paginate(filter, {
    page: query.page,
    limit: query.limit,
    sort: '-createdAt',
    populate: { path: 'actor', select: 'name email role' },
  });
}

module.exports = { logAction, list };
