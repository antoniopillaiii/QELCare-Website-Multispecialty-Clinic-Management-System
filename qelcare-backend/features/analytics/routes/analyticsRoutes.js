const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const pool = require("../../../config/database");
const { generateReport } = require("../services/geminiReportService");

router.use(authenticate, authorize(["Admin"]));

// Each AI Insights request can trigger a paid Gemini call. Capped per admin
// account (runs after authenticate) rather than per IP, since clinic staff
// share an IP. Cached reports keep normal use well under this.
const aiInsightsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `admin:${req.user?.user_id}`,
  message: { success: false, message: "Too many AI report requests. Please wait a few minutes and try again." },
});

const RANGE_CONFIG = {
  past_7_days: { label: "Past 7 Days", days: 7 },
  past_30_days: { label: "Past 30 Days", days: 30 },
  this_month: { label: "This Month", mode: "this_month" },
  last_month: { label: "Last Month", mode: "last_month" },
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EXCLUDED_APPOINTMENT_STATUSES = ["CANCELLED", "NO_SHOW", "RESCHEDULED"];

function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveDateRange(rangeKey) {
  const key = RANGE_CONFIG[rangeKey] ? rangeKey : "past_7_days";
  const config = RANGE_CONFIG[key];
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start;

  if (config.mode === "this_month") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (config.mode === "last_month") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end.setDate(0);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - (config.days - 1));
  }

  return {
    key,
    label: config.label,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  };
}

