const db = require("../../../config/database");

const VALID_STATUSES = ["new", "in_progress", "resolved", "archived"];

// preferred_date is a DATE: return it as "YYYY-MM-DD" text. Letting node-postgres
// turn it into a JS Date shifts it by a day when the server isn't on UTC.
const RETURN_COLUMNS = "*, TO_CHAR(preferred_date, 'YYYY-MM-DD') AS preferred_date";

const Inquiry = {
  async create({ full_name, email, phone, subject, message, preferred_date }) {
    const result = await db.query(
      `INSERT INTO inquiries (full_name, email, phone, subject, message, preferred_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${RETURN_COLUMNS}`,
      [full_name, email || null, phone || null, subject || null, message, preferred_date || null]
    );
    return result.rows[0];
  },

  async list({ status, search, page = 1, limit = 20 } = {}) {
    const params = [];
    const conditions = [];

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        i.full_name ILIKE $${params.length} OR
        i.email ILIKE $${params.length} OR
        i.phone ILIKE $${params.length} OR
        i.subject ILIKE $${params.length} OR
        i.message ILIKE $${params.length} OR
        CAST(i.inquiry_id AS TEXT) ILIKE $${params.length}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const dataParams = [...params, safeLimit, offset];

    const dataResult = await db.query(
      `SELECT i.*, TO_CHAR(i.preferred_date, 'YYYY-MM-DD') AS preferred_date,
              TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS handled_by_name
       FROM inquiries i
       LEFT JOIN users u ON i.handled_by = u.user_id
       ${where}
       ORDER BY
         CASE i.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END ASC,
         i.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const countResult = await db.query(`SELECT COUNT(*)::int AS count FROM inquiries i ${where}`, params);
    const total = countResult.rows[0]?.count || 0;

    return {
      data: dataResult.rows,
      inquiries: dataResult.rows,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  },

  async update(id, { status, admin_notes, handled_by }) {
    const result = await db.query(
      `UPDATE inquiries
       SET status = COALESCE($2, status),
           admin_notes = COALESCE($3, admin_notes),
           handled_by = COALESCE($4, handled_by),
           updated_at = NOW()
       WHERE inquiry_id = $1
       RETURNING ${RETURN_COLUMNS}`,
      [id, status || null, admin_notes ?? null, handled_by || null]
    );
    return result.rows[0] || null;
  },
};

Inquiry.VALID_STATUSES = VALID_STATUSES;
module.exports = Inquiry;
