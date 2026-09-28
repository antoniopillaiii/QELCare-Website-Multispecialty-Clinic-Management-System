// ============================================================
// FILE: qelcare-backend/shared/utils/activityLogger.js
// ============================================================
const net = require('net');
const pool = require('../../config/database');
const { logSafeError } = require('./safeErrorLog');

// activity_logs column limits: action varchar(80), entity_type varchar(50),
// entity_id integer.
const MAX_ACTION = 80;
const MAX_ENTITY_TYPE = 50;
const MAX_INT = 2147483647;

function cleanIp(value) {
  if (!value) return null;
  let ip = String(value).trim();
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7); // IPv4-mapped IPv6
  return net.isIP(ip) ? ip : null;
}

function cleanMetadata(value) {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ audit_error: "metadata_not_serializable" });
  }
}

function cleanEntityId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null;
}

// Writes one audit row. An audit record must never be lost to a bad optional
// field (a malformed IP used to make the INSERT fail, silently dropping the
// log while the action itself succeeded), so every value is validated first,
// and if the full row still can't be written a minimal row (actor, action,
// entity) is written instead. Only when even that fails (e.g. the database is
// unreachable) is the failure reported, without row values, to the server log.
const log = async ({
  userId      = null,
  action,
  entityType  = null,
  entityId    = null,
  description = null,
  ip          = null,
  metadata    = null,
} = {}) => {
  const row = {
    userId: cleanEntityId(userId),
    action: String(action || 'UNKNOWN').slice(0, MAX_ACTION),
    entityType: entityType ? String(entityType).slice(0, MAX_ENTITY_TYPE) : null,
    entityId: cleanEntityId(entityId),
    description: description ? String(description) : null,
    ip: cleanIp(ip),
    metadata: cleanMetadata(metadata),
  };

  try {
    await pool.query(
      `INSERT INTO activity_logs
         (user_id, action, entity_type, entity_id, description, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
      [row.userId, row.action, row.entityType, row.entityId, row.description, row.ip, row.metadata]
    );
    return true;
  } catch (err) {
    logSafeError(`[ActivityLogger] Full audit row failed for ${row.action}; writing a minimal row`, err);
  }

  try {
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.userId, row.action, row.entityType, row.entityId, JSON.stringify({ audit_degraded: true })]
    );
    return true;
  } catch (err) {
    logSafeError(`[ActivityLogger] AUDIT WRITE FAILED action=${row.action} user=${row.userId || 'none'} entity=${row.entityType || 'none'}#${row.entityId || ''}`, err);
    return false;
  }
};

// The client address as determined by Express from its trusted-proxy setting
// (server.js: app.set("trust proxy", 1)). Never read X-Forwarded-For directly:
// its first entry is whatever the client sent, so it was spoofable.
const getIP = (req) => cleanIp(req.ip || req.socket?.remoteAddress);

module.exports = { log, getIP };
