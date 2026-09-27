const db = require("../../../config/database");
const { MANILA_TODAY_SQL, manilaToday } = require("../../../shared/utils/manilaTime");

const VALID_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS", "DONE", "SKIPPED", "NO_SHOW", "CANCELLED"];
const FINAL_QUEUE_STATUSES = ["DONE", "NO_SHOW", "CANCELLED"];
// The live queue: patients in line or being served. The single definition used
// by the queue screens, the public waiting-room display and the Dashboard's
// "Active Queue" card. SKIPPED is on hold (recall or auto no-show), not in line.
const LIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];

// Allowed queue moves (server-enforced; the buttons only mirror these).
//  - WAITING -> IN_PROGRESS is the nurse "vitals recorded, ready for doctor" and
//    the doctor "start consultation" step, so it doesn't require CALLED first.
//  - NO_SHOW only for a patient who was called or skipped and didn't come;
//    never for someone waiting their turn or already being served.
const QUEUE_TRANSITIONS = {
  WAITING: ["CALLED", "IN_PROGRESS", "SKIPPED", "CANCELLED"],
  CALLED: ["WAITING", "IN_PROGRESS", "SKIPPED", "NO_SHOW", "CANCELLED"],
  IN_PROGRESS: ["DONE", "CANCELLED"],
  SKIPPED: ["WAITING", "NO_SHOW", "CANCELLED"],
  DONE: [],
  NO_SHOW: [],
  CANCELLED: [],
};

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function appError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function findEntryById(queueId, client = db) {
  const result = await client.query(
    `SELECT
       q.queue_id,
       q.appointment_id,
       q.specialty_id,
       q.queue_number,
       TO_CHAR(q.queue_date, 'YYYY-MM-DD') AS queue_date,
       q.status,
       q.called_at,
       q.started_at,
       q.completed_at,
       q.notes,
       q.priority,
       q.created_at,
       q.updated_at,
       a.id AS appointment_id,
       TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
       a.time::text AS appointment_time,
       a.status AS appointment_status,
       a.type AS appointment_type,
       a.chief_complaint,
       a.notes AS appointment_notes,
       p.id AS patient_id,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
       p.phone AS patient_phone,
       p.email AS patient_email,
       p.gender AS patient_gender,
       p.date_of_birth,
       u.user_id AS doctor_id,
       NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS doctor_name,
       u.email AS doctor_email,
       s.specialty_name,
       s.slug AS specialty_slug
     FROM queue_entries q
     JOIN appointments a ON q.appointment_id = a.id
     JOIN patients p ON a.patient_id = p.id
     JOIN users u ON a.doctor_id = u.user_id
     JOIN specialties s ON q.specialty_id = s.specialty_id
     WHERE q.queue_id = $1::integer`,
    [queueId]
  );

  return result.rows[0] || null;
}