function intValue(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function pickTop(rows, countKey = "total") {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((top, row) => (intValue(row[countKey]) > intValue(top[countKey]) ? row : top), rows[0]);
}

function normalizeRows(rows, keysToInt = []) {
  return rows.map((row) => {
    const next = { ...row };
    keysToInt.forEach((key) => {
      next[key] = intValue(next[key]);
    });
    return next;
  });
}

function normalizeDayRows(rows) {
  const byDay = new Map(rows.map((row) => [intValue(row.day_number), row]));
  return DAY_NAMES.map((dayName, index) => {
    const row = byDay.get(index + 1);
    return {
      day_number: index + 1,
      day_name: dayName,
      total: intValue(row?.total),
    };
  });
}

function buildFallbackReport({ range, metrics, topDepartment, busiestDay }) {
  const totalAppointments = intValue(metrics.total_appointments);
  const completedVisits = intValue(metrics.completed_visits);
  const queueEntries = intValue(metrics.queue_entries);
  const completionRate = pct(completedVisits, totalAppointments);
  const departmentName = topDepartment?.department || "No department data";
  const departmentCount = intValue(topDepartment?.total);
  const dayName = busiestDay?.day_name || "No clinic day data";
  const dayCount = intValue(busiestDay?.total);
  const busiestSource = busiestDay?.source === "queue" ? "queue activity" : "appointments";

  let summary;
  if (totalAppointments === 0 && queueEntries === 0) {
    summary = `For ${range.label.toLowerCase()}, the clinic has no recorded appointments or queue activity in the selected period. This means there is not enough operational volume yet to identify demand patterns, department load, or daily peak activity.`;
  } else {
    summary = `For ${range.label.toLowerCase()}, the clinic recorded ${totalAppointments} appointment${totalAppointments === 1 ? "" : "s"} and ${queueEntries} queue entr${queueEntries === 1 ? "y" : "ies"}. Completed visits reached ${completedVisits}, giving an appointment completion rate of ${completionRate}%. The main service demand came from ${departmentName}, while ${dayName} was the busiest clinic day based on ${busiestSource}.`;
  }

  const bullets = [
    `Total appointments: ${totalAppointments}.`,
    `Completed visits: ${completedVisits} (${completionRate}% completion rate).`,
    `Queue activity: ${queueEntries} entr${queueEntries === 1 ? "y" : "ies"} recorded.`,
    `Most visited department: ${departmentName}${departmentCount ? ` with ${departmentCount} appointment${departmentCount === 1 ? "" : "s"}` : ""}.`,
    `Busiest clinic day: ${dayName}${dayCount ? ` with ${dayCount} ${busiestSource === "queue activity" ? "queue entries" : "appointments"}` : ""}.`,
  ];

  const recommendation = totalAppointments === 0 && queueEntries === 0
    ? "Recommendation: Continue completing appointment and queue workflows first so the reporting module has enough real data for useful operational insights."
    : `Recommendation: Review staffing and room allocation around ${dayName}, and monitor ${departmentName} capacity so high-demand periods stay organized and patient flow remains predictable.`;

  return {
    summary,
    bullets,
    recommendation,
    text: `${summary}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n${recommendation}`,
  };
}

async function buildAiInsights(rangeKey) {
  const range = resolveDateRange(rangeKey);
  const params = [range.startDate, range.endDate];

  const [
    metricsResult,
    departmentsResult,
    appointmentDaysResult,
    queueDaysResult,
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*)::int AS total_appointments,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_visits,
        COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_appointments,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed_appointments,
        COUNT(*) FILTER (WHERE status = 'IN_QUEUE')::int AS in_queue_appointments,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_appointments,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_show_appointments,
        COUNT(*) FILTER (WHERE status = 'RESCHEDULED')::int AS rescheduled_appointments,
        (
          SELECT COUNT(*)::int
          FROM queue_entries qe
          WHERE qe.queue_date BETWEEN $1::date AND $2::date
        ) AS queue_entries
      FROM appointments
      WHERE date BETWEEN $1::date AND $2::date
      `,
      params
    ),
    pool.query(
      `
      SELECT
        COALESCE(s.specialty_name, 'Unassigned') AS department,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed
      FROM appointments a
      LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.status <> ALL($3::text[])
      GROUP BY COALESCE(s.specialty_name, 'Unassigned')
      ORDER BY total DESC, department ASC
      LIMIT 10
      `,
      [...params, EXCLUDED_APPOINTMENT_STATUSES]
    ),
    pool.query(
      `
      SELECT
        EXTRACT(ISODOW FROM date)::int AS day_number,
        TRIM(TO_CHAR(date, 'Day')) AS day_name,
        COUNT(*)::int AS total
      FROM appointments
      WHERE date BETWEEN $1::date AND $2::date
        AND status <> ALL($3::text[])
      GROUP BY EXTRACT(ISODOW FROM date), TRIM(TO_CHAR(date, 'Day'))
      ORDER BY day_number ASC
      `,
      [...params, EXCLUDED_APPOINTMENT_STATUSES]
    ),
    pool.query(
      `
      SELECT
        EXTRACT(ISODOW FROM queue_date)::int AS day_number,
        TRIM(TO_CHAR(queue_date, 'Day')) AS day_name,
        COUNT(*)::int AS total
      FROM queue_entries
      WHERE queue_date BETWEEN $1::date AND $2::date
      GROUP BY EXTRACT(ISODOW FROM queue_date), TRIM(TO_CHAR(queue_date, 'Day'))
      ORDER BY day_number ASC
      `,
      params
    ),
  ]);

  const metrics = normalizeRows(metricsResult.rows, [
    "total_appointments",
    "completed_visits",
    "pending_appointments",
    "confirmed_appointments",
    "in_queue_appointments",
    "cancelled_appointments",
    "no_show_appointments",
    "rescheduled_appointments",
    "queue_entries",
  ])[0] || {};

  const departmentRows = normalizeRows(departmentsResult.rows, ["total", "completed"]);
  const appointmentDayRows = normalizeDayRows(appointmentDaysResult.rows);
  const queueDayRows = normalizeDayRows(queueDaysResult.rows);
  const topDepartment = pickTop(departmentRows, "total");
  const topQueueDay = pickTop(queueDayRows, "total");
  const topAppointmentDay = pickTop(appointmentDayRows, "total");
  const busiestDay = intValue(topQueueDay?.total) > 0
    ? { ...topQueueDay, source: "queue" }
    : intValue(topAppointmentDay?.total) > 0
      ? { ...topAppointmentDay, source: "appointments" }
      : null;

  const fallbackReport = buildFallbackReport({
    range,
    metrics,
    topDepartment,
    busiestDay,
  });

  let report;
  let aiSource = "gemini";
  let fallbackReason = null;

  try {
    report = await generateReport({
      range,
      metrics,
      departmentRows,
      appointmentDayRows,
      queueDayRows,
      topDepartment,
      busiestDay,
    });
  } catch (err) {
    report = fallbackReport;
    aiSource = "fallback";
    fallbackReason = err.message || "Gemini unavailable.";
  }

  return {
    range,
    source: aiSource,
    fallback_reason: fallbackReason,
    metrics,
    highlights: {
      most_visited_department: topDepartment || null,
      busiest_day: busiestDay || null,
    },
    charts: {
      departments: departmentRows,
      appointments_by_day: appointmentDayRows,
      queue_by_day: queueDayRows,
    },
    report,
  };
}

router.get("/ai-insights", aiInsightsLimiter, async (req, res) => {
  try {
    const result = await buildAiInsights(req.query.range);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("AI insights error:", err);
    res.status(500).json({ success: false, message: "Failed to generate AI insights." });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    const [metrics, weekly, deptToday, todayList] = await Promise.all([
      pool.query(`
        SELECT
          -- "Appointments Today" = every appointment on today's date except the
          -- lost ones (CANCELLED, NO_SHOW). RESCHEDULED is an active pre-visit
          -- status in the appointment model (ACTIVE_VISIBLE_STATUSES), and
          -- FOR_BILLING is a visit in progress, so both count. The 7-day chart,
          -- Department Load and the dashboard's today list use this same rule.
          (SELECT COUNT(*)
           FROM appointments
           WHERE date = CURRENT_DATE
             AND status NOT IN ('CANCELLED','NO_SHOW')
          )::int AS appointments_today,
          (SELECT COUNT(*)
           FROM appointments
           WHERE date = CURRENT_DATE AND status = 'COMPLETED'
          )::int AS completed_today,
          (SELECT COUNT(*)
           FROM queue_entries
           WHERE queue_date = CURRENT_DATE
             AND status IN ('WAITING','IN_PROGRESS')
          )::int AS active_queue,
          -- Count active PATIENT RECORDS, which is what the Patients module
          -- shows. The dashboard used to count users with the Patient role
          -- instead, and the two legitimately differ: a patient record can
          -- exist with no login (added by admin/frontdesk), and clinic staff
          -- can themselves be patients. Counting records keeps the dashboard
          -- card consistent with the page it links to.
          (SELECT COUNT(*)
           FROM patients
           WHERE is_active
          )::int AS total_patients
      `),
      pool.query(`
        SELECT
          TO_CHAR(d.day, 'Dy') AS label,
          COALESCE(COUNT(a.id), 0)::int AS value
        FROM generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'
        ) AS d(day)
        LEFT JOIN appointments a
          ON  a.date = d.day::date
          AND a.status NOT IN ('CANCELLED','NO_SHOW')
        GROUP BY d.day
        ORDER BY d.day ASC
      `),
      pool.query(`
        SELECT
          COALESCE(s.specialty_name, 'General') AS dept,
          COUNT(*)::int AS count
        FROM appointments a
        LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
        WHERE a.date = CURRENT_DATE
          AND a.status NOT IN ('CANCELLED','NO_SHOW')
        GROUP BY s.specialty_name
        ORDER BY count DESC
        LIMIT 8
      `),
      pool.query(`
        SELECT
          a.id,
          TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS patient_name,
          TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS doctor_name,
          COALESCE(s.specialty_name, 'General') AS dept,
          a.time::text AS appt_time,
          a.status
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.doctor_id = u.user_id
        LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
        -- Every status, including FOR_BILLING and RESCHEDULED (previously left
        -- out), and no row cap, so the list always adds up to the card above.
        WHERE a.date = CURRENT_DATE
        ORDER BY a.time ASC
      `),
    ]);

    res.json({
      success: true,
      data: {
        metrics: {
          appointments_today: metrics.rows[0].appointments_today,
          completed_today: metrics.rows[0].completed_today,
          active_queue: metrics.rows[0].active_queue,
          total_patients: metrics.rows[0].total_patients,
        },
        weekly: weekly.rows,
        dept_today: deptToday.rows,
        today_appointments: todayList.rows,
      },
    });
  } catch (err) {
    console.error("Admin dashboard analytics error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch dashboard data." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const [users, patients, appointments, billing] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE status = 'verified') AS active_users,
          COUNT(*) FILTER (WHERE status = 'deactivated') AS deactivated_users,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM users`),
      pool.query(`
        SELECT
          COUNT(*) AS total_patients,
          COUNT(*) FILTER (WHERE is_active = true) AS active_patients,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM patients`),
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
          COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
          COUNT(*) FILTER (WHERE date = CURRENT_DATE) AS today
        FROM appointments`),
      pool.query(`
        SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE status='PAID'), 0) AS total_revenue,
          COALESCE(SUM(total_amount) FILTER (WHERE status='PAID' AND DATE(paid_at) = CURRENT_DATE), 0) AS today_revenue,
          COALESCE(SUM(total_amount) FILTER (WHERE status='PAID' AND DATE_TRUNC('month',paid_at) = DATE_TRUNC('month',NOW())), 0) AS month_revenue,
          COUNT(*) FILTER (WHERE status = 'PAID') AS paid_count
        FROM billing`),
    ]);

    res.json({
      success: true,
      data: {
        users: users.rows[0],
        patients: patients.rows[0],
        appointments: appointments.rows[0],
        billing: billing.rows[0],
      },
    });
  } catch (err) {
    console.error("Analytics summary error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch summary." });
  }
});

router.get("/appointments/monthly", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', date), 'Mon YYYY') AS month,
        DATE_TRUNC('month', date) AS month_date,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM appointments
      WHERE date >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month_date ASC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Monthly appointments error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch data." });
  }
});

router.get("/appointments/by-specialty", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(s.specialty_name, 'Unassigned') AS specialty,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS completed
      FROM appointments a
      LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
      GROUP BY s.specialty_name
      ORDER BY total DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("By-specialty error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch data." });
  }
});

router.get("/billing/monthly", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', paid_at) AS month_date,
        COUNT(*) AS transactions,
        COALESCE(SUM(total_amount), 0) AS revenue,
        COALESCE(SUM(discount_amount), 0) AS total_discounts
      FROM billing
      WHERE status = 'PAID'
        AND paid_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', paid_at)
      ORDER BY month_date ASC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Monthly billing error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch data." });
  }
});

router.get("/billing/by-method", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        payment_method,
        COUNT(*) AS count,
        COALESCE(SUM(total_amount), 0) AS total
      FROM billing
      WHERE status = 'PAID'
      GROUP BY payment_method
      ORDER BY total DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("By-method error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch data." });
  }
});

router.get("/users/by-role", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.role_name,
        COUNT(u.user_id) AS total,
        COUNT(u.user_id) FILTER (WHERE u.status = 'verified') AS active,
        COUNT(u.user_id) FILTER (WHERE u.status = 'deactivated') AS deactivated
      FROM roles r
      LEFT JOIN users u ON r.role_id = u.role_id
      GROUP BY r.role_name
      ORDER BY total DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Users by-role error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch data." });
  }
});

router.get("/activity/recent", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        al.log_id, al.action, al.description, al.created_at,
        u.username, r.role_name
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      LEFT JOIN roles r ON u.role_id = r.role_id
      ORDER BY al.created_at DESC
      LIMIT 20`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Recent activity error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch activity." });
  }
});

module.exports = router;