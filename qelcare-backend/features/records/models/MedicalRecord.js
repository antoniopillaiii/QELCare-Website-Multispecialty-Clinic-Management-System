const db = require("../../../config/database");
const { manilaToday, isValidDateString } = require("../../../shared/utils/manilaTime");
const { isPositiveInt, escapeLike } = require("../../../shared/utils/requestValidation");

const CLINICAL_FIELDS = [
  "visit_date",
  "chief_complaint",
  "history_of_illness",
  "physical_exam",
  "diagnosis",
  "treatment_plan",
  "prescriptions",
  "lab_requests",
  "doctor_notes",
  "follow_up_date",
  "follow_up_notes",
  "is_confidential",
];

// What a doctor may change on an existing record. Patient, doctor and author
// are fixed at creation.
const EDITABLE_FIELDS = ["appointment_id", "vital_id", ...CLINICAL_FIELDS];
const TEXT_FIELDS = CLINICAL_FIELDS.filter((key) => !key.includes("date") && key !== "is_confidential");

function appError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function recordRef(id) {
  return `MR-${String(id).padStart(5, "0")}`;
}

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

// ---- Strict input parsing: malformed values are a 400, never a DB error or a
// silent conversion to some other valid value. ----------------------------

function parseText(value, label) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" && typeof value !== "number") throw appError(400, `Invalid ${label}.`);
  return cleanText(value);
}

function parseLinkId(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isPositiveInt(value)) throw appError(400, `Invalid ${label}.`);
  return Number(value);
}

function parseDate(value, label) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!isValidDateString(text)) throw appError(400, `Invalid ${label}. Use YYYY-MM-DD.`);
  return text;
}

const TRUE_VALUES = [true, "true", 1, "1"];
const FALSE_VALUES = [false, "false", 0, "0"];

function parseConfidential(value) {
  if (value === undefined) return undefined;
  if (TRUE_VALUES.includes(value)) return true;
  if (FALSE_VALUES.includes(value)) return false;
  throw appError(400, "is_confidential must be true or false.");
}

const FIELD_LABELS = {
  appointment_id: "appointment",
  vital_id: "vitals record",
  visit_date: "visit date",
  follow_up_date: "follow-up date",
};

function labelOf(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, " ");
}

// Parses only the editable fields present in `input` (undefined = not sent).
function parseFields(input = {}) {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (input[key] === undefined) continue;
    if (key === "appointment_id" || key === "vital_id") out[key] = parseLinkId(input[key], labelOf(key));
    else if (key === "visit_date" || key === "follow_up_date") out[key] = parseDate(input[key], labelOf(key));
    else if (key === "is_confidential") out[key] = parseConfidential(input[key]);
    else out[key] = parseText(input[key], labelOf(key));
  }
  return out;
}

// Rules the doctor's consultation form already follows: a record documents a
// visit that happened ("Save diagnosis ... after consultation"), so it needs a
// diagnosis, the visit date can't be in the (Manila) future, and a follow-up
// can't come before the visit.
function checkClinicalRules(record) {
  if (!record.diagnosis) throw appError(400, "Diagnosis is required.");
  if (!record.visit_date) throw appError(400, "Visit date is required.");
  if (record.visit_date > manilaToday()) throw appError(400, "Visit date can't be in the future.");
  if (record.follow_up_date && record.follow_up_date < record.visit_date) {
    throw appError(400, "Follow-up date can't be before the visit date.");
  }
}

// A record may only point at clinical data of its own patient, and at an
// appointment of the authoring doctor (doctors can only see their own
// appointments). One record per appointment. Runs inside the caller's
// transaction; the appointment row lock serializes concurrent writers.
async function checkLinks(client, { patientId, doctorId, appointmentId, vitalId, recordId = null }) {
  if (appointmentId) {
    const appointment = (await client.query(
      "SELECT id, patient_id, doctor_id FROM appointments WHERE id = $1 FOR UPDATE",
      [appointmentId]
    )).rows[0];
    if (!appointment) throw appError(404, "Appointment not found.");
    if (Number(appointment.patient_id) !== Number(patientId)) {
      throw appError(400, "That appointment belongs to a different patient.");
    }
    if (doctorId && Number(appointment.doctor_id) !== Number(doctorId)) {
      throw appError(403, "You can only write records for your own appointments.");
    }
    const existing = (await client.query(
      "SELECT record_id FROM medical_records WHERE appointment_id = $1 AND ($2::int IS NULL OR record_id <> $2::int) LIMIT 1",
      [appointmentId, recordId]
    )).rows[0];
    if (existing) {
      throw appError(409, `This appointment already has a medical record (${recordRef(existing.record_id)}). Update that record instead.`);
    }
  }
  if (vitalId) {
    const vital = (await client.query("SELECT id, patient_id FROM vitals WHERE id = $1", [vitalId])).rows[0];
    if (!vital) throw appError(404, "Vitals record not found.");
    if (Number(vital.patient_id) !== Number(patientId)) {
      throw appError(400, "Those vitals belong to a different patient.");
    }
  }
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
    if (err.code === "23505" && err.constraint === "uq_medical_records_appointment") {
      throw appError(409, "This appointment already has a medical record. Update that record instead.");
    }
    throw err;
  } finally {
    client.release();
  }
}

