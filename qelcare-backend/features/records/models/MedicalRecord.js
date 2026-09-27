const db = require("../../../config/database");
const { manilaToday } = require("../../../shared/utils/manilaTime");

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

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function cleanDate(value) {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function toBool(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return false;
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

function normalizeRecordInput(input = {}) {
  return {
    patient_id: input.patient_id ? Number(input.patient_id) : null,
    appointment_id: input.appointment_id ? Number(input.appointment_id) : null,
    doctor_id: input.doctor_id ? Number(input.doctor_id) : null,
    vital_id: input.vital_id ? Number(input.vital_id) : null,
    created_by: input.created_by ? Number(input.created_by) : null,
    visit_date: cleanDate(input.visit_date) || manilaToday(),
    chief_complaint: cleanText(input.chief_complaint),
    history_of_illness: cleanText(input.history_of_illness),
    physical_exam: cleanText(input.physical_exam),
    diagnosis: cleanText(input.diagnosis),
    treatment_plan: cleanText(input.treatment_plan),
    prescriptions: cleanText(input.prescriptions),
    lab_requests: cleanText(input.lab_requests),
    doctor_notes: cleanText(input.doctor_notes),
    follow_up_date: cleanDate(input.follow_up_date),
    follow_up_notes: cleanText(input.follow_up_notes),
    is_confidential: toBool(input.is_confidential),
    notes: cleanText(input.notes || input.doctor_notes),
    prescription: cleanText(input.prescription || input.prescriptions),
  };
}

const SELECT_RECORD = `
  SELECT
    mr.record_id,
    mr.record_id AS id,
    mr.patient_id,
    mr.appointment_id,
    mr.doctor_id,
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
  async create(input) {
    const record = normalizeRecordInput(input);

    const result = await db.query(
      `INSERT INTO medical_records (
         patient_id,
         appointment_id,
         doctor_id,
         vital_id,
         visit_date,
         chief_complaint,
         history_of_illness,
         physical_exam,
         diagnosis,
         treatment_plan,
         prescriptions,
         prescription,
         lab_requests,
         doctor_notes,
         notes,
         follow_up_date,
         follow_up_notes,
         is_confidential,
         created_by
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
        record.prescription,
        record.lab_requests,
        record.doctor_notes,
        record.notes,
        record.follow_up_date,
        record.follow_up_notes,
        record.is_confidential,
        record.created_by,
      ]
    );

    return this.findById(result.rows[0].record_id);
  },

  async findAll({
    search = "",
    patient_id = null,
    doctor_id = null,
    appointment_id = null,
    date_from = null,
    date_to = null,
    page = 1,
    limit = 20,
    viewer = null,
  } = {}) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        p.name ILIKE $${params.length} OR
        p.first_name ILIKE $${params.length} OR
        p.last_name ILIKE $${params.length} OR
        p.phone ILIKE $${params.length} OR
        mr.diagnosis ILIKE $${params.length} OR
        mr.chief_complaint ILIKE $${params.length} OR
        mr.doctor_notes ILIKE $${params.length} OR
        CAST(mr.record_id AS TEXT) ILIKE $${params.length}
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

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const dataParams = [...params, safeLimit, offset];

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${SELECT_RECORD}
         ${whereSql}
         ORDER BY mr.visit_date DESC, mr.created_at DESC, mr.record_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM medical_records mr
         JOIN patients p ON mr.patient_id = p.id
         LEFT JOIN appointments a ON mr.appointment_id = a.id
         ${whereSql}`,
        params
      ),
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

  async update(recordId, fields) {
    const allowed = [
      "appointment_id",
      "doctor_id",
      "vital_id",
      ...CLINICAL_FIELDS,
    ];
    const setClauses = [];
    const params = [];

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        let value = fields[key];
        if (["appointment_id", "doctor_id", "vital_id"].includes(key)) {
          value = value ? Number(value) : null;
        } else if (key === "is_confidential") {
          value = toBool(value);
        } else if (key.includes("date")) {
          value = cleanDate(value);
        } else {
          value = cleanText(value);
        }
        params.push(value);
        setClauses.push(`${key} = $${params.length}`);
      }
    }

    if (fields.prescriptions !== undefined) {
      params.push(cleanText(fields.prescriptions));
      setClauses.push(`prescription = $${params.length}`);
    }

    if (fields.doctor_notes !== undefined) {
      params.push(cleanText(fields.doctor_notes));
      setClauses.push(`notes = $${params.length}`);
    }

    if (!setClauses.length) {
      throw { statusCode: 400, message: "No valid fields to update." };
    }

    params.push(recordId);
    const result = await db.query(
      `UPDATE medical_records
       SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE record_id = $${params.length}
       RETURNING record_id`,
      params
    );

    if (!result.rows[0]) return null;
    return this.findById(result.rows[0].record_id);
  },
};

module.exports = MedicalRecord;
