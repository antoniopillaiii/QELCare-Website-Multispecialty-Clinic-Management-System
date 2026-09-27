// FILE: qelcare-backend/features/auth/routes/activityLogRoutes.js
const router = require("express").Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const pool = require("../../../config/database");

router.use(authenticate, authorize(["Admin"]));

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isDateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildFilters(query) {
  const conditions = [];
  const params = [];

  const search = String(query.search || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    conditions.push(`(
      al.action ILIKE ${p}
      OR COALESCE(al.entity_type, '') ILIKE ${p}
      OR CAST(al.entity_id AS TEXT) ILIKE ${p}
      OR COALESCE(al.description, '') ILIKE ${p}
      OR CAST(al.ip_address AS TEXT) ILIKE ${p}
      OR COALESCE(u.username, '') ILIKE ${p}
      OR COALESCE(u.email, '') ILIKE ${p}
      OR COALESCE(u.first_name, '') ILIKE ${p}
      OR COALESCE(u.last_name, '') ILIKE ${p}
      OR COALESCE(r.role_name, '') ILIKE ${p}
    )`);
  }

  const action = String(query.action || "").trim();
  if (action) {
    params.push(action.toUpperCase());
    conditions.push(`al.action = $${params.length}`);
  }

  const entityType = String(query.entity_type || "").trim();
  if (entityType) {
    params.push(entityType);
    conditions.push(`LOWER(COALESCE(al.entity_type, 'system')) = LOWER($${params.length})`);
  }

  const userId = Number.parseInt(query.user_id, 10);
  if (Number.isInteger(userId) && userId > 0) {
    params.push(userId);
    conditions.push(`al.user_id = $${params.length}`);
  }

  if (isDateOnly(query.from)) {
    params.push(query.from);
    conditions.push(`al.created_at >= $${params.length}::date`);
  }

  if (isDateOnly(query.to)) {
    params.push(query.to);
    conditions.push(`al.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

router.get("/", async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const rawLimit = toPositiveInt(req.query.limit, DEFAULT_LIMIT);
    const limit = Math.min(rawLimit, MAX_LIMIT);
    const offset = (page - 1) * limit;
    const { where, params } = buildFilters(req.query);

    const fromClause = `
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      LEFT JOIN roles r ON u.role_id = r.role_id
      ${where}
    `;

    const [countResult, summaryResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total ${fromClause}`, params),
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE (al.created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date)::int AS today,
           COUNT(*) FILTER (WHERE al.created_at >= NOW() - INTERVAL '24 hours')::int AS last_24_hours,
           COUNT(DISTINCT al.user_id) FILTER (WHERE al.user_id IS NOT NULL)::int AS active_users,
           COUNT(*) FILTER (WHERE al.user_id IS NULL)::int AS system_events
         ${fromClause}`,
        params
      ),
    ]);

    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT
         al.log_id,
         al.user_id,
         al.action,
         al.entity_type,
         al.entity_id,
         al.description,
         al.ip_address::text AS ip_address,
         al.metadata,
         al.created_at,
         u.username,
         u.email,
         u.first_name,
         u.last_name,
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS actor_name,
         r.role_name
       ${fromClause}
       ORDER BY al.created_at DESC, al.log_id DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const total = countResult.rows[0]?.total || 0;

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: summaryResult.rows[0] || {
        total: 0,
        today: 0,
        last_24_hours: 0,
        active_users: 0,
        system_events: 0,
      },
    });
  } catch (err) {
    console.error("Activity logs error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch activity logs.",
    });
  }
});

router.get("/meta", async (_req, res) => {
  try {
    const [actionsResult, entitiesResult, usersResult] = await Promise.all([
      pool.query(`
        SELECT action, COUNT(*)::int AS count
        FROM activity_logs
        GROUP BY action
        ORDER BY action
      `),
      pool.query(`
        SELECT COALESCE(entity_type, 'system') AS entity_type, COUNT(*)::int AS count
        FROM activity_logs
        GROUP BY COALESCE(entity_type, 'system')
        ORDER BY entity_type
      `),
      pool.query(`
        SELECT
          al.user_id,
          COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'System') AS actor_name,
          u.username,
          r.role_name,
          COUNT(*)::int AS count
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.user_id
        LEFT JOIN roles r ON u.role_id = r.role_id
        GROUP BY al.user_id, u.first_name, u.last_name, u.username, r.role_name
        ORDER BY actor_name
        LIMIT 100
      `),
    ]);

    res.json({
      success: true,
      data: {
        actions: actionsResult.rows,
        entity_types: entitiesResult.rows,
        users: usersResult.rows,
      },
    });
  } catch (err) {
    console.error("Activity log metadata error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch activity log filters.",
    });
  }
});

router.get("/actions", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT action
      FROM activity_logs
      GROUP BY action
      ORDER BY action
    `);
    res.json({ success: true, data: result.rows.map((row) => row.action) });
  } catch (err) {
    console.error("Activity log actions error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch actions.",
    });
  }
});

module.exports = router;
