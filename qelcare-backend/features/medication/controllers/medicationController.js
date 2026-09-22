const Patient = require("../../patient/models/Patient");
const PatientMedication = require("../models/PatientMedication");
const gemini = require("../../../shared/utils/geminiClient");

async function getMyPatient(req) {
  const patient = await Patient.findByUserId(req.user.user_id);
  if (!patient) {
    const err = new Error("Patient profile not found.");
    err.statusCode = 404;
    throw err;
  }
  return patient;
}

const PRESCRIPTION_PROMPT =
  "You are a medical prescription parser. FIRST judge whether this image is genuinely a medical " +
  "prescription or a list of real medications (handwritten or printed). It is NOT a prescription if it " +
  "shows random people's names, unrelated notes, drawings, receipts, or any non-medical text. " +
  "Only treat an entry as a medication if it is a recognizable real medicine/drug name. " +
  "Return ONLY valid JSON in exactly this shape, with no commentary:\n" +
  '{ "is_prescription": true|false, "reason": "short reason when not a prescription", ' +
  '"medications": [ { "drug_name": "string", "dosage": "string", "form": "tablet|capsule|syrup|injection|drops|cream|other|", ' +
  '"frequency_per_day": number, "duration_days": number_or_null, "instructions": "string" } ] }\n' +
  "Rules: drug_name is the medicine name only. dosage is strength like '500 mg' or '10 mL'. " +
  "frequency_per_day is how many times per day it is taken (e.g. 'every 6 hours' = 4, 'twice daily' = 2, 'once daily' = 1). " +
  "duration_days is the number of days to take it, or null if not stated. " +
  "instructions is any extra note like 'after meals' or 'as needed for fever'. " +
  "If you cannot read a field, use an empty string for text fields, 1 for frequency_per_day, and null for duration_days. " +
  "If this is NOT a prescription, set is_prescription to false, give a short reason, and return an empty medications array.";

function coerceMedication(raw) {
  const freq = parseInt(raw.frequency_per_day, 10);
  const dur = raw.duration_days === null || raw.duration_days === undefined ? null : parseInt(raw.duration_days, 10);
  return {
    drug_name: String(raw.drug_name || "").trim().slice(0, 160),
    dosage: String(raw.dosage || "").trim().slice(0, 120),
    form: String(raw.form || "").trim().slice(0, 60),
    frequency_per_day: Number.isFinite(freq) && freq >= 1 ? Math.min(freq, 12) : 1,
    duration_days: Number.isFinite(dur) && dur > 0 ? dur : null,
    instructions: String(raw.instructions || "").trim().slice(0, 1000),
    times_of_day: PatientMedication.defaultTimesForFrequency(
      Number.isFinite(freq) && freq >= 1 ? Math.min(freq, 12) : 1
    ),
  };
}

