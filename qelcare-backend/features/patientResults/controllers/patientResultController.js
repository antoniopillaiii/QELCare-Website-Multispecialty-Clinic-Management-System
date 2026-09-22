const { Readable } = require("stream");
const cloudinary = require("../../../config/cloudinary");
const gemini = require("../../../shared/utils/geminiClient");
const Patient = require("../../patient/models/Patient");
const PatientResult = require("../models/PatientResult");

function patientName(patient) {
  return patient?.display_name || patient?.name || [patient?.first_name, patient?.last_name].filter(Boolean).join(" ") || "Patient";
}

async function getMyPatient(req) {
  const patient = await Patient.findByUserId(req.user.user_id);
  if (!patient) {
    const err = new Error("Patient profile not found.");
    err.statusCode = 404;
    throw err;
  }
  return patient;
}

function uploadToCloudinary(file) {
  if (!file) return Promise.resolve({});

  return new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: "qelcare-patient-results",
        resource_type: "auto",
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          file_url: result.secure_url,
          file_public_id: result.public_id,
          file_mime: file.mimetype,
        });
      }
    );

    Readable.from(file.buffer).pipe(upload);
  });
}

const EXTRACTION_PROMPT =
  "You are a medical document assistant. The image may be a lab result, prescription, " +
  "doctor's note, vital-signs sheet, medical form, OR a radiology/imaging film such as an " +
  "X-ray, ultrasound, CT scan, MRI, or ECG. " +
  "Return ONLY a single minified JSON object (no markdown, no code fences) with exactly two keys: " +
  '"document_type" and "text". ' +
  '"document_type": a short, SPECIFIC label for what this document or image is. Identify it from the ' +
  "image itself even when there is little or no text (for a radiology film, name the imaging type and " +
  'body part). Examples: "Chest X-ray", "X-ray", "Ultrasound", "CT Scan", "MRI", "ECG", ' +
  '"Complete Blood Count (CBC)", "Urinalysis", "Blood Chemistry", "Prescription", "Laboratory Result", ' +
  '"Medical Certificate", "Doctor\'s Note". ' +
  '"text": ALL readable text from the image exactly as it appears, including handwriting, preserving ' +
  "line breaks, numbers, units, and dates. If there is no readable text, use an empty string. " +
  "Do not add any commentary outside the JSON object.";

// Gemini may wrap JSON in ``` fences or add stray prose. Pull out the {…} object
// and parse it; fall back to treating the whole response as plain extracted text.
function parseOcrResponse(raw) {
  const cleaned = String(raw || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      return {
        document_type: String(obj.document_type || "").trim(),
        text: String(obj.text || "").trim(),
      };
    } catch {
      /* fall through */
    }
  }
  return { document_type: "", text: String(raw || "").trim() };
}

const patientResultController = {
  async getMine(req, res) {
    try {
      const patient = await getMyPatient(req);
      const results = await PatientResult.findByPatient(patient.id, { search: req.query.search || "" });
      res.json({ success: true, patient: { id: patient.id, name: patientName(patient) }, data: results, results });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Patient results getMine error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to fetch medical results." });
    }
  },

  async create(req, res) {
    try {
      const patient = await getMyPatient(req);
      const title = String(req.body.title || "").trim();
      if (!title) {
        return res.status(400).json({ success: false, message: "Title is required." });
      }

      const fileData = await uploadToCloudinary(req.file);
      const result = await PatientResult.create(patient.id, req.user.user_id, req.body, fileData);
      res.status(201).json({ success: true, message: "Medical result saved.", data: result, result });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Patient results create error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to save medical result." });
    }
  },

  async update(req, res) {
    try {
      const patient = await getMyPatient(req);
      const title = String(req.body.title || "").trim();
      if (!title) {
        return res.status(400).json({ success: false, message: "Title is required." });
      }

      const result = await PatientResult.updateOwned(req.params.id, patient.id, req.body);
      if (!result) return res.status(404).json({ success: false, message: "Medical result not found." });
      res.json({ success: true, message: "Medical result updated.", data: result, result });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Patient results update error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to update medical result." });
    }
  },

  async remove(req, res) {
    try {
      const patient = await getMyPatient(req);
      const existing = await PatientResult.findOwned(req.params.id, patient.id);
      if (!existing) return res.status(404).json({ success: false, message: "Medical result not found." });

      const deleted = await PatientResult.softDeleteOwned(req.params.id, patient.id);

      if (existing.file_public_id) {
        const resourceType = existing.file_mime === "application/pdf" ? "raw" : "image";
        cloudinary.uploader.destroy(existing.file_public_id, { resource_type: resourceType }).catch(() => null);
      }

      res.json({ success: true, message: "Medical result deleted.", data: deleted, result: deleted });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Patient results delete error:", err);
      res.status(status).json({ success: false, message: err.message || "Failed to delete medical result." });
    }
  },

  // POST /patient-results/ocr
  // Body: { image: "<base64>", mime_type: "image/jpeg" }
  // Returns: { success: true, text: "..." }
  async ocrImage(req, res) {
    try {
      const { image, mime_type } = req.body;

      if (!image || typeof image !== "string" || image.trim() === "") {
        return res.status(400).json({ success: false, message: "No image data provided." });
      }

      if (image.length > 14 * 1024 * 1024) {
        return res.status(413).json({ success: false, message: "Image is too large. Max ~10 MB per page." });
      }

      if (!gemini.apiKey()) {
        return res.status(503).json({
          success: false,
          message: "GEMINI_API_KEY is not set in the server environment.",
        });
      }

      const mimeType = mime_type || "image/jpeg";

      const geminiResponse = await gemini.generateFromImage({
        model: gemini.ocrModel(),
        prompt: EXTRACTION_PROMPT,
        base64Image: image,
        mimeType,
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      });

      const raw = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const { text, document_type } = parseOcrResponse(raw);

      res.json({ success: true, text, document_type });
    } catch (err) {
      console.error("OCR error:", err.message);

      if (err.message.includes("API_KEY_INVALID") || err.message.includes("API key not valid")) {
        return res.status(401).json({
          success: false,
          message: "Invalid Gemini API key. Check GEMINI_API_KEY in your .env file.",
        });
      }

      if (err.message.toLowerCase().includes("timed out")) {
        return res.status(504).json({
          success: false,
          message: "Text extraction timed out. Try again.",
        });
      }

      if (err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED")) {
        return res.status(429).json({
          success: false,
          message: "Gemini free tier daily limit reached. Try again tomorrow or upgrade your plan.",
        });
      }

      res.status(500).json({ success: false, message: err.message || "Text extraction failed." });
    }
  },
};

module.exports = patientResultController;
