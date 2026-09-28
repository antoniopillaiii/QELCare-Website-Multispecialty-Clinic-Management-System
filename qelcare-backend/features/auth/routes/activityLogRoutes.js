// FILE: qelcare-backend/features/auth/routes/activityLogRoutes.js
const router = require("express").Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const pool = require("../../../config/database");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");
const { isPositiveInt, escapeLike } = require("../../../shared/utils/requestValidation");
const { isValidDateString } = require("../../../shared/utils/manilaTime");

router.use(authenticate, authorize(["Admin"]));

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_SEARCH = 200;
const CODE_PATTERN = /^[A-Za-z0-9_]+$/;

// Reads and validates the list filters. Anything malformed is a 400 with the
// reason instead of being silently dropped (which showed unfiltered results
// under a filter the admin believed was applied) or reaching SQL ("2026-02-31"
// used to be a 500). Returns { error } or { page, limit, where, params }.
function parseQuery(query) {
  const single = (key) => {
    const value = query[key];
    if (value === undefined) return "";
    if (typeof value !== "string") return null; // repeated/array parameter
    return value.trim();
  };

  const page = single("page");
  if (page === null || (page && !isPositiveInt(page))) return { error: "Page must be a positive whole number." };
  const limitText = single("limit");
  if (limitText === null || (limitText && !isPositiveInt(limitText))) return { error: "Rows per page must be a positive whole number." };

  const conditions = [];
  const params = [];

  const search = single("search");
  if (search === null) return { error: "Invalid search." };
  if (search.length > MAX_SEARCH) return { error: `Search must be ${MAX_SEARCH} characters or fewer.` };
  if (search) {
    // Literal match: "%" and "_" are searched for, not used as wildcards.
    params.push(`%${escapeLike(search)}%`);
    const p = `$${params.length}`;
    conditions.push(`(
      al.action ILIKE ${p}
      OR COALESCE(al.entity_type, '') ILIKE ${p}
      OR CAST(al.entity_id AS TEXT) ILIKE ${p}
      OR COALESCE(al.description, '') ILIKE ${p}
      OR COALESCE(host(al.ip_address), '') ILIKE ${p}
      OR COALESCE(u.username, '') ILIKE ${p}
      OR COALESCE(u.email, '') ILIKE ${p}
      OR COALESCE(u.first_name, '') ILIKE ${p}
      OR COALESCE(u.last_name, '') ILIKE ${p}
      OR COALESCE(r.role_name, '') ILIKE ${p}
    )`);
  }

  const action = single("action");
  if (action === null || (action && (action.length > 80 || !CODE_PATTERN.test(action)))) {
    return { error: "Invalid action filter." };
  }
  if (action) {
    params.push(action.toUpperCase());
    conditions.push(`al.action = $${params.length}`);
  }

  const entityType = single("entity_type");
  if (entityType === null || (entityType && (entityType.length > 50 || !CODE_PATTERN.test(entityType)))) {
    return { error: "Invalid entity filter." };
  }
  if (entityType) {
    params.push(entityType);
    conditions.push(`LOWER(COALESCE(al.entity_type, 'system')) = LOWER($${params.length})`);
  }

  const userId = single("user_id");
  if (userId === null || (userId && !isPositiveInt(userId))) return { error: "Invalid user filter." };
  if (userId) {
    params.push(Number(userId));
    conditions.push(`al.user_id = $${params.length}`);
  }

  const from = single("from");
  const to = single("to");
  if (from === null || (from && !isValidDateString(from))) return { error: "From date must be a valid date (YYYY-MM-DD)." };
  if (to === null || (to && !isValidDateString(to))) return { error: "To date must be a valid date (YYYY-MM-DD)." };
  if (from && to && from > to) return { error: "From date must be on or before the To date." };

  // Dates are clinic (Asia/Manila) calendar days whatever the database
  // session's time zone: from 00:00 Manila on "from" up to, not including,
  // 00:00 Manila on the day after "to".
  if (from) {
    params.push(from);
    conditions.push(`al.created_at >= ($${params.length}::date::timestamp AT TIME ZONE 'Asia/Manila')`);
  }
  if (to) {
    params.push(to);
    conditions.push(`al.created_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`);
  }

  return {
    page: page ? Number(page) : 1,
    limit: Math.min(limitText ? Number(limitText) : DEFAULT_LIMIT, MAX_LIMIT),
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

router.get("/", async (req, res) => {
  try {
    const parsed = parseQuery(req.query);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const { page, limit, where, params } = parsed;
    const offset = (page - 1) * limit;

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
         host(al.ip_address) AS ip_address,
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
    logSafeError("Activity logs error", err);
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
    logSafeError("Activity log metadata error", err);
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
    logSafeError("Activity log actions error", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch actions.",
    });
  }
});

module.exports = router;
