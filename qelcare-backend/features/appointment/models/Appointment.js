const db = require("../../../config/database");
const Queue = require("../../queue/models/Queue");
const {
  MANILA_NOW_SQL,
  MANILA_TODAY_SQL,
  manilaToday,
  manilaNowMinuteKey,
  isValidDateString,
  isValidTimeString,
} = require("../../../shared/utils/manilaTime");

const VALID_STATUSES = ["PENDING", "CONFIRMED", "IN_QUEUE", "FOR_BILLING", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"];
const VALID_TYPES = ["consultation", "follow_up", "walk_in", "emergency"];
const VALID_BOOKED_FOR = ["self", "other"];
// A doctor/date/time slot is only "taken" once an appointment there is CONFIRMED
// (or has moved past confirmation). PENDING / RESCHEDULED requests do NOT hold the
// slot on purpose, so several patients can request the same slot and the clinic
// picks one at confirmation time. (Must stay in sync with the uq_doctor_datetime
// partial unique index — see database/appointment_slot_confirmed_only.sql.)
const ACTIVE_CONFLICT_STATUSES = ["CONFIRMED", "IN_QUEUE", "FOR_BILLING", "COMPLETED"];
const ACTIVE_VISIBLE_STATUSES = ["PENDING", "CONFIRMED", "IN_QUEUE", "FOR_BILLING", "RESCHEDULED"];
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
// Lost visits. "Appointments Today" (Dashboard and Appointment Management) is
// every appointment on the clinic's current day except these.
const LOST_STATUSES = ["CANCELLED", "NO_SHOW"];
// A patient can hold only one not-yet-finished appointment per date/time, with
// any doctor (a person can't be in two consultations at once). Relatives booked
// by a patient get their own patient record, so they never collide with it.
const PATIENT_ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_QUEUE", "FOR_BILLING", "RESCHEDULED"];
// Only pre-visit appointments can move to another date/time. IN_QUEUE,
// FOR_BILLING and finished visits belong to the queue / billing workflow.
const RESCHEDULABLE_STATUSES = ["PENDING", "CONFIRMED", "RESCHEDULED"];
// pg_advisory_xact_lock namespace for "one booking change per patient at a time".
const PATIENT_LOCK_NAMESPACE = 4201;

// Anti-spam: after a patient CANCELS, they must wait this many seconds before
// they can book or cancel again. Cancelling is the churn signal, so this stops
// rapid book<->cancel spam while leaving legitimate multi-booking and undoing a
// fresh mistake (a first cancel) unaffected. Tunable here in one place.
const PATIENT_ACTION_COOLDOWN_SECONDS = 120;

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function statusLabel(status) {
  return String(status || "").toLowerCase().replace(/_/g, " ");
}

function normalizeType(type) {
  const value = String(type || "consultation").trim().toLowerCase();
  return VALID_TYPES.includes(value) ? value : "consultation";
}

function normalizeBookedFor(value) {
  const normalized = String(value || "self").trim().toLowerCase();
  return VALID_BOOKED_FOR.includes(normalized) ? normalized : "self";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function isPositiveInt(value) {
  return /^[1-9]\d{0,9}$/.test(String(value ?? "").trim()) && Number(value) <= 2147483647;
}

function appointmentMinuteKey(date, time) {
  const dateText = String(date || "").slice(0, 10);
  const timeText = normalizeTime(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return "";
  return `${dateText}T${timeText}`;
}

function isPastManila(date, time) {
  const key = appointmentMinuteKey(date, time);
  if (!key) return false;
  return key <= manilaNowMinuteKey();
}

function assertNotPastManila(date, time, label = "Appointment schedule") {
  if (!appointmentMinuteKey(date, time)) {
    throw { statusCode: 400, message: "Valid date and time are required." };
  }
  if (isPastManila(date, time)) {
    throw { statusCode: 400, message: `${label} must be in the future using Asia/Manila time.` };
  }
}

// Clinic operating hours: 8:00 AM to 8:00 PM (Asia/Manila). Every booking and
// reschedule — patient or staff — must fall inside this window; the live queue
// also closes at 8:00 PM (see queueSweep), so later visits could never be served.
const CLINIC_OPEN_MINUTES = 8 * 60;   // 08:00
const CLINIC_CLOSE_MINUTES = 20 * 60; // 20:00

function assertWithinClinicHours(time) {
  const t = normalizeTime(time);
  if (!/^\d{2}:\d{2}$/.test(t)) {
    throw { statusCode: 400, message: "Valid time is required." };
  }
  const [hour, minute] = t.split(":").map(Number);
  const total = hour * 60 + minute;
  if (total < CLINIC_OPEN_MINUTES || total > CLINIC_CLOSE_MINUTES) {
    throw { statusCode: 400, message: "Clinic hours are 8:00 AM to 8:00 PM. Please choose a time within clinic hours." };
  }
}

// Real calendar date + 24-hour time, in the future (Manila) and inside clinic hours.
function assertValidSchedule(date, time, label = "Appointment schedule") {
  if (!isValidDateString(date)) {
    throw { statusCode: 400, message: "Enter a valid date (YYYY-MM-DD)." };
  }
  if (!isValidTimeString(time)) {
    throw { statusCode: 400, message: "Enter a valid time (HH:MM, 24-hour clock)." };
  }
  assertNotPastManila(date, time, label);
  assertWithinClinicHours(time);
}

async function inTransaction(work) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Serializes booking changes for one patient (create / reschedule / confirm) so
// two parallel requests can't both pass the patient-conflict check.
async function lockPatient(client, patientId) {
  await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [PATIENT_LOCK_NAMESPACE, Number(patientId)]);
}

async function assertNoDoctorConflict({ doctor_id, date, time, excludeId = null }, client = db) {
  const params = [doctor_id, date, time, ACTIVE_CONFLICT_STATUSES];
  let exclude = "";
  if (excludeId) {
    params.push(excludeId);
    exclude = `AND id <> $${params.length}`;
  }

  const conflict = await client.query(
    `SELECT id
     FROM appointments
     WHERE doctor_id = $1
       AND date = $2
       AND time = $3
       AND status = ANY($4)
       ${exclude}
     LIMIT 1`,
    params
  );

  if (conflict.rowCount > 0) {
    throw { statusCode: 409, message: "This time slot is already confirmed for another patient. Please choose a different time." };
  }
}

async function assertNoPatientConflict(client, { patient_id, date, time, excludeId = null, statuses = PATIENT_ACTIVE_STATUSES }) {
  const params = [patient_id, date, time, statuses];
  let exclude = "";
  if (excludeId) {
    params.push(excludeId);
    exclude = `AND id <> $${params.length}`;
  }
  const conflict = await client.query(
    `SELECT id FROM appointments
      WHERE patient_id = $1 AND date = $2 AND time = $3 AND status = ANY($4) ${exclude}
      LIMIT 1`,
    params
  );
  if (conflict.rowCount > 0) {
    throw { statusCode: 409, message: "This patient already has an appointment at this date and time." };
  }
}

// The doctor must be an active Doctor account, the specialty is the doctor's own
// (derived when omitted, rejected when it differs) and the patient record must
// exist and be active. Returns the specialty to store.
async function resolveBookingRelations(client, { patient_id, doctor_id, specialty_id }) {
  if (!isPositiveInt(patient_id)) throw { statusCode: 400, message: "Select a valid patient." };
  if (!isPositiveInt(doctor_id)) throw { statusCode: 400, message: "Select a valid doctor." };
  const hasSpecialty = specialty_id !== undefined && specialty_id !== null && specialty_id !== "";
  if (hasSpecialty && !isPositiveInt(specialty_id)) throw { statusCode: 400, message: "Select a valid specialty." };

  const doctor = (await client.query(
    `SELECT u.user_id, u.status, u.specialty_id, r.role_name, s.is_active AS specialty_active
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN specialties s ON s.specialty_id = u.specialty_id
      WHERE u.user_id = $1`,
    [doctor_id]
  )).rows[0];
  if (!doctor || doctor.role_name !== "Doctor") {
    throw { statusCode: 400, message: "The selected doctor is not a clinic doctor." };
  }
  if (doctor.status === "deactivated") {
    throw { statusCode: 400, message: "The selected doctor's account is deactivated." };
  }
  if (!doctor.specialty_id) {
    throw { statusCode: 400, message: "The selected doctor has no specialty assigned." };
  }
  if (doctor.specialty_active === false) {
    throw { statusCode: 400, message: "The selected doctor's department is not active." };
  }
  if (hasSpecialty && Number(specialty_id) !== Number(doctor.specialty_id)) {
    throw { statusCode: 400, message: "The selected specialty does not match the doctor's specialty." };
  }

  const patient = (await client.query("SELECT id, is_active FROM patients WHERE id = $1", [patient_id])).rows[0];
  if (!patient) throw { statusCode: 400, message: "Patient record not found." };
  if (patient.is_active === false) {
    throw { statusCode: 400, message: "This patient record is inactive. Reactivate it before booking." };
  }

  return { specialty_id: doctor.specialty_id };
}

// "APT-00061", "apt61", "#61" or "61" -> 61 (the reference shown in the UI).
function referenceId(search) {
  const match = String(search || "").trim().match(/^(?:apt-?|#)?0*(\d{1,9})$/i);
  return match ? Number(match[1]) : null;
}

function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const BASE_SELECT = `
  SELECT
    a.*,
    a.time::text AS time,
    TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
    p.phone AS patient_phone,
    p.email AS patient_email,
    p.gender AS patient_gender,
    p.date_of_birth,
    p.age AS patient_age,
    bu.email AS booked_by_email,
    bur.role_name AS booked_by_role,
    TRIM(CONCAT_WS(' ', bu.first_name, bu.last_name)) AS booked_by_name,
    u.first_name AS doctor_first_name,
    u.last_name AS doctor_last_name,
    TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS doctor_name,
    u.email AS doctor_email,
    s.specialty_name,
    s.slug AS specialty_slug,
    ((a.date + a.time) <= ${MANILA_NOW_SQL}) AS is_past,
    (
      a.status IN ('COMPLETED','CANCELLED','NO_SHOW')
      OR (
        -- Pre-visit requests only. IN_QUEUE / FOR_BILLING mean the patient is
        -- physically mid-visit (in the queue / awaiting payment); they stay
        -- active until a terminal status and are never aged into history by the
        -- clock, so the patient's live visit-progress bar keeps advancing.
        a.status IN ('PENDING','CONFIRMED','RESCHEDULED')
        AND (a.date + a.time) <= ${MANILA_NOW_SQL}
      )
    ) AS is_history,
    latest_mr.record_id AS latest_record_id,
    latest_mr.diagnosis AS latest_diagnosis,
    latest_mr.lab_requests AS requested_services,
    latest_mr.lab_requests AS lab_requests
  FROM appointments a
  JOIN patients p ON a.patient_id = p.id
  JOIN users u ON a.doctor_id = u.user_id
  LEFT JOIN users bu ON a.booked_by = bu.user_id
  LEFT JOIN roles bur ON bu.role_id = bur.role_id
  LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
  LEFT JOIN LATERAL (
    SELECT mr.record_id, mr.diagnosis, mr.lab_requests, mr.visit_date, mr.created_at
    FROM medical_records mr
    WHERE mr.appointment_id = a.id
    ORDER BY COALESCE(mr.visit_date, (mr.created_at AT TIME ZONE 'Asia/Manila')::date) DESC, mr.record_id DESC
    LIMIT 1
  ) latest_mr ON true
`;

const Appointment = {
  async create({
    patient_id,
    doctor_id,
    specialty_id,
    date,
    time,
    type,
    chief_complaint,
    notes,
    booked_by,
    booked_for = "self",
    booked_for_relationship = null,
  }) {
    assertValidSchedule(date, time);
    if (!isPositiveInt(patient_id)) throw { statusCode: 400, message: "Select a valid patient." };

    const id = await inTransaction(async (client) => {
      await lockPatient(client, patient_id);
      const relations = await resolveBookingRelations(client, { patient_id, doctor_id, specialty_id });
      await assertNoDoctorConflict({ doctor_id, date, time }, client);
      await assertNoPatientConflict(client, { patient_id, date, time });

      try {
        const result = await client.query(
          `INSERT INTO appointments
            (patient_id, doctor_id, specialty_id, date, time, type, chief_complaint, notes, booked_by, booked_for, booked_for_relationship, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING')
           RETURNING id`,
          [
            patient_id,
            doctor_id,
            relations.specialty_id,
            date,
            time,
            normalizeType(type),
            chief_complaint || null,
            notes || null,
            booked_by || null,
            normalizeBookedFor(booked_for),
            booked_for_relationship || null,
          ]
        );
        return result.rows[0].id;
      } catch (err) {
        // uq_doctor_datetime is the authoritative guard against two bookings
        // racing past assertNoDoctorConflict — surface a 409, not a 500.
        if (err.code === "23505" && err.constraint === "uq_doctor_datetime") {
          throw { statusCode: 409, message: "Doctor already has an active appointment at this time." };
        }
        throw err;
      }
    });

    return this.findById(id);
  },

  async findAll({
    role,
    userId,
    status,
    date,
    date_from,
    date_to,
    specialty_id,
    doctor_id,
    patient_id,
    search,
    scope,
    page = 1,
    limit = 20,
  } = {}) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    const params = [];
    const conditions = [];

    if (role === "Doctor") {
      params.push(userId);
      conditions.push(`a.doctor_id = $${params.length}`);
    } else if (role === "Patient") {
      params.push(userId);
      conditions.push(`(p.user_id = $${params.length} OR a.booked_by = $${params.length})`);
    }

    // One status or a comma-separated group (e.g. "CANCELLED,NO_SHOW").
    const statuses = String(status || "").split(",").map(normalizeStatus).filter(Boolean);
    if (statuses.length) {
      params.push(statuses);
      conditions.push(`a.status = ANY($${params.length})`);
    }
    if (date) {
      params.push(date);
      conditions.push(`a.date = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`a.date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`a.date <= $${params.length}`);
    }
    if (specialty_id) {
      params.push(specialty_id);
      conditions.push(`a.specialty_id = $${params.length}`);
    }
    if (doctor_id) {
      params.push(doctor_id);
      conditions.push(`a.doctor_id = $${params.length}`);
    }
    if (patient_id) {
      params.push(patient_id);
      conditions.push(`a.patient_id = $${params.length}`);
    }
    if (scope === "active") {
      params.push(ACTIVE_VISIBLE_STATUSES);
      conditions.push(`a.status = ANY($${params.length}) AND (a.date + a.time) > ${MANILA_NOW_SQL}`);
    }
    if (scope === "history") {
      params.push(TERMINAL_STATUSES);
      // IN_QUEUE / FOR_BILLING are mid-visit (still active), so history is only
      // terminal statuses or pre-visit requests whose scheduled time has passed.
      conditions.push(`(a.status = ANY($${params.length}) OR (a.status = ANY('{PENDING,CONFIRMED,RESCHEDULED}'::varchar[]) AND (a.date + a.time) <= ${MANILA_NOW_SQL}))`);
    }
    const searchText = String(search || "").trim();
    if (searchText) {
      params.push(`%${escapeLike(searchText)}%`);
      const like = `$${params.length}`;
      const refId = referenceId(searchText);
      let refMatch = "";
      if (refId) {
        params.push(refId);
        refMatch = `a.id = $${params.length} OR`;
      }
      conditions.push(`(
        ${refMatch}
        p.name ILIKE ${like} OR
        p.first_name ILIKE ${like} OR
        p.last_name ILIKE ${like} OR
        CONCAT_WS(' ', p.first_name, p.last_name) ILIKE ${like} OR
        p.phone ILIKE ${like} OR
        u.first_name ILIKE ${like} OR
        u.last_name ILIKE ${like} OR
        CONCAT_WS(' ', u.first_name, u.last_name) ILIKE ${like} OR
        bu.first_name ILIKE ${like} OR
        bu.last_name ILIKE ${like} OR
        s.specialty_name ILIKE ${like} OR
        a.chief_complaint ILIKE ${like} OR
        a.notes ILIKE ${like} OR
        CAST(a.id AS TEXT) ILIKE ${like}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const dataParams = [...params, safeLimit, offset];

    const orderSql = `
      ORDER BY
        CASE
          WHEN a.status IN ('PENDING','CONFIRMED','IN_QUEUE','RESCHEDULED') AND (a.date + a.time) > ${MANILA_NOW_SQL} THEN 0
          ELSE 1
        END ASC,
        CASE a.status
          WHEN 'IN_QUEUE' THEN 0
          WHEN 'FOR_BILLING' THEN 1
          WHEN 'CONFIRMED' THEN 2
          WHEN 'PENDING' THEN 3
          WHEN 'RESCHEDULED' THEN 4
          WHEN 'COMPLETED' THEN 5
          WHEN 'CANCELLED' THEN 6
          WHEN 'NO_SHOW' THEN 7
          ELSE 9
        END ASC,
        CASE WHEN a.status IN ('PENDING','CONFIRMED','IN_QUEUE','RESCHEDULED') AND (a.date + a.time) > ${MANILA_NOW_SQL} THEN a.date END ASC NULLS LAST,
        CASE WHEN a.status IN ('PENDING','CONFIRMED','IN_QUEUE','RESCHEDULED') AND (a.date + a.time) > ${MANILA_NOW_SQL} THEN a.time END ASC NULLS LAST,
        CASE WHEN a.status NOT IN ('PENDING','CONFIRMED','IN_QUEUE','RESCHEDULED') OR (a.date + a.time) <= ${MANILA_NOW_SQL} THEN a.date END DESC NULLS LAST,
        CASE WHEN a.status NOT IN ('PENDING','CONFIRMED','IN_QUEUE','RESCHEDULED') OR (a.date + a.time) <= ${MANILA_NOW_SQL} THEN a.time END DESC NULLS LAST,
        a.id DESC`;

    const selectSql = `${BASE_SELECT} ${where} ${orderSql} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.doctor_id = u.user_id
      LEFT JOIN users bu ON a.booked_by = bu.user_id
      LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
      ${where}`;

    const [dataResult, countResult] = await Promise.all([
      db.query(selectSql, dataParams),
      db.query(countSql, params),
    ]);

    const total = countResult.rows[0]?.count || 0;
    return {
      data: dataResult.rows,
      appointments: dataResult.rows,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  },

  // Today's (Manila) appointment counts. The single definition behind the Admin
  // Dashboard cards and the Appointment Management "Today" card:
  //   active = every status except the lost ones (CANCELLED, NO_SHOW).
  async todayCounts() {
    const result = await db.query(
      `SELECT status, COUNT(*)::int AS n
         FROM appointments
        WHERE date = ${MANILA_TODAY_SQL}
        GROUP BY status`
    );
    const byStatus = Object.fromEntries(VALID_STATUSES.map((s) => [s, 0]));
    for (const row of result.rows) byStatus[row.status] = row.n;
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const lost = LOST_STATUSES.reduce((sum, s) => sum + (byStatus[s] || 0), 0);
    return { total, active: total - lost, completed: byStatus.COMPLETED, by_status: byStatus };
  },

  // Whole-dataset counts for the Appointment Management cards (never limited to
  // the page that happens to be loaded).
  async stats() {
    const [all, today] = await Promise.all([
      db.query("SELECT status, COUNT(*)::int AS n FROM appointments GROUP BY status"),
      this.todayCounts(),
    ]);
    const byStatus = Object.fromEntries(VALID_STATUSES.map((s) => [s, 0]));
    for (const row of all.rows) byStatus[row.status] = row.n;
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    return {
      total,
      by_status: byStatus,
      lost: LOST_STATUSES.reduce((sum, s) => sum + (byStatus[s] || 0), 0),
      today,
    };
  },

  async findById(id) {
    const result = await db.query(`${BASE_SELECT} WHERE a.id = $1`, [id]);
    return result.rows[0] || null;
  },

  async getRawById(id) {
    const result = await db.query("SELECT *, time::text AS time, TO_CHAR(date, 'YYYY-MM-DD') AS date FROM appointments WHERE id = $1", [id]);
    return result.rows[0] || null;
  },

  async updateStatus(id, status, { cancelled_by = null, cancel_reason = null } = {}) {
    const nextStatus = normalizeStatus(status);
    if (!VALID_STATUSES.includes(nextStatus)) {
      throw { statusCode: 400, message: `Invalid status. Use: ${VALID_STATUSES.join(", ")}` };
    }

    const result = await db.query(
      `UPDATE appointments
       SET status = $1::varchar,
           cancelled_by = CASE WHEN $1::varchar = 'CANCELLED' THEN $2::integer ELSE cancelled_by END,
           cancel_reason = CASE WHEN $1::varchar = 'CANCELLED' THEN $3::text ELSE cancel_reason END,
           updated_at = NOW()
       WHERE id = $4::integer
       RETURNING id`,
      [nextStatus, cancelled_by, cancel_reason || null, id]
    );

    if (!result.rows[0]) return null;
    return this.findById(result.rows[0].id);
  },

  // --------------------------------------------------------------------------
  // confirm
  //   Confirm a PENDING / RESCHEDULED appointment and claim its slot. Because
  //   PENDING requests don't hold a slot, several patients may have requested the
  //   same doctor/date/time — confirmation is what locks it in. In ONE
  //   transaction:
  //     1. Lock the row and re-check it is still pending and not in the past.
  //     2. For a same-day visit, check it can actually be queued (specialty)
  //        BEFORE changing anything.
  //     3. Flip it to CONFIRMED. The uq_doctor_datetime partial unique index
  //        guarantees at most one confirmed appointment per slot; a lost race
  //        surfaces as a clean 409.
  //     4. Same-day: create the queue entry and move it to IN_QUEUE. If that
  //        fails, the whole confirmation rolls back.
  //   Afterwards every OTHER still-pending request for that exact slot is
  //   auto-declined (CANCELLED with a clear reason) so double-booking is
  //   impossible. Returns { appointment, declined, queueEntry }.
  // --------------------------------------------------------------------------
  async confirmAndDeclineConflicts(id, confirmedBy) {
    const { slot, queued } = await inTransaction(async (client) => {
      const current = (await client.query(
        `SELECT id, doctor_id, patient_id, specialty_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, time::text AS time, status
           FROM appointments
          WHERE id = $1::integer
          FOR UPDATE`,
        [id]
      )).rows[0];

      if (!current) throw { statusCode: 404, message: "Appointment not found." };
      if (!["PENDING", "RESCHEDULED"].includes(current.status)) {
        throw { statusCode: 400, message: `Only a pending appointment can be confirmed (this one is ${statusLabel(current.status)}).` };
      }
      if (isPastManila(current.date, current.time)) {
        throw { statusCode: 400, message: "This appointment is in the past. It can only be settled as No Show or Cancelled." };
      }
      const sameDay = current.date === manilaToday();
      if (sameDay && !current.specialty_id) {
        throw { statusCode: 400, message: "Appointment has no specialty assigned, so it can't enter today's queue. Cancel it and book it again with the doctor's specialty." };
      }

      await lockPatient(client, current.patient_id);
      await assertNoPatientConflict(client, {
        patient_id: current.patient_id,
        date: current.date,
        time: current.time,
        excludeId: current.id,
        statuses: ["CONFIRMED", "IN_QUEUE", "FOR_BILLING"],
      });

      try {
        await client.query(
          `UPDATE appointments SET status = 'CONFIRMED', updated_at = NOW() WHERE id = $1::integer`,
          [id]
        );
      } catch (err) {
        if (err.code === "23505" && err.constraint === "uq_doctor_datetime") {
          throw { statusCode: 409, message: "This time slot has already been confirmed for another patient." };
        }
        throw err;
      }

      const entry = sameDay ? await Queue.addToQueue(id, { client }) : null;
      return {
        slot: { doctor_id: current.doctor_id, date: current.date, time: current.time },
        queued: entry,
      };
    });

    // The slot is now locked to the confirmed appointment. Decline the other
    // still-pending requests for the same slot. Done as a separate statement so
    // it can't deadlock against a concurrent confirm of one of those very rows.
    let declined = [];
    try {
      declined = (await db.query(
        `UPDATE appointments
            SET status = 'CANCELLED',
                cancelled_by = $4::integer,
                cancel_reason = 'This time slot was confirmed for another patient.',
                updated_at = NOW()
          WHERE doctor_id = $1::integer
            AND date = $2::date
            AND time = $3::time
            AND id <> $5::integer
            AND status IN ('PENDING', 'RESCHEDULED')
          RETURNING id, booked_by, patient_id`,
        [slot.doctor_id, slot.date, slot.time, confirmedBy, id]
      )).rows;
    } catch (err) {
      console.error("Auto-decline conflicting requests error:", err.message);
    }

    const appointment = await this.findById(id);
    const queueEntry = queued ? await Queue.findById(queued.queue_id) : null;
    return { appointment, declined, queueEntry };
  },

  // Check in a CONFIRMED appointment for today: queue entry + IN_QUEUE happen in
  // one transaction, so a failed check-in never leaves the appointment IN_QUEUE.
  async checkIn(id) {
    const queued = await inTransaction(async (client) => {
      const current = (await client.query(
        `SELECT id, specialty_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, time::text AS time, status
           FROM appointments WHERE id = $1::integer FOR UPDATE`,
        [id]
      )).rows[0];
      if (!current) throw { statusCode: 404, message: "Appointment not found." };
      if (current.status !== "CONFIRMED") {
        throw { statusCode: 400, message: `Only a confirmed appointment can be checked in (this one is ${statusLabel(current.status)}).` };
      }
      if (current.date !== manilaToday()) {
        throw { statusCode: 400, message: "Only today's confirmed appointments can enter the live queue." };
      }
      if (!current.specialty_id) {
        throw { statusCode: 400, message: "Appointment has no specialty assigned, so it can't enter today's queue." };
      }
      return Queue.addToQueue(id, { client });
    });
    return {
      appointment: await this.findById(id),
      queueEntry: await Queue.findById(queued.queue_id),
    };
  },

  // --------------------------------------------------------------------------
  // closeAppointment
  //   Move an appointment to CANCELLED or NO_SHOW atomically, together with its
  //   queue entry: an active entry (WAITING/CALLED/IN_PROGRESS/SKIPPED) is closed
  //   with the same status in the same transaction, so a cancelled/no-show
  //   patient can never stay in (or be served from) the live queue.
  //   allowedFrom  statuses this call may close
  //   requirePast  NO_SHOW settles only once the scheduled time has passed
  // --------------------------------------------------------------------------
  async closeAppointment(id, status, { actorId = null, reason = null, allowedFrom = [], requirePast = false } = {}) {
    const nextStatus = normalizeStatus(status);
    if (!["CANCELLED", "NO_SHOW"].includes(nextStatus)) {
      throw { statusCode: 400, message: "Appointments can only be closed as Cancelled or No Show." };
    }
    const cancelReason = String(reason || "").trim();

    const { fromStatus } = await inTransaction(async (client) => {
      const current = (await client.query(
        `SELECT id, status, TO_CHAR(date, 'YYYY-MM-DD') AS date, time::text AS time
           FROM appointments WHERE id = $1::integer FOR UPDATE`,
        [id]
      )).rows[0];
      if (!current) throw { statusCode: 404, message: "Appointment not found." };

      if (TERMINAL_STATUSES.includes(current.status)) {
        throw { statusCode: 400, message: `Appointment is already ${statusLabel(current.status)}.` };
      }
      if (current.status === "FOR_BILLING") {
        throw { statusCode: 400, message: "This visit is awaiting payment. It can't be cancelled or marked No Show." };
      }
      if (!allowedFrom.includes(current.status)) {
        if (current.status === "IN_QUEUE") {
          throw { statusCode: 400, message: "An in-queue visit is completed through the queue/consultation workflow, not settled here." };
        }
        throw { statusCode: 400, message: `Cannot change appointment from ${current.status} to ${nextStatus}.` };
      }
      const past = isPastManila(current.date, current.time);
      if (requirePast && !past) {
        throw { statusCode: 400, message: "This appointment is not in the past. Use the normal status actions." };
      }
      if (nextStatus === "CANCELLED" && !cancelReason) {
        throw { statusCode: 400, message: "Cancellation reason is required." };
      }

      await client.query(
        `UPDATE appointments
            SET status = $1::varchar,
                cancelled_by = CASE WHEN $1::varchar = 'CANCELLED' THEN $2::integer ELSE cancelled_by END,
                cancel_reason = CASE
                                  WHEN $1::varchar = 'CANCELLED' THEN $3::text
                                  WHEN $1::varchar = 'NO_SHOW' THEN COALESCE(cancel_reason, 'Auto/closed: patient did not show.')
                                  ELSE cancel_reason
                                END,
                updated_at = NOW()
          WHERE id = $4::integer`,
        [nextStatus, actorId, cancelReason || null, id]
      );

      await client.query(
        `UPDATE queue_entries
            SET status = $1::varchar, completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
          WHERE appointment_id = $2::integer
            AND status NOT IN ('DONE', 'NO_SHOW', 'CANCELLED')`,
        [nextStatus, id]
      );

      return { fromStatus: current.status };
    });

    return { appointment: await this.findById(id), fromStatus };
  },

  async reschedule(id, { date, time }) {
    if (!date || !time) {
      throw { statusCode: 400, message: "New date and time are required." };
    }
    assertValidSchedule(date, time, "New appointment schedule");

    await inTransaction(async (client) => {
      const current = (await client.query(
        "SELECT *, time::text AS time, TO_CHAR(date, 'YYYY-MM-DD') AS date FROM appointments WHERE id = $1 FOR UPDATE",
        [id]
      )).rows[0];
      if (!current) throw { statusCode: 404, message: "Appointment not found." };
      if (current.status === "FOR_BILLING") {
        throw { statusCode: 400, message: "This visit is awaiting payment and can't be rescheduled." };
      }
      if (!RESCHEDULABLE_STATUSES.includes(current.status)) {
        throw { statusCode: 400, message: `Cannot reschedule an appointment with status ${current.status}.` };
      }
      if (isPastManila(current.date, current.time)) {
        throw { statusCode: 400, message: "Past appointments are history and cannot be rescheduled." };
      }
      const queued = await client.query("SELECT 1 FROM queue_entries WHERE appointment_id = $1", [id]);
      if (queued.rowCount > 0) {
        throw { statusCode: 400, message: "This appointment already has a queue record, so it can't be moved. Cancel it and book a new appointment instead." };
      }

      await lockPatient(client, current.patient_id);
      await assertNoDoctorConflict({ doctor_id: current.doctor_id, date, time, excludeId: id }, client);
      await assertNoPatientConflict(client, { patient_id: current.patient_id, date, time, excludeId: id });

      const nextNotes = current.notes
        ? `${current.notes}\nRescheduled from ${current.date} ${current.time}.`
        : `Rescheduled from ${current.date} ${current.time}.`;

      try {
        await client.query(
          `UPDATE appointments
           SET date = $1,
               time = $2,
               status = 'PENDING',
               notes = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [date, time, nextNotes, id]
        );
      } catch (err) {
        if (err.code === "23505" && err.constraint === "uq_doctor_datetime") {
          throw { statusCode: 409, message: "Doctor already has an active appointment at this time." };
        }
        throw err;
      }
    });

    return this.findById(id);
  },

  async getTodayByDoctor(doctorId) {
    const result = await db.query(
      `${BASE_SELECT}
       WHERE a.doctor_id = $1
         AND a.date = ${MANILA_TODAY_SQL}
         AND a.status NOT IN ('CANCELLED','NO_SHOW')
       ORDER BY a.time ASC`,
      [doctorId]
    );
    return result.rows;
  },

  // --------------------------------------------------------------------------
  // settlePastById
  //   Settle a SINGLE past, pre-visit appointment into a terminal state.
  //   Allowed targets: NO_SHOW (patient never came) or CANCELLED (with reason).
  //   Only PENDING / CONFIRMED / RESCHEDULED can be settled: an IN_QUEUE visit
  //   belongs to the queue/consultation workflow and a FOR_BILLING visit to the
  //   cashier. Returns the refreshed appointment.
  // --------------------------------------------------------------------------
  async settlePastById(id, status, { cancelled_by = null, cancel_reason = null } = {}) {
    const nextStatus = normalizeStatus(status);
    if (!["NO_SHOW", "CANCELLED"].includes(nextStatus)) {
      throw { statusCode: 400, message: "Past appointments can only be settled as NO_SHOW or CANCELLED." };
    }
    const { appointment } = await this.closeAppointment(id, nextStatus, {
      actorId: cancelled_by,
      reason: cancel_reason,
      allowedFrom: ["PENDING", "CONFIRMED", "RESCHEDULED"],
      requirePast: true,
    });
    return appointment;
  },

  // --------------------------------------------------------------------------
  // autoSettlePastAppointments
  //   Bulk sweep: any PENDING / CONFIRMED / RESCHEDULED appointment whose
  //   scheduled datetime has passed by more than `graceMinutes` is rolled to
  //   NO_SHOW so it can never sit in limbo. IN_QUEUE is intentionally excluded
  //   (the patient arrived; the doctor closes it). Returns the count settled.
  //   Idempotent and safe to run on an interval.
  // --------------------------------------------------------------------------
  async autoSettlePastAppointments({ graceMinutes = 120 } = {}) {
    const result = await db.query(
      `UPDATE appointments
          SET status = 'NO_SHOW',
              cancel_reason = COALESCE(cancel_reason, 'Auto-closed: appointment time passed without check-in.'),
              updated_at = NOW()
        WHERE status IN ('PENDING','CONFIRMED','RESCHEDULED')
          AND (date + time) <= (${MANILA_NOW_SQL} - ($1::text || ' minutes')::interval)
        RETURNING id`,
      [String(graceMinutes)]
    );
    return { settled: result.rowCount, ids: result.rows.map((r) => r.id) };
  },

  // --------------------------------------------------------------------------
  // assertAppointmentCooldown
  //   Anti-spam guard for patient self-service. If the patient cancelled an
  //   appointment within PATIENT_ACTION_COOLDOWN_SECONDS, block the next booking
  //   OR cancellation and tell them how long to wait. Uses the DB clock (no
  //   client clock skew). A patient who has never cancelled is never blocked.
  // --------------------------------------------------------------------------
  async assertAppointmentCooldown(userId) {
    const { rows } = await db.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(updated_at)))::int AS elapsed
         FROM appointments
        WHERE cancelled_by = $1::integer AND status = 'CANCELLED'`,
      [userId]
    );
    const elapsed = rows[0]?.elapsed;
    if (elapsed !== null && elapsed !== undefined && elapsed < PATIENT_ACTION_COOLDOWN_SECONDS) {
      const wait = PATIENT_ACTION_COOLDOWN_SECONDS - elapsed;
      throw {
        statusCode: 429,
        message: `You recently cancelled an appointment. Please wait ${wait} more second${wait === 1 ? "" : "s"} before booking or cancelling again.`,
      };
    }
  },

  // --------------------------------------------------------------------------
  // cancelByPatient
  //   Atomically cancel a patient's OWN appointment. The row is locked with
  //   SELECT ... FOR UPDATE and all rules are re-checked on the locked row
  //   inside the transaction, so two simultaneous cancel requests can't both go
  //   through: the first cancels, the second waits for the lock, then sees the
  //   already-CANCELLED row and returns a clean error instead of double-firing
  //   notifications/logs or corrupting state. Returns the fresh appointment.
  // --------------------------------------------------------------------------
  async cancelByPatient(id, userId, reason) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const current = (await client.query(
        `SELECT id, booked_by, status, TO_CHAR(date, 'YYYY-MM-DD') AS date, time::text AS time
           FROM appointments
          WHERE id = $1::integer
          FOR UPDATE`,
        [id]
      )).rows[0];

      if (!current) throw { statusCode: 404, message: "Appointment not found." };
      if (Number(current.booked_by) !== Number(userId)) {
        throw { statusCode: 403, message: "You can only cancel your own appointments." };
      }
      if (TERMINAL_STATUSES.includes(current.status)) {
        throw { statusCode: 400, message: `This appointment is already ${current.status.toLowerCase().replace("_", " ")}.` };
      }
      if (isPastManila(current.date, current.time)) {
        throw { statusCode: 400, message: "This appointment time has already passed. Please contact the clinic." };
      }
      if (!["PENDING", "RESCHEDULED"].includes(current.status)) {
        throw { statusCode: 400, message: "This appointment is already confirmed by the clinic. To change or cancel it, please call the clinic at (02) 8842-5405." };
      }

      await client.query(
        `UPDATE appointments
            SET status = 'CANCELLED',
                cancelled_by = $2::integer,
                cancel_reason = $3::text,
                updated_at = NOW()
          WHERE id = $1::integer`,
        [id, userId, reason]
      );

      await client.query("COMMIT");
      const appointment = await this.findById(id);
      return { appointment, fromStatus: current.status };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  // NOTE: the FOR_BILLING -> COMPLETED flip now happens inside Billing.create's
  // transaction (features/billing/models/Billing.js), atomically with payment.
};

Appointment.VALID_STATUSES = VALID_STATUSES;
Appointment.VALID_TYPES = VALID_TYPES;
Appointment.ACTIVE_VISIBLE_STATUSES = ACTIVE_VISIBLE_STATUSES;
Appointment.TERMINAL_STATUSES = TERMINAL_STATUSES;
Appointment.LOST_STATUSES = LOST_STATUSES;
Appointment.isPastManila = isPastManila;
Appointment.assertNotPastManila = assertNotPastManila;
Appointment.assertWithinClinicHours = assertWithinClinicHours;
Appointment.assertValidSchedule = assertValidSchedule;
Appointment.isPositiveInt = isPositiveInt;

module.exports = Appointment;
