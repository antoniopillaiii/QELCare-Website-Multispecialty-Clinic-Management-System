const { Readable } = require("stream");
const cloudinary = require("../../../config/cloudinary");
const gemini = require("../../../shared/utils/geminiClient");
const Patient = require("../../patient/models/Patient");
const PatientResult = require("../models/PatientResult");
const { isValidDateString } = require("../../../shared/utils/manilaTime");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");

function patientName(patient) {
  return patient?.display_name || patient?.name || [patient?.first_name, patient?.last_name].filter(Boolean).join(" ") || "Patient";
}

function appError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Only messages written here reach the patient. Anything unexpected (a
// database or storage error) is logged without row contents and answered with
// a fixed sentence, so SQL details never show up on screen.
function sendError(res, err, context, fallbackMessage) {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logSafeError(context, err);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

async function getMyPatient(req) {
  const patient = await Patient.findByUserId(req.user.user_id);
  if (!patient) throw appError(404, "Patient profile not found.");
  return patient;
}

// Column sizes of patient_medical_results.
const TEXT_LIMITS = { title: 200, result_type: 100, source_facility: 200 };
const FIELD_LABELS = { title: "Title", result_type: "Document type", source_facility: "Source facility" };

// Bad input is a 400 with the reason instead of a database error.
function checkDocumentFields(body = {}) {
  if (!String(body.title || "").trim()) throw appError(400, "Title is required.");
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (String(body[key] ?? "").trim().length > max) {
      throw appError(400, `${FIELD_LABELS[key]} must be ${max} characters or fewer.`);
    }
  }
  const date = String(body.result_date ?? "").trim();
  if (date && !isValidDateString(date)) throw appError(400, "Enter a valid document date.");
}

function uploadToCloudinary(file) {
  if (!file) return Promise.resolve({});

  return new Promise((resolve, reject) => {
    // No file name in the stored id: Cloudinary assigns a long random one, so
    // a medical document's link can't be guessed from a short suffix.
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: "qelcare-patient-results",
        resource_type: "auto",
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          logSafeError("Patient document storage error", error || new Error("Storage returned no link"));
          return reject(appError(502, "The file couldn't be stored right now. Please try again."));
        }
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

// Remove a stored file. Cloudinary only finds a file under the resource type
// it filed it as, which is part of the link ("/image/upload/", "/raw/upload/");
// with "auto" uploads a PDF is filed as an image. Best-effort: a storage
// failure never fails the request, it is only logged.
function removeFromCloudinary(fileUrl, publicId) {
  if (!publicId) return;
  const fromLink = String(fileUrl || "").match(/\/(image|raw|video)\/upload\//);
  cloudinary.uploader
    .destroy(publicId, { resource_type: fromLink ? fromLink[1] : "image", invalidate: true })
    .then((result) => {
      if (result?.result !== "ok") console.error(`Patient document storage delete: ${result?.result || "no result"}`);
    })
    .catch((err) => logSafeError("Patient document storage delete error", err));
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
      sendError(res, err, "Patient results getMine error", "Failed to fetch medical results.");
    }
  },

  async create(req, res) {
    try {
      const patient = await getMyPatient(req);
      checkDocumentFields(req.body);

      const fileData = await uploadToCloudinary(req.file);
      let result;
      try {
        result = await PatientResult.create(patient.id, req.user.user_id, req.body, fileData);
      } catch (err) {
        // The row wasn't saved: don't leave its file behind in storage.
        removeFromCloudinary(fileData.file_url, fileData.file_public_id);
        throw err;
      }
      res.status(201).json({ success: true, message: "Medical result saved.", data: result, result });
    } catch (err) {
      sendError(res, err, "Patient results create error", "Failed to save medical result.");
    }
  },

  async update(req, res) {
    try {
      const patient = await getMyPatient(req);
      checkDocumentFields(req.body);

      const result = await PatientResult.updateOwned(req.params.id, patient.id, req.body);
      if (!result) return res.status(404).json({ success: false, message: "Medical result not found." });
      res.json({ success: true, message: "Medical result updated.", data: result, result });
    } catch (err) {
      sendError(res, err, "Patient results update error", "Failed to update medical result.");
    }
  },

  async remove(req, res) {
    try {
      const patient = await getMyPatient(req);
      const existing = await PatientResult.findOwned(req.params.id, patient.id);
      if (!existing) return res.status(404).json({ success: false, message: "Medical result not found." });

      const deleted = await PatientResult.softDeleteOwned(req.params.id, patient.id);
      removeFromCloudinary(existing.file_url, existing.file_public_id);

      res.json({ success: true, message: "Medical result deleted.", data: deleted, result: deleted });
    } catch (err) {
      sendError(res, err, "Patient results delete error", "Failed to delete medical result.");
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
        console.error("OCR error: GEMINI_API_KEY is not set in the server environment.");
        return res.status(503).json({
          success: false,
          message: "Text extraction isn't available right now. You can still enter the document details manually.",
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

      // Safe, fixed messages only — the raw Gemini error stays in the log above.
      switch (gemini.errorKind(err)) {
        // A bad server key is a server problem: 503, never 401, because the
        // web and mobile clients sign the patient out on any 401.
        case "invalid_key":
          return res.status(503).json({
            success: false,
            message: "Text extraction isn't available right now. You can still enter the document details manually.",
          });
        case "timeout":
          return res.status(504).json({
            success: false,
            message: "Text extraction timed out. Try again.",
          });
        case "quota":
          return res.status(429).json({
            success: false,
            message: "Text extraction has reached its limit for now. Please try again later, or enter the document details manually.",
          });
        case "unavailable":
          return res.status(503).json({
            success: false,
            message: "Text extraction is busy right now. Please try again in a moment.",
          });
        default:
          return res.status(500).json({ success: false, message: "Text extraction failed. Please try again." });
      }
    }
  },
};

module.exports = patientResultController;
