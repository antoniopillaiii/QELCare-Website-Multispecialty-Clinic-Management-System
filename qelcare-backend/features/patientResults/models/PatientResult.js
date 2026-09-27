const db = require("../../../config/database");

const SELECT_FIELDS = `
  result_id,
  patient_id,
  uploaded_by,
  title,
  result_type,
  source_facility,
  result_date,
  extracted_text,
  summary_notes,
  file_url,
  file_public_id,
  file_mime,
  created_at,
  updated_at
`;

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

const PatientResult = {
  async findByPatient(patientId, { search = "" } = {}) {
    const params = [patientId];
    let where = "patient_id = $1 AND deleted_at IS NULL";

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (title ILIKE $${params.length} OR result_type ILIKE $${params.length} OR source_facility ILIKE $${params.length} OR extracted_text ILIKE $${params.length})`;
    }

    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM patient_medical_results
       WHERE ${where}
       ORDER BY COALESCE(result_date, (created_at AT TIME ZONE 'Asia/Manila')::date) DESC, created_at DESC`,
      params
    );
    return result.rows;
  },

  async findOwned(resultId, patientId) {
    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM patient_medical_results
       WHERE result_id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
      [resultId, patientId]
    );
    return result.rows[0] || null;
  },

  async create(patientId, uploadedBy, input = {}, file = {}) {
    const result = await db.query(
      `INSERT INTO patient_medical_results (
         patient_id, uploaded_by, title, result_type, source_facility, result_date,
         extracted_text, summary_notes, file_url, file_public_id, file_mime
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${SELECT_FIELDS}`,
      [
        patientId,
        uploadedBy,
        cleanText(input.title),
        cleanText(input.result_type),
        cleanText(input.source_facility),
        cleanDate(input.result_date),
        cleanText(input.extracted_text),
        cleanText(input.summary_notes),
        cleanText(file.file_url),
        cleanText(file.file_public_id),
        cleanText(file.file_mime),
      ]
    );
    return result.rows[0];
  },

  async updateOwned(resultId, patientId, input = {}) {
    const result = await db.query(
      `UPDATE patient_medical_results
       SET title = $1,
           result_type = $2,
           source_facility = $3,
           result_date = $4,
           extracted_text = $5,
           summary_notes = $6,
           updated_at = NOW()
       WHERE result_id = $7 AND patient_id = $8 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}`,
      [
        cleanText(input.title),
        cleanText(input.result_type),
        cleanText(input.source_facility),
        cleanDate(input.result_date),
        cleanText(input.extracted_text),
        cleanText(input.summary_notes),
        resultId,
        patientId,
      ]
    );
    return result.rows[0] || null;
  },

  async softDeleteOwned(resultId, patientId) {
    const result = await db.query(
      `UPDATE patient_medical_results
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE result_id = $1 AND patient_id = $2 AND deleted_at IS NULL
       RETURNING ${SELECT_FIELDS}`,
      [resultId, patientId]
    );
    return result.rows[0] || null;
  },
};

module.exports = PatientResult;
