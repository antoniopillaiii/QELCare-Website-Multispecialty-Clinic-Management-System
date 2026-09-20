const express = require("express");
const http = require("http");
const https = require("https");
const router = express.Router();
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const pool = require("../../../config/database");

router.use(authenticate, authorize(["Admin"]));

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

function normalizeAiShape(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const summary = parsed.summary || parsed.overview || parsed.analysis || parsed.text;
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets
    : Array.isArray(parsed.key_points)
      ? parsed.key_points
      : Array.isArray(parsed.metrics)
        ? parsed.metrics
        : [];
  const recommendation = parsed.recommendation || parsed.recommendations || parsed.next_steps || parsed.action;

  if (!summary || !recommendation) return null;

  const safeBullets = bullets.length ? bullets.map((bullet) => String(bullet)) : [String(summary)];
  return {
    summary: String(summary),
    bullets: safeBullets,
    recommendation: String(recommendation),
    text: `${summary}\n\n${safeBullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n${recommendation}`,
  };
}

function tryParseAiJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^\`\`\`json\s*/i, "").replace(/^\`\`\`\s*/i, "").replace(/\`\`\`$/i, "").trim(),
  ];

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const normalized = normalizeAiShape(JSON.parse(candidate));
      if (normalized) return normalized;
    } catch (_) {
      // Try the next candidate.
    }
  }

  return null;
}

function sanitizeReport(report) {
  if (!report) return null;
  const blockedTerms = [
    /staff attendance/gi,
    /attendance issues?/gi,
    /top doctor/gi,
    /doctor rankings?/gi,
    /doctor performance/gi,
  ];

  const cleanText = (value) => {
    let text = String(value || "").trim();
    blockedTerms.forEach((term) => {
      text = text.replace(term, "clinic operations");
    });
    return text;
  };

  const summary = cleanText(report.summary);
  const bullets = Array.isArray(report.bullets)
    ? report.bullets.map(cleanText).filter(Boolean)
    : [];
  const recommendation = cleanText(report.recommendation);

  if (!summary || bullets.length === 0 || !recommendation) return null;

  return {
    summary,
    bullets,
    recommendation,
    text: `${summary}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n${recommendation}`,
  };
}

// Default timeout is generous because a local Ollama model can take a long time
// on its FIRST request (cold start: the model has to load into RAM/VRAM).
// Override with OLLAMA_TIMEOUT_MS in the environment.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 180000;

function postJson(urlString, payload, timeoutMs = OLLAMA_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const client = url.protocol === "https:" ? https : http;

    const request = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Ollama responded with ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Ollama request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function ollamaConfig() {
  return {
    url: (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL || "llama3.2",
    // Keep the model resident in memory between requests so only the FIRST
    // call after a server (or model) start pays the cold-load cost.
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || "30m",
  };
}

// Fire-and-forget warmup: loads the model into memory shortly after boot so the
// first real report isn't the one that eats the cold-start delay.
async function warmupOllama() {
  const { url, model, keepAlive } = ollamaConfig();
  try {
    await postJson(`${url}/api/generate`, {
      model,
      prompt: "ok",
      stream: false,
      keep_alive: keepAlive,
      options: { num_predict: 1 },
    });
    console.log(`Ollama warmup complete (model: ${model}).`);
  } catch (err) {
    console.warn(`Ollama warmup skipped: ${err.message}`);
  }
}

async function generateWithOllama({ range, metrics, departmentRows, appointmentDayRows, queueDayRows }) {
  const { url, model, keepAlive } = ollamaConfig();
  const prompt = `
Analyze the following clinic operations data and provide a professional administrative report.

Strict rules:
- Do not include patient names or personal details.
- Focus only on appointment volume, completed visits, queue activity, department demand, and busiest clinic day.
- Return valid JSON only with this exact shape:
{
  "summary": "one paragraph",
  "bullets": ["metric bullet", "metric bullet"],
  "recommendation": "one concise recommendation"
}

Selected period: ${range.label} (${range.startDate} to ${range.endDate})
Data:
${JSON.stringify({
    metrics,
    departments: departmentRows,
    appointments_by_day: appointmentDayRows,
    queue_by_day: queueDayRows,
  }, null, 2)}
`;

  const requestBody = {
    model,
    prompt,
    format: "json",
    stream: false,
    keep_alive: keepAlive,
    options: {
      temperature: 0.2,
      num_predict: 450,
    },
  };

  let response;
  try {
    response = await postJson(`${url}/api/generate`, requestBody);
  } catch (err) {
    // One retry on a cold-start timeout — the first attempt likely loaded the
    // model into memory, so the second should be fast.
    if (String(err.message || "").toLowerCase().includes("timed out")) {
      response = await postJson(`${url}/api/generate`, requestBody);
    } else {
      throw err;
    }
  }

  const parsed = sanitizeReport(tryParseAiJson(response.response));
  if (!parsed) {
    const err = new Error("Ollama returned an unreadable report format.");
    err.code = "OLLAMA_INVALID_JSON";
    throw err;
  }
  return parsed;
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
  let aiSource = "ollama";
  let fallbackReason = null;

  try {
    report = await generateWithOllama({
      range,
      metrics,
      departmentRows,
      appointmentDayRows,
      queueDayRows,
    });
  } catch (err) {
    report = fallbackReport;
    aiSource = "fallback";
    fallbackReason = err.message || "Ollama unavailable.";
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

router.get("/ai-insights", async (req, res) => {
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
          (SELECT COUNT(*)
           FROM appointments
           WHERE date = CURRENT_DATE
             AND status NOT IN ('CANCELLED','NO_SHOW','RESCHEDULED')
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
          AND a.status NOT IN ('CANCELLED','NO_SHOW','RESCHEDULED')
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
          AND a.status NOT IN ('CANCELLED','NO_SHOW','RESCHEDULED')
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
        WHERE a.date = CURRENT_DATE
          AND a.status IN ('PENDING','CONFIRMED','IN_QUEUE','COMPLETED','NO_SHOW','CANCELLED')
        ORDER BY a.time ASC
        LIMIT 60
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

router.warmupOllama = warmupOllama;

module.exports = router;