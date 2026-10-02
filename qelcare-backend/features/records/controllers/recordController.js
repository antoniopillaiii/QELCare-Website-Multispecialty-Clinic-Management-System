const MedicalRecord = require("../models/MedicalRecord");
const Patient = require("../../patient/models/Patient");
const logger = require("../../../shared/utils/activityLogger");
const { isValidDateString } = require("../../../shared/utils/manilaTime");
const { isPositiveInt } = require("../../../shared/utils/requestValidation");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");

function getRecordId(record) {
  return record?.record_id || record?.id;
}

async function writeLog(req, payload) {
  try {
    await logger.log({
      userId: req.user?.user_id,
      ip: logger.getIP(req),
      ...payload,
    });
  } catch (err) {
    logSafeError("Medical record activity log error", err);
  }
}

// Identity handed to the model so confidential records are filtered per-role.
function viewerOf(req) {
  return { role: req.user?.role, userId: req.user?.user_id };
}

// List / summary filters: bad input is a 400, not a database error.
function listQueryError(query) {
  const idFilters = { patient_id: "patient", doctor_id: "doctor", appointment_id: "appointment" };
  for (const [key, label] of Object.entries(idFilters)) {
    if (query[key] && !isPositiveInt(query[key])) return `Invalid ${label} filter.`;
  }
  for (const key of ["date_from", "date_to"]) {
    if (query[key] && !isValidDateString(query[key])) return `Invalid ${key.replace("_", " ")}. Use YYYY-MM-DD.`;
  }
  if (query.date_from && query.date_to && query.date_from > query.date_to) {
    return "The start date must be on or before the end date.";
  }
  return "";
}

// Same filters for the list and its summary. A doctor's list is always their
// own records, whatever doctor_id is asked for.
function filtersFrom(req) {
  return {
    search: req.query.search || "",
    patient_id: req.query.patient_id || null,
    doctor_id: req.user?.role === "Doctor" ? req.user.user_id : req.query.doctor_id || null,
    appointment_id: req.query.appointment_id || null,
    date_from: req.query.date_from || null,
    date_to: req.query.date_to || null,
    viewer: viewerOf(req),
  };
}

// The doctor who owns a record: its doctor, else the linked appointment's
// doctor (the same rule the confidentiality filter uses). A legacy record with
// neither belongs only to a doctor who authored it; nobody else can claim it.
function recordOwner(record) {
  return Number(record.doctor_id || record.appointment_doctor_id || 0) || null;
}