// Confidentiality policy for records flagged is_confidential:
//   Admin              -> sees everything
//   PatientSelf (/me)  -> sees all of their OWN records
//   Doctor             -> non-confidential + records they authored
//   Nurse (and others) -> non-confidential only
// Returns a SQL clause (pushing its params) or null when no filter applies.
function confidentialityWhere(viewer, params) {
  if (!viewer || viewer.role === "Admin" || viewer.role === "PatientSelf") return null;
  if (viewer.role === "Doctor") {
    params.push(Number(viewer.userId) || 0);
    return `(COALESCE(mr.is_confidential, false) = false
             OR COALESCE(mr.doctor_id, a.doctor_id) = $${params.length}
             OR mr.created_by = $${params.length})`;
  }
  return `COALESCE(mr.is_confidential, false) = false`;
}

// "MR-00061", "mr61", "#61" or "61" -> 61 (the reference shown in the UI).
function recordReferenceId(search) {
  const match = String(search || "").trim().match(/^(?:mr-?|#)?0*(\d{1,9})$/i);
  return match ? Number(match[1]) : null;
}

// Joins every list/summary query filters on (the doctor join covers records
// whose doctor comes from the linked appointment).
const FILTER_FROM = `
  FROM medical_records mr
  JOIN patients p ON mr.patient_id = p.id
  LEFT JOIN appointments a ON mr.appointment_id = a.id
  LEFT JOIN users d ON COALESCE(mr.doctor_id, a.doctor_id) = d.user_id
`;

// One WHERE builder for the list, its count and the summary, so the stats
// always describe exactly the rows the list pages through.
function buildFilters({
  search = "",
  patient_id = null,
  doctor_id = null,
  appointment_id = null,
  date_from = null,
  date_to = null,
  viewer = null,
} = {}) {
  const params = [];
  const where = [];

  const searchText = String(search || "").trim();
  if (searchText) {
    params.push(`%${escapeLike(searchText)}%`);
    const like = `$${params.length}`;
    const refId = recordReferenceId(searchText);
    let refMatch = "";
    if (refId) {
      params.push(refId);
      refMatch = `mr.record_id = $${params.length} OR`;
    }
    where.push(`(
      ${refMatch}
      p.name ILIKE ${like} OR
      p.first_name ILIKE ${like} OR
      p.last_name ILIKE ${like} OR
      CONCAT_WS(' ', p.first_name, p.last_name) ILIKE ${like} OR
      p.phone ILIKE ${like} OR
      CONCAT_WS(' ', d.first_name, d.last_name) ILIKE ${like} OR
      d.username ILIKE ${like} OR
      mr.diagnosis ILIKE ${like} OR
      mr.chief_complaint ILIKE ${like} OR
      mr.treatment_plan ILIKE ${like} OR
      mr.doctor_notes ILIKE ${like}
    )`);
  }

  if (patient_id) {
    params.push(patient_id);
    where.push(`mr.patient_id = $${params.length}`);
  }

  if (doctor_id) {
    params.push(doctor_id);
    where.push(`COALESCE(mr.doctor_id, a.doctor_id) = $${params.length}`);
  }

  if (appointment_id) {
    params.push(appointment_id);
    where.push(`mr.appointment_id = $${params.length}`);
  }

  if (date_from) {
    params.push(date_from);
    where.push(`mr.visit_date >= $${params.length}`);
  }

  if (date_to) {
    params.push(date_to);
    where.push(`mr.visit_date <= $${params.length}`);
  }

  const confidential = confidentialityWhere(viewer, params);
  if (confidential) where.push(confidential);

  return { params, whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "" };
}

const SELECT_RECORD = `
  SELECT
    mr.record_id,
    mr.record_id AS id,
    mr.patient_id,
    mr.appointment_id,
    mr.doctor_id,
    a.doctor_id AS appointment_doctor_id,
    mr.vital_id,
    TO_CHAR(mr.visit_date, 'YYYY-MM-DD') AS visit_date,
    mr.chief_complaint,
    mr.history_of_illness,
    mr.physical_exam,
    mr.diagnosis,
    mr.treatment_plan,
    mr.prescriptions,
    mr.lab_requests,
    mr.doctor_notes,
    mr.follow_up_date,
    TO_CHAR(mr.follow_up_date, 'YYYY-MM-DD') AS follow_up_date_text,
    mr.follow_up_notes,
    mr.is_confidential,
    mr.created_by,
    mr.created_at,
    mr.updated_at,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
    p.phone AS patient_phone,
    p.email AS patient_email,
    p.gender AS patient_gender,
    p.date_of_birth,
    p.blood_type,
    p.philhealth_no,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''), d.username) AS doctor_name,
    d.email AS doctor_email,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.username) AS created_by_name,
    cr.role_name AS created_by_role,
    a.status AS appointment_status,
    TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
    a.time::text AS appointment_time,
    s.specialty_name,
    v.id AS vital_id,
    v.id AS linked_vital_id,
    v.blood_pressure,
    v.heart_rate,
    v.heart_rate AS pulse_rate,
    v.temperature,
    v.weight AS weight,
    v.weight AS weight_kg,
    v.height AS height,
    v.height AS height_cm,
    v.oxygen_sat,
    v.oxygen_sat AS oxygen_saturation,
    v.o2_saturation,
    v.chief_complaint AS vital_chief_complaint,
    v.nurse_notes,
    v.recorded_at AS vital_recorded_at,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', n.first_name, n.last_name)), ''), n.username) AS nurse_name
  FROM medical_records mr
  JOIN patients p ON mr.patient_id = p.id
  LEFT JOIN appointments a ON mr.appointment_id = a.id
  LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
  LEFT JOIN users d ON COALESCE(mr.doctor_id, a.doctor_id) = d.user_id
  LEFT JOIN users c ON mr.created_by = c.user_id
  LEFT JOIN roles cr ON c.role_id = cr.role_id
  LEFT JOIN vitals v ON mr.vital_id = v.id
  LEFT JOIN users n ON v.nurse_id = n.user_id
`;

const MedicalRecord = {
  // `input` comes from the controller: patient/doctor/author are server-set.
  async create(input) {
    const fields = parseFields(input);
    const record = {
      patient_id: Number(input.patient_id),
      doctor_id: Number(input.doctor_id),
      created_by: Number(input.created_by),
      appointment_id: fields.appointment_id ?? null,
      vital_id: fields.vital_id ?? null,
      visit_date: fields.visit_date || manilaToday(),
      follow_up_date: fields.follow_up_date ?? null,
      is_confidential: fields.is_confidential ?? false,
    };
    for (const key of TEXT_FIELDS) record[key] = fields[key] ?? null;
    checkClinicalRules(record);

    const recordId = await inTransaction(async (client) => {
      await checkLinks(client, {
        patientId: record.patient_id,
        doctorId: record.doctor_id,
        appointmentId: record.appointment_id,
        vitalId: record.vital_id,
      });

      const result = await client.query(
        `INSERT INTO medical_records (
           patient_id, appointment_id, doctor_id, vital_id, visit_date,
           chief_complaint, history_of_illness, physical_exam, diagnosis, treatment_plan,
           prescriptions, prescription, lab_requests, doctor_notes, notes,
           follow_up_date, follow_up_notes, is_confidential, created_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
         )
         RETURNING record_id`,
        [
          record.patient_id,
          record.appointment_id,
          record.doctor_id,
          record.vital_id,
          record.visit_date,
          record.chief_complaint,
          record.history_of_illness,
          record.physical_exam,
          record.diagnosis,
          record.treatment_plan,
          record.prescriptions,
          record.prescriptions,
          record.lab_requests,
          record.doctor_notes,
          record.doctor_notes,
          record.follow_up_date,
          record.follow_up_notes,
          record.is_confidential,
          record.created_by,
        ]
      );
      return result.rows[0].record_id;
    });

    return this.findById(recordId);
  },

  async findAll({ page = 1, limit = 20, ...filters } = {}) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    const { params, whereSql } = buildFilters(filters);
    const dataParams = [...params, safeLimit, offset];

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${SELECT_RECORD}
         ${whereSql}
         ORDER BY mr.visit_date DESC, mr.created_at DESC, mr.record_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      db.query(`SELECT COUNT(*)::int AS count ${FILTER_FROM} ${whereSql}`, params),
    ]);

    const total = countResult.rows[0]?.count || 0;
    return {
      data: dataResult.rows,
      records: dataResult.rows,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  },

  // Totals over the WHOLE filtered dataset (not one page), for the Admin
  // Medical Records cards and the Medical Records Report. "This month" is the
  // clinic's month (Asia/Manila), same as before.
  async summarize(filters = {}) {
    const { params, whereSql } = buildFilters(filters);
    const [totals, diagnoses] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(DISTINCT mr.patient_id)::int AS unique_patients,
           COUNT(*) FILTER (WHERE mr.vital_id IS NOT NULL)::int AS linked_vitals,
           COUNT(*) FILTER (WHERE mr.follow_up_date IS NOT NULL)::int AS follow_ups,
           COUNT(*) FILTER (WHERE mr.is_confidential)::int AS confidential,
           COUNT(*) FILTER (WHERE NULLIF(TRIM(mr.prescriptions), '') IS NOT NULL)::int AS with_prescriptions,
           COUNT(*) FILTER (
             WHERE DATE_TRUNC('month', mr.created_at AT TIME ZONE 'Asia/Manila')
                 = DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Manila')
           )::int AS created_this_month
         ${FILTER_FROM}
         ${whereSql}`,
        params
      ),
      db.query(
        `SELECT COALESCE(NULLIF(mr.diagnosis, ''), 'No diagnosis encoded') AS label, COUNT(*)::int AS count
         ${FILTER_FROM}
         ${whereSql}
         GROUP BY 1
         ORDER BY count DESC, label ASC
         LIMIT 10`,
        params
      ),
    ]);
    return { ...totals.rows[0], top_diagnoses: diagnoses.rows };
  },

  async findById(recordId, viewer = null) {
    const params = [recordId];
    const confidential = confidentialityWhere(viewer, params);
    const result = await db.query(
      `${SELECT_RECORD}
       WHERE mr.record_id = $1${confidential ? ` AND ${confidential}` : ""}`,
      params
    );
    return result.rows[0] || null;
  },

  async findByPatient(patientId, viewer = null) {
    const params = [patientId];
    const confidential = confidentialityWhere(viewer, params);
    const result = await db.query(
      `${SELECT_RECORD}
       WHERE mr.patient_id = $1${confidential ? ` AND ${confidential}` : ""}
       ORDER BY mr.visit_date DESC, mr.created_at DESC, mr.record_id DESC`,
      params
    );
    return result.rows;
  },

  // Validates an edit against the current record. Returns only the fields
  // whose value actually changes ({} = nothing to save), or throws 400 when
  // no editable field was sent or a value is invalid.
  prepareUpdate(input, current) {
    const sent = EDITABLE_FIELDS.filter((key) => input?.[key] !== undefined);
    if (!sent.length) throw appError(400, "No editable fields were provided.");

    const fields = parseFields(input);
    const before = {
      appointment_id: current.appointment_id ?? null,
      vital_id: current.vital_id ?? null,
      visit_date: current.visit_date || null,
      follow_up_date: current.follow_up_date_text || null,
      is_confidential: Boolean(current.is_confidential),
    };
    for (const key of TEXT_FIELDS) before[key] = cleanText(current[key]) ?? null;

    const after = { ...before, ...fields };
    const clinicalChanged = ["diagnosis", "visit_date", "follow_up_date"].some((key) => key in fields);
    if (clinicalChanged) checkClinicalRules(after);

    const changes = {};
    for (const key of Object.keys(fields)) {
      if ((fields[key] ?? null) !== (before[key] ?? null)) changes[key] = fields[key];
    }
    return changes;
  },

  // Applies prepared changes. `patientId` / `doctorId` are the record's own,
  // used to validate any new appointment / vitals link.
  async update(recordId, changes, { patientId, doctorId, assignDoctorId = null }) {
    await inTransaction(async (client) => {
      await client.query("SELECT record_id FROM medical_records WHERE record_id = $1 FOR UPDATE", [recordId]);
      await checkLinks(client, {
        patientId,
        doctorId,
        appointmentId: "appointment_id" in changes ? changes.appointment_id : null,
        vitalId: "vital_id" in changes ? changes.vital_id : null,
        recordId,
      });

      const setClauses = [];
      const params = [];
      const set = (column, value) => {
        params.push(value);
        setClauses.push(`${column} = $${params.length}`);
      };
      for (const [key, value] of Object.entries(changes)) set(key, value ?? null);
      // Legacy columns kept in step with the current ones.
      if ("prescriptions" in changes) set("prescription", changes.prescriptions ?? null);
      if ("doctor_notes" in changes) set("notes", changes.doctor_notes ?? null);
      // A legacy record with no doctor_id gets its (verified) owner filled in.
      if (assignDoctorId) set("doctor_id", assignDoctorId);

      params.push(recordId);
      await client.query(
        `UPDATE medical_records
         SET ${setClauses.join(", ")}, updated_at = NOW()
         WHERE record_id = $${params.length}`,
        params
      );
    });

    return this.findById(recordId);
  },
};

module.exports = MedicalRecord;
