const Patient = require("../models/Patient");
const logger = require("../../../shared/utils/activityLogger");

function getPatientName(patient) {
  return patient.display_name || patient.name || [patient.first_name, patient.last_name].filter(Boolean).join(" ");
}

// Reject a future (or malformed) date of birth. DOB is optional, so empty passes.
// Compares date-only strings against today in Asia/Manila (YYYY-MM-DD sorts
// chronologically, so a plain string compare is correct and timezone-safe).
function futureDobError(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Date of birth must be a valid date.";
  const todayManila = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  if (text > todayManila) return "Date of birth cannot be in the future.";
  return null;
}

// App-wide phone rule (same as registration and profile updates): PH mobile
// 09XXXXXXXXX, +639XXXXXXXXX, or an international number +<10-14 digits>
// (landlines fit as +63...). Optional, so empty passes. Returns an error or null.
function phoneError(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (raw.length > 30) return `${label} must be 30 characters or less.`;
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (!/^(09\d{9}|\+639\d{9}|\+\d{10,14})$/.test(cleaned)) {
    return `${label} is invalid. Use 09XXXXXXXXX, +639XXXXXXXXX, or an international number starting with +.`;
  }
  return null;
}

const patientController = {
  async create(req, res) {
    try {
      const firstName = String(req.body.first_name || "").trim();
      const lastName = String(req.body.last_name || "").trim();
      const legacyName = String(req.body.name || "").trim();

      if ((!firstName || !lastName) && !legacyName) {
        return res.status(400).json({
          success: false,
          message: "First name and last name are required.",
        });
      }

      const dobError = futureDobError(req.body.date_of_birth);
      if (dobError) return res.status(400).json({ success: false, message: dobError });

      const phoneMsg = phoneError(req.body.phone ?? req.body.contact, "Phone")
        || phoneError(req.body.emergency_contact_phone, "Emergency phone");
      if (phoneMsg) return res.status(400).json({ success: false, message: phoneMsg });

      // Linking a record to a portal account is never client-controlled: it
      // happens only when a patient account is verified (DB trigger). Drop
      // user_id (and the confirmation flag) from what gets stored.
      const { user_id: _ignoredUserId, confirm_duplicate: confirmDuplicate, ...input } = req.body;

      // Warn before creating what looks like an existing patient. Staff can
      // still create it on purpose (two different people can share a name).
      if (confirmDuplicate !== true && firstName && lastName) {
        const duplicates = await Patient.findPossibleDuplicates({
          first_name: firstName,
          last_name: lastName,
          date_of_birth: futureDobError(input.date_of_birth) ? null : (input.date_of_birth || null),
          phone: input.phone ?? input.contact ?? null,
        });
        if (duplicates.length) {
          return res.status(409).json({
            success: false,
            code: "POSSIBLE_DUPLICATE",
            message: "A patient record with the same details already exists.",
            duplicates,
          });
        }
      }

      const patient = await Patient.create({
        ...input,
        created_by: req.user.user_id,
      });

      await logger.log({
        userId: req.user.user_id,
        action: "PATIENT_CREATED",
        entityType: "patient",
        entityId: patient.id,
        description: `Patient created: ${getPatientName(patient)}`,
        ip: logger.getIP(req),
      });

      res.status(201).json({
        success: true,
        message: "Patient created.",
        data: patient,
        patient,
      });
    } catch (err) {
      console.error("Create patient error:", err);
      res.status(500).json({ success: false, message: "Failed to create patient." });
    }
  },

  async getAll(req, res) {
    try {
      const { search = "", is_active } = req.query;
      const activeFilter = is_active === undefined || is_active === "" ? null : is_active === "true";
      const patients = await Patient.findAll({ search, is_active: activeFilter });

      res.json({
        success: true,
        data: patients,
        patients,
      });
    } catch (err) {
      console.error("Get patients error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch patients." });
    }
  },

  async getById(req, res) {
    try {
      const patient = await Patient.findById(req.params.id);
      if (!patient) return res.status(404).json({ success: false, message: "Patient not found." });
      res.json({ success: true, data: patient, patient });
    } catch (err) {
      console.error("Get patient error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch patient." });
    }
  },

  async getMyPatientProfile(req, res) {
    try {
      const patient = await Patient.findByUserId(req.user.user_id);
      if (!patient) {
        return res.status(404).json({ success: false, message: "Patient profile not found." });
      }
      res.json({ success: true, data: patient, patient });
    } catch (err) {
      console.error("Get my patient profile error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch patient profile." });
    }
  },

  async update(req, res) {
    try {
      const firstName = String(req.body.first_name || "").trim();
      const lastName = String(req.body.last_name || "").trim();
      const legacyName = String(req.body.name || "").trim();

      if ((!firstName || !lastName) && !legacyName) {
        return res.status(400).json({
          success: false,
          message: "First name and last name are required.",
        });
      }

      const dobError = futureDobError(req.body.date_of_birth);
      if (dobError) return res.status(400).json({ success: false, message: dobError });

      const existing = await Patient.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: "Patient not found." });
      // Validate a phone only when it is being changed, so records saved before
      // this rule existed can still be edited without retyping their number.
      const changed = (next, current) => String(next ?? "").trim() !== String(current ?? "").trim();
      const nextPhone = req.body.phone ?? req.body.contact;
      const phoneMsg = (changed(nextPhone, existing.phone || existing.contact) && phoneError(nextPhone, "Phone"))
        || (changed(req.body.emergency_contact_phone, existing.emergency_contact_phone) && phoneError(req.body.emergency_contact_phone, "Emergency phone"));
      if (phoneMsg) return res.status(400).json({ success: false, message: phoneMsg });

      const patient = await Patient.update(req.params.id, req.body);
      if (!patient) return res.status(404).json({ success: false, message: "Patient not found." });

      await logger.log({
        userId: req.user.user_id,
        action: "PATIENT_UPDATED",
        entityType: "patient",
        entityId: patient.id,
        description: `Patient updated: ${getPatientName(patient)}`,
        ip: logger.getIP(req),
      });

      res.json({
        success: true,
        message: "Patient updated.",
        data: patient,
        patient,
      });
    } catch (err) {
      console.error("Update patient error:", err);
      res.status(500).json({ success: false, message: "Failed to update patient." });
    }
  },

  async setActive(req, res) {
    try {
      const { is_active } = req.body;
      if (typeof is_active !== "boolean") {
        return res.status(400).json({ success: false, message: "is_active must be true or false." });
      }

      const patient = await Patient.setActive(req.params.id, is_active);
      if (!patient) return res.status(404).json({ success: false, message: "Patient not found." });

      await logger.log({
        userId: req.user.user_id,
        action: "PATIENT_STATUS_CHANGED",
        entityType: "patient",
        entityId: patient.id,
        description: `Patient ${is_active ? "activated" : "deactivated"}: ${getPatientName(patient)}`,
        ip: logger.getIP(req),
      });

      res.json({
        success: true,
        message: `Patient ${is_active ? "activated" : "deactivated"}.`,
        data: patient,
        patient,
      });
    } catch (err) {
      console.error("Set active error:", err);
      res.status(500).json({ success: false, message: "Failed to update patient status." });
    }
  },
};

module.exports = patientController;