function sendError(res, err, context, fallbackMessage) {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logSafeError(context, err);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

const recordController = {
  async create(req, res) {
    try {
      if (req.user?.role !== "Doctor") {
        return res.status(403).json({ success: false, message: "Only doctors can create medical records." });
      }

      if (!isPositiveInt(req.body?.patient_id)) {
        return res.status(400).json({ success: false, message: "Select a valid patient." });
      }
      // A consultation record always documents a visit (the model then checks
      // the visit is eligible and belongs to this doctor and patient).
      if (!isPositiveInt(req.body?.appointment_id)) {
        return res.status(400).json({
          success: false,
          code: "VISIT_REQUIRED",
          message: "Select the visit this record is for. A consultation record must be linked to an eligible visit.",
        });
      }
      const patientId = Number(req.body.patient_id);

      const patient = await Patient.findById(patientId);
      if (!patient) {
        return res.status(404).json({ success: false, message: "Patient not found." });
      }

      const record = await MedicalRecord.create({
        ...req.body,
        patient_id: patientId,
        doctor_id: req.user.user_id,
        created_by: req.user.user_id,
      });

      await writeLog(req, {
        action: "RECORD_CREATED",
        entityType: "medical_record",
        entityId: getRecordId(record),
        description: `Medical record #${getRecordId(record)} created for patient #${patientId}`,
        metadata: { patient_id: patientId, appointment_id: record.appointment_id || null },
      });

      res.status(201).json({
        success: true,
        message: "Medical record created.",
        data: record,
        record,
      });
    } catch (err) {
      sendError(res, err, "Create record error", "Failed to create medical record.");
    }
  },

  async getAll(req, res) {
    try {
      const queryError = listQueryError(req.query);
      if (queryError) return res.status(400).json({ success: false, message: queryError });

      const result = await MedicalRecord.findAll({
        ...filtersFrom(req),
        page: req.query.page || 1,
        limit: req.query.limit || 20,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "Get records error", "Failed to fetch medical records.");
    }
  },

  // Totals for the whole filtered dataset (Admin Medical Records cards,
  // Medical Records Report), with the same per-role confidentiality filter.
  async getSummary(req, res) {
    try {
      const queryError = listQueryError(req.query);
      if (queryError) return res.status(400).json({ success: false, message: queryError });

      const summary = await MedicalRecord.summarize(filtersFrom(req));
      res.json({ success: true, data: summary });
    } catch (err) {
      sendError(res, err, "Records summary error", "Failed to fetch medical records summary.");
    }
  },

  async getById(req, res) {
    try {
      // Viewer-filtered: a confidential record a role may not see 404s
      // (no existence leak).
      const record = await MedicalRecord.findById(req.params.id, viewerOf(req));
      if (!record) return res.status(404).json({ success: false, message: "Medical record not found." });
      res.json({ success: true, data: record, record });
    } catch (err) {
      sendError(res, err, "Get record error", "Failed to fetch medical record.");
    }
  },

  async getByPatient(req, res) {
    try {
      const records = await MedicalRecord.findByPatient(req.params.patientId, viewerOf(req));
      res.json({ success: true, data: records, records });
    } catch (err) {
      sendError(res, err, "Get patient records error", "Failed to fetch patient medical records.");
    }
  },

  async getMyRecords(req, res) {
    try {
      const patient = await Patient.findByUserId(req.user.user_id);
      if (!patient) {
        return res.status(404).json({ success: false, message: "Patient profile not found." });
      }

      // Patients see all of their OWN records, including confidential ones.
      // They are told that a record was amended and when; the reason and who
      // amended it are staff-facing.
      const records = (await MedicalRecord.findByPatient(patient.id, { role: "PatientSelf" }))
        .map(({ amendment_reason: _reason, amended_by_name: _by, ...record }) => record);
      res.json({ success: true, data: records, records });
    } catch (err) {
      sendError(res, err, "Get my records error", "Failed to fetch your medical records.");
    }
  },

  async update(req, res) {
    try {
      if (req.user?.role !== "Doctor") {
        return res.status(403).json({ success: false, message: "Only doctors can update medical records." });
      }

      const current = await MedicalRecord.findById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: "Medical record not found." });

      const userId = Number(req.user.user_id);
      const owner = recordOwner(current) || (Number(current.created_by) === userId ? userId : null);
      if (owner !== userId) {
        return res.status(403).json({
          success: false,
          message: recordOwner(current)
            ? "Doctors can only update their own medical records."
            : "This record has no assigned doctor, so only the doctor who wrote it can update it.",
        });
      }

      const changes = MedicalRecord.prepareUpdate(req.body, current);
      if (!Object.keys(changes).length) {
        // Nothing actually changes: no write, no audit entry.
        return res.json({ success: true, changed: false, message: "No changes to save.", data: current, record: current });
      }

      // After the visit is paid, a change is an amendment and needs a reason.
      let amendment = null;
      if (MedicalRecord.isPaidVisit(current)) {
        const reason = typeof req.body?.amendment_reason === "string" ? req.body.amendment_reason.trim() : "";
        if (!reason) {
          return res.status(400).json({
            success: false,
            code: "AMENDMENT_REASON_REQUIRED",
            message: "This visit is already paid. Enter the reason for amending the record.",
          });
        }
        if (reason.length > MedicalRecord.MAX_AMENDMENT_REASON) {
          return res.status(400).json({
            success: false,
            message: `The amendment reason must be ${MedicalRecord.MAX_AMENDMENT_REASON} characters or less.`,
          });
        }
        amendment = { reason, userId, ip: logger.getIP(req) };
      }

      const { record, amended } = await MedicalRecord.update(req.params.id, changes, {
        patientId: current.patient_id,
        doctorId: owner,
        assignDoctorId: current.doctor_id ? null : owner,
        amendment,
      });

      // An amendment's audit row (with the old and new values) is written by
      // the model together with the change itself.
      if (!amended) {
        await writeLog(req, {
          action: "RECORD_UPDATED",
          entityType: "medical_record",
          entityId: getRecordId(record),
          description: `Medical record #${getRecordId(record)} updated`,
          metadata: {
            patient_id: record.patient_id,
            appointment_id: record.appointment_id || null,
            fields: Object.keys(changes),
          },
        });
      }

      res.json({
        success: true,
        changed: true,
        amended,
        message: amended ? "Medical record amended." : "Medical record updated.",
        data: record,
        record,
      });
    } catch (err) {
      sendError(res, err, "Update record error", "Failed to update medical record.");
    }
  },
};

module.exports = recordController;