const Queue = {
  async findById(queueId) {
    return findEntryById(queueId);
  },

  // Read-only. Counts only include live entries whose appointment is still in
  // the queue, so a stale row can never inflate "waiting"/"active".
  async getSpecialties(date = manilaToday()) {
    const targetDate = date || manilaToday();

    const result = await db.query(
      `SELECT
         s.specialty_id,
         s.specialty_name,
         s.slug,
         s.display_order,
         s.is_active,
         COUNT(q.queue_id)::int AS total,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'WAITING' AND a.status = 'IN_QUEUE')::int AS waiting,
         COUNT(q.queue_id) FILTER (WHERE q.status IN ('CALLED', 'IN_PROGRESS') AND a.status = 'IN_QUEUE')::int AS in_progress,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'CALLED' AND a.status = 'IN_QUEUE')::int AS called,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'SKIPPED' AND a.status = 'IN_QUEUE')::int AS skipped,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'DONE')::int AS done,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'NO_SHOW')::int AS no_show,
         COUNT(q.queue_id) FILTER (WHERE q.status = 'CANCELLED')::int AS cancelled
       FROM specialties s
       LEFT JOIN queue_entries q
         ON q.specialty_id = s.specialty_id
        AND q.queue_date = $1::date
       LEFT JOIN appointments a ON a.id = q.appointment_id
       WHERE COALESCE(s.is_active, true) = true
       GROUP BY s.specialty_id, s.specialty_name, s.slug, s.display_order, s.is_active
       ORDER BY COALESCE(s.display_order, 0), s.specialty_name`,
      [targetDate]
    );

    return result.rows;
  },

  // Read-only.
  async findBySpecialtyAndDate(specialtyId, date = manilaToday()) {
    const targetDate = date || manilaToday();

    const result = await db.query(
      `SELECT
         q.queue_id,
         q.appointment_id,
         q.specialty_id,
         q.queue_number,
         TO_CHAR(q.queue_date, 'YYYY-MM-DD') AS queue_date,
         q.status,
         q.called_at,
         q.started_at,
         q.completed_at,
         q.notes,
         q.priority,
         q.created_at,
         q.updated_at,
         TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
         a.time::text AS appointment_time,
         a.status AS appointment_status,
         a.type AS appointment_type,
         a.chief_complaint,
         a.notes AS appointment_notes,
         p.id AS patient_id,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
         p.phone AS patient_phone,
         p.email AS patient_email,
         p.gender AS patient_gender,
         p.date_of_birth,
         u.user_id AS doctor_id,
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS doctor_name,
         u.email AS doctor_email,
         s.specialty_name,
         s.slug AS specialty_slug
       FROM queue_entries q
       JOIN appointments a ON q.appointment_id = a.id
       JOIN patients p ON a.patient_id = p.id
       JOIN users u ON a.doctor_id = u.user_id
       JOIN specialties s ON q.specialty_id = s.specialty_id
       WHERE q.specialty_id = $1::integer
         AND q.queue_date = $2::date
       ORDER BY
         CASE q.status
           WHEN 'IN_PROGRESS' THEN 1
           WHEN 'CALLED' THEN 2
           WHEN 'WAITING' THEN 3
           WHEN 'SKIPPED' THEN 4
           WHEN 'DONE' THEN 5
           WHEN 'NO_SHOW' THEN 6
           WHEN 'CANCELLED' THEN 7
           ELSE 8
         END,
         q.priority DESC,
         q.queue_number ASC`,
      [specialtyId, targetDate]
    );

    return result.rows;
  },

  // --------------------------------------------------------------------------
  // addToQueue
  //   Put a CONFIRMED appointment for TODAY (Manila) into its specialty's queue
  //   and move it to IN_QUEUE. Pass { client } to run inside the caller's
  //   transaction (confirm / check-in), so the appointment status and the queue
  //   entry commit or roll back together. An IN_QUEUE appointment without a
  //   queue entry (left by an older failed check-in) gets its entry here too.
  // --------------------------------------------------------------------------
  async addToQueue(appointmentId, { client: outer } = {}) {
    const run = async (client) => {
      const appointment = (await client.query(
        `SELECT id, specialty_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, status
         FROM appointments
         WHERE id = $1::integer
         FOR UPDATE`,
        [appointmentId]
      )).rows[0];

      if (!appointment) throw appError(404, "Appointment not found.");

      const existing = (await client.query(
        `SELECT queue_id, status
         FROM queue_entries
         WHERE appointment_id = $1::integer
         LIMIT 1`,
        [appointmentId]
      )).rows[0];

      if (existing) {
        if (appointment.status === "IN_QUEUE" && !FINAL_QUEUE_STATUSES.includes(existing.status)) {
          return { queue_id: existing.queue_id, alreadyQueued: true };
        }
        throw appError(409, "This appointment already has a queue record and can't be queued again.");
      }

      if (!["CONFIRMED", "IN_QUEUE"].includes(appointment.status)) {
        throw appError(400, "Only approved appointments can be added to the queue.");
      }
      if (appointment.date !== manilaToday()) {
        throw appError(400, "Only today's appointments can enter the live queue.");
      }
      if (!appointment.specialty_id) throw appError(400, "Appointment has no specialty assigned.");

      await client.query("LOCK TABLE queue_entries IN SHARE ROW EXCLUSIVE MODE");

      const numberResult = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number
         FROM queue_entries
         WHERE specialty_id = $1::integer
           AND queue_date = $2::date`,
        [appointment.specialty_id, appointment.date]
      );

      const queueNumber = numberResult.rows[0].next_number;

      const insertResult = await client.query(
        `INSERT INTO queue_entries
           (appointment_id, specialty_id, queue_number, queue_date, status)
         VALUES ($1::integer, $2::integer, $3::integer, $4::date, 'WAITING')
         RETURNING queue_id`,
        [appointmentId, appointment.specialty_id, queueNumber, appointment.date]
      );

      await client.query(
        `UPDATE appointments
         SET status = 'IN_QUEUE', updated_at = NOW()
         WHERE id = $1::integer AND status IN ('CONFIRMED', 'IN_QUEUE')`,
        [appointmentId]
      );

      return { queue_id: insertResult.rows[0].queue_id, queue_number: queueNumber, alreadyQueued: false };
    };

    if (outer) return run(outer);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const added = await run(client);
      await client.query("COMMIT");
      const entry = await findEntryById(added.queue_id);
      return { ...entry, alreadyQueued: added.alreadyQueued };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  // --------------------------------------------------------------------------
  // updateStatus
  //   One transaction that locks the queue entry AND its appointment, then:
  //     - repeating the current status is a no-op (nothing is rewritten, so a
  //       double-clicked Done can never touch a paid visit again);
  //     - finished entries (DONE / NO_SHOW / CANCELLED) can't change;
  //     - only QUEUE_TRANSITIONS moves are allowed;
  //     - only today's (Manila) queue can be worked;
  //     - the appointment must still be IN_QUEUE, so a cancelled/no-show/paid
  //       appointment is never revived by an old queue row.
  //   Returns { entry, unchanged }.
  // --------------------------------------------------------------------------
  async updateStatus(queueId, status, notes = null) {
    const nextStatus = normalizeStatus(status);
    if (!VALID_QUEUE_STATUSES.includes(nextStatus)) {
      throw appError(400, `Invalid queue status. Use: ${VALID_QUEUE_STATUSES.join(", ")}`);
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const current = (await client.query(
        `SELECT q.queue_id, q.appointment_id, q.status, TO_CHAR(q.queue_date, 'YYYY-MM-DD') AS queue_date,
                a.status AS appointment_status
           FROM queue_entries q
           JOIN appointments a ON a.id = q.appointment_id
          WHERE q.queue_id = $1::integer
          FOR UPDATE OF q, a`,
        [queueId]
      )).rows[0];

      if (!current) {
        await client.query("ROLLBACK");
        return null;
      }

      if (current.status === nextStatus) {
        await client.query("COMMIT");
        return { entry: await findEntryById(queueId), unchanged: true };
      }

      if (FINAL_QUEUE_STATUSES.includes(current.status)) {
        throw appError(400, "Final queue entries cannot be reopened.");
      }
      if (!(QUEUE_TRANSITIONS[current.status] || []).includes(nextStatus)) {
        throw appError(400, `Cannot change a queue entry from ${current.status} to ${nextStatus}.`);
      }
      if (current.queue_date !== manilaToday()) {
        throw appError(400, "Only today's queue can be updated.");
      }
      if (current.appointment_status !== "IN_QUEUE") {
        throw appError(409, `This patient's appointment is ${current.appointment_status.replace("_", " ").toLowerCase()}, so the queue entry can no longer be served.`);
      }

      await client.query(
        `UPDATE queue_entries
         SET status = $1::varchar,
             notes = COALESCE($2::text, notes),
             called_at = CASE
               WHEN $1::varchar IN ('CALLED', 'IN_PROGRESS') AND called_at IS NULL THEN NOW()
               WHEN $1::varchar = 'WAITING' THEN NULL
               ELSE called_at
             END,
             started_at = CASE
               WHEN $1::varchar = 'IN_PROGRESS' THEN NOW()
               WHEN $1::varchar IN ('WAITING', 'CALLED') THEN NULL
               ELSE started_at
             END,
             completed_at = CASE
               WHEN $1::varchar IN ('DONE', 'NO_SHOW', 'CANCELLED') THEN NOW()
               WHEN $1::varchar IN ('WAITING', 'CALLED', 'IN_PROGRESS', 'SKIPPED') THEN NULL
               ELSE completed_at
             END,
             updated_at = NOW()
         WHERE queue_id = $3::integer`,
        [nextStatus, notes || null, queueId]
      );

      // The appointment only changes when the visit leaves the queue; while the
      // patient is waiting/called/being served it stays IN_QUEUE.
      const appointmentStatus =
        nextStatus === "DONE" ? "FOR_BILLING" : // consultation finished -> awaiting cashier payment
        nextStatus === "NO_SHOW" ? "NO_SHOW" :
        nextStatus === "CANCELLED" ? "CANCELLED" :
        null;

      if (appointmentStatus) {
        await client.query(
          `UPDATE appointments
           SET status = $1::varchar, updated_at = NOW()
           WHERE id = $2::integer AND status = 'IN_QUEUE'`,
          [appointmentStatus, current.appointment_id]
        );
      }

      await client.query("COMMIT");
      return { entry: await findEntryById(queueId), unchanged: false };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  // Enqueue today's (Manila) CONFIRMED appointments that aren't queued yet.
  // Called by the background lifecycle job and the explicit Admin/Frontdesk
  // POST /queue/auto-enqueue — never by a read. Future/past dates are refused.
  async autoEnqueueConfirmed(date = manilaToday()) {
    const targetDate = date || manilaToday();
    if (targetDate !== manilaToday()) {
      throw appError(400, "Only today's confirmed appointments can be added to the queue.");
    }

    const result = await db.query(
      `SELECT id
       FROM appointments
       WHERE status = 'CONFIRMED'
         AND date = $1::date
         AND specialty_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM queue_entries q
           WHERE q.appointment_id = appointments.id
         )
       ORDER BY time ASC, id ASC`,
      [targetDate]
    );

    const added = [];
    const failed = [];

    for (const appointment of result.rows) {
      try {
        const entry = await this.addToQueue(appointment.id);
        added.push(entry);
      } catch (err) {
        failed.push({
          appointment_id: appointment.id,
          message: err.message || "Failed to add appointment to queue.",
        });
      }
    }

    return {
      date: targetDate,
      added,
      added_count: added.length,
      failed,
      failed_count: failed.length,
    };
  },

  // Dashboard "Active Queue": today's live entries whose appointment is still in
  // the queue (same rule as the queue screens and the public display).
  async liveCountToday() {
    const result = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM queue_entries q
         JOIN appointments a ON a.id = q.appointment_id
        WHERE q.queue_date = ${MANILA_TODAY_SQL}
          AND q.status = ANY($1)
          AND a.status = 'IN_QUEUE'`,
      [LIVE_QUEUE_STATUSES]
    );
    return result.rows[0].n;
  },

  // Read-only by design: the public, unauthenticated display must never write.
  // Only live entries of appointments that are still in the queue are shown.
  async getPublicDisplay() {
    const [specs, queue] = await Promise.all([
      db.query(
        `SELECT specialty_id, specialty_name
         FROM specialties
         WHERE COALESCE(is_active, true) = true
         ORDER BY COALESCE(display_order, 0), specialty_name`
      ),
      db.query(
        `SELECT
           q.queue_id,
           q.queue_number,
           q.specialty_id,
           q.status,
           q.called_at,
           COALESCE(
             NULLIF(TRIM(CONCAT_WS(
               ' ',
               p.first_name,
               CASE
                 WHEN NULLIF(TRIM(COALESCE(p.last_name, '')), '') IS NOT NULL
                   THEN LEFT(TRIM(p.last_name), 1) || '.'
                 ELSE NULL
               END
             )), ''),
             p.name
           ) AS patient_name
         FROM queue_entries q
         JOIN appointments a ON q.appointment_id = a.id
         JOIN patients p ON a.patient_id = p.id
         WHERE q.queue_date = ${MANILA_TODAY_SQL}
           AND q.status = ANY($1)
           AND a.status = 'IN_QUEUE'
         ORDER BY
           CASE q.status
             WHEN 'IN_PROGRESS' THEN 1
             WHEN 'CALLED' THEN 2
             ELSE 3
           END,
           q.queue_number ASC`,
        [LIVE_QUEUE_STATUSES]
      ),
    ]);

    return {
      specialties: specs.rows,
      queue: queue.rows,
    };
  },

  // --------------------------------------------------------------------------
  // autoNoShowStale
  //   Resolves stale LIVE-QUEUE entries that were never finished and marks the
  //   patient a NO_SHOW on BOTH the queue entry and the linked appointment,
  //   atomically. This is the missing lifecycle step that let IN_QUEUE
  //   appointments (including nurse-SKIPPED ones) linger in the queue forever.
  //
  //   A non-final entry (not DONE/NO_SHOW/CANCELLED) becomes NO_SHOW when:
  //     * it belongs to a PAST clinic day (queue_date < today), OR
  //     * it was SKIPPED and the patient hasn't returned within skipGraceMinutes, OR
  //     * it is still WAITING/SKIPPED today after the clinic has closed.
  //   CALLED / IN_PROGRESS entries for TODAY are left alone (the patient is
  //   actively being called/seen). Row-locked (FOR UPDATE) so it is safe to run
  //   concurrently with nurse actions and other sweeps.
  //
  //   Returns { settled, appointments: [{ id, booked_by, date, time }] }.
  // --------------------------------------------------------------------------
  async autoNoShowStale({ skipGraceMinutes = 30, clinicCloseHour = 20 } = {}) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const stale = (await client.query(
        `SELECT queue_id, appointment_id
           FROM queue_entries
          WHERE status NOT IN ('DONE', 'NO_SHOW', 'CANCELLED')
            AND (
              queue_date < (NOW() AT TIME ZONE 'Asia/Manila')::date
              OR (status = 'SKIPPED'
                  AND updated_at <= NOW() - ($1::text || ' minutes')::interval)
              OR (queue_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
                  AND status IN ('WAITING', 'SKIPPED')
                  AND (NOW() AT TIME ZONE 'Asia/Manila')::time >= ($2::text || ':00:00')::time)
            )
          FOR UPDATE`,
        [String(skipGraceMinutes), String(clinicCloseHour)]
      )).rows;

      const queueIds = stale.map((s) => s.queue_id);
      const apptIds = [...new Set(stale.map((s) => s.appointment_id).filter(Boolean))];

      if (queueIds.length) {
        await client.query(
          `UPDATE queue_entries
              SET status = 'NO_SHOW', completed_at = NOW(), updated_at = NOW()
            WHERE queue_id = ANY($1::int[])`,
          [queueIds]
        );
      }

      // No-show the linked appointments, plus any orphan IN_QUEUE appointment
      // whose date is already a past clinic day (safety net for data drift).
      const appointments = (await client.query(
        `UPDATE appointments
            SET status = 'NO_SHOW', updated_at = NOW()
          WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW', 'FOR_BILLING')
            AND (
              id = ANY($1::int[])
              OR (status = 'IN_QUEUE'
                  AND date < (NOW() AT TIME ZONE 'Asia/Manila')::date)
            )
          RETURNING id, booked_by,
                    TO_CHAR(date, 'Mon DD, YYYY') AS date,
                    TO_CHAR(time, 'HH12:MI AM') AS time`,
        [apptIds]
      )).rows;

      await client.query("COMMIT");
      return { settled: queueIds.length, appointments };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};

Queue.VALID_QUEUE_STATUSES = VALID_QUEUE_STATUSES;
Queue.FINAL_QUEUE_STATUSES = FINAL_QUEUE_STATUSES;
Queue.LIVE_QUEUE_STATUSES = LIVE_QUEUE_STATUSES;
Queue.QUEUE_TRANSITIONS = QUEUE_TRANSITIONS;

module.exports = Queue;
