const db = require("../../../config/database");
const { manilaToday, manilaDateOf, manilaNowMinuteKey, addDays, isValidDateString } = require("../../../shared/utils/manilaTime");

const SELECT_FIELDS = `
  medication_id, patient_id, created_by, drug_name, dosage, form, instructions,
  frequency_per_day, times_of_day, start_date, end_date, duration_days,
  source, source_result_id, reminders_enabled, status, notes,
  approval_status, approved_by, approved_at, rejection_reason,
  created_at, updated_at
`;

const VALID_STATUS = ["active", "paused", "finished", "archived"];

function cleanText(value, max = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function clampFrequency(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), 12);
}

// Default reminder times for a given frequency, spread across waking hours.
function defaultTimesForFrequency(freq) {
  const presets = {
    1: ["08:00"],
    2: ["08:00", "20:00"],
    3: ["08:00", "14:00", "20:00"],
    4: ["08:00", "12:00", "16:00", "20:00"],
    5: ["07:00", "11:00", "14:00", "17:00", "21:00"],
    6: ["06:00", "10:00", "12:00", "15:00", "18:00", "21:00"],
  };
  if (presets[freq]) return presets[freq];
  // Fallback: evenly space across 07:00–22:00.
  const start = 7 * 60;
  const end = 22 * 60;
  const step = Math.floor((end - start) / Math.max(freq - 1, 1));
  return Array.from({ length: freq }, (_, i) => {
    const mins = freq === 1 ? start : start + step * i;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
}

function normalizeTimes(times, freq) {
  let list = Array.isArray(times) ? times : [];
  list = list
    .map((t) => String(t || "").trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => {
      const [h, m] = t.split(":");
      return `${String(h).padStart(2, "0")}:${m}`;
    });
  // De-dupe + sort
  list = Array.from(new Set(list)).sort();
  if (list.length === 0) return defaultTimesForFrequency(freq);
  return list;
}

const PatientMedication = {
  async findByPatient(patientId, { status = "", search = "" } = {}) {
    const params = [patientId];
    let where = "patient_id = $1 AND deleted_at IS NULL";

    if (status && VALID_STATUS.includes(status)) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (drug_name ILIKE $${params.length} OR instructions ILIKE $${params.length} OR notes ILIKE $${params.length})`;
    }

    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM patient_medications
       WHERE ${where}
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'finished' THEN 2 ELSE 3 END,
         created_at DESC`,
      params
    );
    return result.rows;
  },

  async findOwned(medicationId, patientId) {
    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM patient_medications
       WHERE medication_id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
      [medicationId, patientId]
    );
    return result.rows[0] || null;
  },

  async create(patientId, createdBy, input = {}) {
    const drugName = cleanText(input.drug_name, 160);
    if (!drugName) {
      throw { statusCode: 400, message: "Drug name is required." };
    }

    const freq = clampFrequency(input.frequency_per_day);
    const times = normalizeTimes(input.times_of_day, freq);
    // Defaults to the patient's current day in the clinic's time zone (Manila).
    const startDate = cleanDate(input.start_date) || manilaToday();

    let endDate = cleanDate(input.end_date);
    let durationDays = Number.isFinite(parseInt(input.duration_days, 10)) ? parseInt(input.duration_days, 10) : null;
    if (!endDate && durationDays && durationDays > 0) {
      endDate = addDays(startDate, durationDays - 1);
    }

    const source = ["manual", "ocr", "doctor"].includes(input.source) ? input.source : "manual";

    // A medication the patient adds (manual or OCR) starts PENDING — it does not
    // become an active reminder until a doctor approves it.
    const result = await db.query(
      `INSERT INTO patient_medications
         (patient_id, created_by, drug_name, dosage, form, instructions,
          frequency_per_day, times_of_day, start_date, end_date, duration_days,
          source, source_result_id, reminders_enabled, status, notes, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,'pending')
       RETURNING ${SELECT_FIELDS}`,
      [
        patientId,
        createdBy,
        drugName,
        cleanText(input.dosage, 120),
        cleanText(input.form, 60),
        cleanText(input.instructions, 1000),
        freq,
        JSON.stringify(times),
        startDate,
        endDate,
        durationDays,
        source,
        Number.isFinite(parseInt(input.source_result_id, 10)) ? parseInt(input.source_result_id, 10) : null,
        input.reminders_enabled === false ? false : true,
        "active",
        cleanText(input.notes, 1000),
      ]
    );
    return result.rows[0];
  },

  async updateOwned(medicationId, patientId, input = {}) {
    const existing = await this.findOwned(medicationId, patientId);
    if (!existing) return null;

    const drugName = cleanText(input.drug_name, 160) || existing.drug_name;
    const freq = clampFrequency(input.frequency_per_day ?? existing.frequency_per_day);
    const times = normalizeTimes(
      input.times_of_day !== undefined ? input.times_of_day : existing.times_of_day,
      freq
    );
    const existingStart = manilaDateOf(existing.start_date);
    const startDate = cleanDate(input.start_date) || existingStart || null;

    // Duration and end date follow the same rule as create(): the end date is
    // the explicit one when sent, otherwise start + duration - 1. Sending a
    // blank duration clears an end date that came from a duration.
    const durationSent = input.duration_days !== undefined;
    const parsedDuration = parseInt(input.duration_days, 10);
    const durationDays = durationSent
      ? (Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null)
      : existing.duration_days;
    let endDate;
    if (input.end_date !== undefined) {
      endDate = cleanDate(input.end_date);
    } else if (durationDays && (durationSent || startDate !== existingStart)) {
      endDate = addDays(startDate, durationDays - 1);
    } else if (durationSent && existing.duration_days) {
      endDate = null;
    } else {
      endDate = existing.end_date;
    }

    // A decline pauses the medication (see reject()). Correcting and
    // resubmitting it lifts that pause, so that once a doctor approves it the
    // doses appear in the schedule; it still stays out until then.
    let status = VALID_STATUS.includes(input.status) ? input.status : existing.status;
    if (!VALID_STATUS.includes(input.status) && existing.approval_status === "rejected" && existing.status === "paused") {
      status = "active";
    }

    const result = await db.query(
      `UPDATE patient_medications
         SET drug_name = $1,
             dosage = $2,
             form = $3,
             instructions = $4,
             frequency_per_day = $5,
             times_of_day = $6::jsonb,
             start_date = $7,
             end_date = $8,
             duration_days = $9,
             reminders_enabled = $10,
             status = $11,
             notes = $12,
             approval_status = 'pending',
             approved_by = NULL,
             approved_at = NULL,
             rejection_reason = NULL,
             updated_at = NOW()
       WHERE medication_id = $13 AND patient_id = $14 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}`,
      [
        drugName,
        input.dosage !== undefined ? cleanText(input.dosage, 120) : existing.dosage,
        input.form !== undefined ? cleanText(input.form, 60) : existing.form,
        input.instructions !== undefined ? cleanText(input.instructions, 1000) : existing.instructions,
        freq,
        JSON.stringify(times),
        startDate,
        endDate,
        durationDays,
        input.reminders_enabled !== undefined ? Boolean(input.reminders_enabled) : existing.reminders_enabled,
        status,
        input.notes !== undefined ? cleanText(input.notes, 1000) : existing.notes,
        medicationId,
        patientId,
      ]
    );
    return result.rows[0] || null;
  },

  async setStatus(medicationId, patientId, status) {
    if (!VALID_STATUS.includes(status)) {
      throw { statusCode: 400, message: "Invalid medication status." };
    }
    const result = await db.query(
      `UPDATE patient_medications
         SET status = $1, updated_at = NOW()
       WHERE medication_id = $2 AND patient_id = $3 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}`,
      [status, medicationId, patientId]
    );
    return result.rows[0] || null;
  },

  async softDeleteOwned(medicationId, patientId) {
    const result = await db.query(
      `UPDATE patient_medications
         SET deleted_at = NOW(), status = 'archived', updated_at = NOW()
       WHERE medication_id = $1 AND patient_id = $2 AND deleted_at IS NULL
       RETURNING medication_id`,
      [medicationId, patientId]
    );
    return result.rows[0] || null;
  },

  // --------------------------------------------------------------------------
  // Daily schedule: expand active meds into per-time dose slots for a date,
  // merged with any existing log rows so the UI can show taken/skipped/pending.
  // --------------------------------------------------------------------------
  async getScheduleForDate(patientId, date) {
    const day = cleanDate(date) || manilaToday();

    const medsResult = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM patient_medications
       WHERE patient_id = $1
         AND deleted_at IS NULL
         AND status = 'active'
         AND approval_status = 'approved'
         AND start_date <= $2
         AND (end_date IS NULL OR end_date >= $2)`,
      [patientId, day]
    );

    const logsResult = await db.query(
      `SELECT log_id, medication_id, scheduled_time, status, taken_at, note
       FROM medication_logs
       WHERE patient_id = $1 AND scheduled_date = $2`,
      [patientId, day]
    );

    const logMap = new Map();
    for (const log of logsResult.rows) {
      logMap.set(`${log.medication_id}|${log.scheduled_time}`, log);
    }

    const slots = [];
    for (const med of medsResult.rows) {
      const times = Array.isArray(med.times_of_day) ? med.times_of_day : [];
      for (const time of times) {
        const key = `${med.medication_id}|${time}`;
        const log = logMap.get(key);
        slots.push({
          medication_id: med.medication_id,
          drug_name: med.drug_name,
          dosage: med.dosage,
          form: med.form,
          instructions: med.instructions,
          scheduled_date: day,
          scheduled_time: time,
          status: log?.status || "pending",
          taken_at: log?.taken_at || null,
          log_id: log?.log_id || null,
          note: log?.note || null,
        });
      }
    }

    slots.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
    return { date: day, slots };
  },

  // Record a dose outcome (taken/skipped). Upsert on (medication, date, time).
  // A dose can be recorded only when it is one the daily schedule shows (see
  // getScheduleForDate) and it is already due: the medication is the patient's
  // own, approved by a doctor and active, the date is inside its start/end
  // dates, the time is one of its reminder times, and that date + time is not
  // in the future (Asia/Manila).
  async logDose(patientId, { medication_id, scheduled_date, scheduled_time, status, note }) {
    if (!["taken", "skipped", "pending", "missed"].includes(status)) {
      throw { statusCode: 400, message: "Invalid dose status." };
    }
    const day = cleanDate(scheduled_date);
    const timeMatch = String(scheduled_time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!day || !isValidDateString(day) || !timeMatch) {
      throw { statusCode: 400, message: "Valid scheduled_date and scheduled_time are required." };
    }
    // Same "HH:MM" form the reminder times are stored in.
    const time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
    if (!/^\d+$/.test(String(medication_id ?? "")) || Number(medication_id) > 2147483647) {
      throw { statusCode: 404, message: "Medication not found." };
    }

    // The medication must belong to this patient.
    const owned = await db.query(
      `SELECT status, approval_status, times_of_day,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
         FROM patient_medications
        WHERE medication_id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
      [medication_id, patientId]
    );
    const med = owned.rows[0];
    if (!med) {
      throw { statusCode: 404, message: "Medication not found." };
    }
    if (med.approval_status !== "approved") {
      throw {
        statusCode: 400,
        message: med.approval_status === "rejected"
          ? "This medication was declined by a doctor, so doses can't be recorded for it."
          : "This medication is still waiting for a doctor's review, so doses can't be recorded yet.",
      };
    }
    if (med.status !== "active") {
      throw { statusCode: 400, message: `This medication is ${med.status}, so doses can't be recorded for it.` };
    }
    if ((med.start_date && day < med.start_date) || (med.end_date && day > med.end_date)) {
      throw { statusCode: 400, message: "That date is outside this medication's schedule." };
    }
    const times = Array.isArray(med.times_of_day) ? med.times_of_day : [];
    if (!times.includes(time)) {
      throw { statusCode: 400, message: "That time is not one of this medication's scheduled doses." };
    }
    // A dose that isn't due yet (clinic time, to the minute) can't be recorded
    // as taken or skipped ahead of time.
    if (`${day}T${time}` > manilaNowMinuteKey()) {
      throw { statusCode: 400, message: "This dose isn't due yet. You can record it at or after its scheduled time." };
    }

    // $5 is cast explicitly: it is used both as the varchar `status` value and
    // in a comparison, and Postgres rejects the statement ("inconsistent types
    // deduced for parameter") when it has to guess two different types for it.
    const result = await db.query(
      `INSERT INTO medication_logs
         (medication_id, patient_id, scheduled_date, scheduled_time, status, taken_at, note)
       VALUES ($1,$2,$3,$4,$5::varchar, CASE WHEN $5::varchar = 'taken' THEN NOW() ELSE NULL END, $6)
       ON CONFLICT (medication_id, scheduled_date, scheduled_time)
       DO UPDATE SET
         status = EXCLUDED.status,
         taken_at = CASE WHEN EXCLUDED.status = 'taken' THEN NOW() ELSE NULL END,
         note = EXCLUDED.note,
         updated_at = NOW()
       RETURNING log_id, medication_id, scheduled_date, scheduled_time, status, taken_at, note`,
      [medication_id, patientId, day, time, status, cleanText(note, 300)]
    );
    return result.rows[0];
  },

  // Adherence over a window (default last 30 days): taken / total scheduled.
  async getAdherence(patientId, days = 30) {
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS total_logged,
         COUNT(*) FILTER (WHERE status = 'taken')::int AS taken,
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE status = 'missed')::int AS missed
       FROM medication_logs
       WHERE patient_id = $1
         AND scheduled_date >= ((NOW() AT TIME ZONE 'Asia/Manila')::date - ($2::text || ' days')::interval)`,
      [patientId, String(days)]
    );
    const row = result.rows[0] || {};
    const taken = Number(row.taken || 0);
    const total = Number(row.total_logged || 0);
    return {
      window_days: days,
      total_logged: total,
      taken,
      skipped: Number(row.skipped || 0),
      missed: Number(row.missed || 0),
      adherence_rate: total > 0 ? Math.round((taken / total) * 100) : null,
    };
  },

  // --------------------------------------------------------------------------
  // Doctor review queue: medications a patient submitted that are awaiting
  // approval before they can become active reminders.
  // --------------------------------------------------------------------------
  async findPendingForReview({ search = "" } = {}) {
    const params = [];
    let where = "m.approval_status = 'pending' AND m.deleted_at IS NULL";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (m.drug_name ILIKE $${params.length}
                      OR p.first_name ILIKE $${params.length}
                      OR p.last_name ILIKE $${params.length}
                      OR p.name ILIKE $${params.length})`;
    }
    const result = await db.query(
      `SELECT
         m.medication_id, m.patient_id, m.drug_name, m.dosage, m.form, m.instructions,
         m.frequency_per_day, m.times_of_day, m.start_date, m.end_date, m.duration_days,
         m.source, m.source_result_id, m.status, m.approval_status, m.notes, m.created_at,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
         p.phone AS patient_phone
       FROM patient_medications m
       JOIN patients p ON m.patient_id = p.id
       WHERE ${where}
       ORDER BY m.created_at DESC`,
      params
    );
    return result.rows;
  },

  async approve(medicationId, doctorUserId) {
    const result = await db.query(
      `UPDATE patient_medications
         SET approval_status = 'approved',
             approved_by = $2,
             approved_at = NOW(),
             rejection_reason = NULL,
             updated_at = NOW()
       WHERE medication_id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}, patient_id`,
      [medicationId, doctorUserId]
    );
    return result.rows[0] || null;
  },

  async reject(medicationId, doctorUserId, reason) {
    const result = await db.query(
      `UPDATE patient_medications
         SET approval_status = 'rejected',
             approved_by = $2,
             approved_at = NOW(),
             rejection_reason = $3,
             status = 'paused',
             updated_at = NOW()
       WHERE medication_id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}, patient_id`,
      [medicationId, doctorUserId, cleanText(reason, 500)]
    );
    return result.rows[0] || null;
  },
};

PatientMedication.defaultTimesForFrequency = defaultTimesForFrequency;
PatientMedication.normalizeTimes = normalizeTimes;

module.exports = PatientMedication;