const medicationController = {
  async list(req, res) {
    try {
      const patient = await getMyPatient(req);
      const meds = await PatientMedication.findByPatient(patient.id, {
        status: req.query.status || "",
        search: req.query.search || "",
      });
      const adherence = await PatientMedication.getAdherence(patient.id, 30);
      res.json({ success: true, data: meds, medications: meds, adherence });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication list error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to load medications." });
    }
  },

  async create(req, res) {
    try {
      const patient = await getMyPatient(req);
      const med = await PatientMedication.create(patient.id, req.user.user_id, req.body);
      res.status(201).json({ success: true, message: "Medication added.", data: med, medication: med });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication create error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to add medication." });
    }
  },

  // Bulk create from OCR parse (patient confirmed the parsed list).
  async createBatch(req, res) {
    try {
      const patient = await getMyPatient(req);
      const items = Array.isArray(req.body.medications) ? req.body.medications : [];
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: "No medications provided." });
      }
      const created = [];
      for (const item of items) {
        if (!String(item.drug_name || "").trim()) continue;
        created.push(await PatientMedication.create(patient.id, req.user.user_id, { ...item, source: "ocr" }));
      }
      res.status(201).json({ success: true, message: `${created.length} medication(s) added.`, data: created, medications: created });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication batch create error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to add medications." });
    }
  },

  async update(req, res) {
    try {
      const patient = await getMyPatient(req);
      const med = await PatientMedication.updateOwned(req.params.id, patient.id, req.body);
      if (!med) return res.status(404).json({ success: false, message: "Medication not found." });
      res.json({ success: true, message: "Medication updated.", data: med, medication: med });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication update error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to update medication." });
    }
  },

  async setStatus(req, res) {
    try {
      const patient = await getMyPatient(req);
      const med = await PatientMedication.setStatus(req.params.id, patient.id, String(req.body.status || ""));
      if (!med) return res.status(404).json({ success: false, message: "Medication not found." });
      res.json({ success: true, message: `Medication ${med.status}.`, data: med, medication: med });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication status error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to update status." });
    }
  },

  async remove(req, res) {
    try {
      const patient = await getMyPatient(req);
      const deleted = await PatientMedication.softDeleteOwned(req.params.id, patient.id);
      if (!deleted) return res.status(404).json({ success: false, message: "Medication not found." });
      res.json({ success: true, message: "Medication removed." });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication remove error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to remove medication." });
    }
  },

  async schedule(req, res) {
    try {
      const patient = await getMyPatient(req);
      const data = await PatientMedication.getScheduleForDate(patient.id, req.query.date);
      res.json({ success: true, ...data });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication schedule error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to load schedule." });
    }
  },

  async logDose(req, res) {
    try {
      const patient = await getMyPatient(req);
      const log = await PatientMedication.logDose(patient.id, req.body);
      res.json({ success: true, message: "Dose recorded.", data: log, log });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication log error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to record dose." });
    }
  },

  // POST /medications/parse  Body: { image: "<base64>", mime_type }
  // Returns: { success, medications: [ parsed rows ], raw_text }
  async parsePrescription(req, res) {
    try {
      const { image, mime_type } = req.body;
      if (!image || typeof image !== "string" || image.trim() === "") {
        return res.status(400).json({ success: false, message: "No image data provided." });
      }
      if (image.length > 14 * 1024 * 1024) {
        return res.status(413).json({ success: false, message: "Image is too large. Max ~10 MB per page." });
      }

      if (!gemini.apiKey()) {
        return res.status(503).json({ success: false, message: "GEMINI_API_KEY is not set in the server environment." });
      }

      const mimeType = mime_type || "image/jpeg";

      const response = await gemini.generateFromImage({
        model: gemini.ocrModel(),
        prompt: PRESCRIPTION_PROMPT,
        base64Image: image,
        mimeType,
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: "application/json" },
      });
      const rawText = String(response.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

      let parsedJson;
      try {
        parsedJson = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      } catch {
        parsedJson = { medications: [] };
      }

      const medications = Array.isArray(parsedJson.medications)
        ? parsedJson.medications.map(coerceMedication).filter((m) => m.drug_name)
        : [];

      // Validation: reject images the AI judged are not a real prescription, or
      // where nothing medication-like could be extracted. This stops dummy/funny
      // uploads (e.g. a list of names) from being turned into medications.
      const isPrescription = parsedJson.is_prescription !== false;
      if (!isPrescription || medications.length === 0) {
        return res.json({
          success: false,
          code: "NOT_A_PRESCRIPTION",
          message: parsedJson.reason
            ? `This doesn't look like a prescription (${String(parsedJson.reason).slice(0, 160)}). Please upload a clear photo of a real prescription or medication list.`
            : "This image doesn't appear to be a prescription or medication list. Please upload a clear photo of a real prescription.",
          medications: [],
          raw_text: rawText,
        });
      }

      res.json({ success: true, medications, raw_text: rawText });
    } catch (err) {
      console.error("Prescription parse error:", err.message);
      if (err.message.includes("API_KEY_INVALID") || err.message.includes("API key not valid")) {
        return res.status(401).json({ success: false, message: "Invalid Gemini API key. Check GEMINI_API_KEY in your .env file." });
      }
      if (err.message.toLowerCase().includes("timed out")) {
        return res.status(504).json({ success: false, message: "Prescription reading timed out. Try again." });
      }
      if (err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED")) {
        return res.status(429).json({ success: false, message: "Gemini free tier daily limit reached. Try again tomorrow." });
      }
      res.status(500).json({ success: false, message: err.message || "Prescription reading failed." });
    }
  },

  async adherence(req, res) {
    try {
      const patient = await getMyPatient(req);
      const days = parseInt(req.query.days, 10);
      const data = await PatientMedication.getAdherence(patient.id, Number.isFinite(days) ? days : 30);
      res.json({ success: true, ...data });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Medication adherence error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to load adherence." });
    }
  },

  // --- Doctor review queue ---------------------------------------------------
  async pendingReview(req, res) {
    try {
      const meds = await PatientMedication.findPendingForReview({ search: req.query.search || "" });
      res.json({ success: true, data: meds, medications: meds, count: meds.length });
    } catch (err) {
      console.error("Medication pending-review error:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to load pending medications." });
    }
  },

  async approve(req, res) {
    try {
      const med = await PatientMedication.approve(req.params.id, req.user.user_id);
      if (!med) return res.status(404).json({ success: false, message: "Medication not found." });
      res.json({ success: true, message: "Medication approved. The reminder is now active for the patient.", data: med, medication: med });
    } catch (err) {
      console.error("Medication approve error:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to approve medication." });
    }
  },

  async reject(req, res) {
    try {
      const reason = String(req.body.reason || req.body.rejection_reason || "").trim();
      if (!reason) return res.status(400).json({ success: false, message: "A short reason is required when declining." });
      const med = await PatientMedication.reject(req.params.id, req.user.user_id, reason);
      if (!med) return res.status(404).json({ success: false, message: "Medication not found." });
      res.json({ success: true, message: "Medication declined.", data: med, medication: med });
    } catch (err) {
      console.error("Medication reject error:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to decline medication." });
    }
  },
};

module.exports = medicationController;
