const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../controllers/patientResultController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const { requireIdParam } = require("../../../shared/utils/requestValidation");

const allowedMime = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
]);

// One PNG, JPG, WEBP or PDF of at most 12 MB. The declared type is checked
// while the upload streams in and the file's first bytes are checked after, so
// a renamed file of another kind never reaches storage. Problems are a 400
// (413 when too large) with a message the patient can act on, never a 500.
const MAX_FILE_MB = 12;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowedMime.has(file.mimetype)) return cb(null, true);
    const error = new Error("Only PNG, JPG, WEBP, and PDF files are allowed.");
    error.code = "INVALID_DOCUMENT_TYPE";
    return cb(error);
  },
});

// What the file really is, from its first bytes (null when it is none of the
// allowed kinds). A PDF may have a few bytes before its "%PDF-" marker.
function detectFileType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.subarray(0, 1024).includes("%PDF-")) return "application/pdf";
  return null;
}

function receiveDocumentFile(req, res, next) {
  upload.single("resultFile")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ success: false, message: `The file is too large. Files can be up to ${MAX_FILE_MB} MB.` });
      }
      if (err.code === "LIMIT_FIELD_VALUE") {
        return res.status(413).json({ success: false, message: "The document text is too long to save." });
      }
      return res.status(400).json({ success: false, message: "Attach one file at a time." });
    }
    if (err?.code === "INVALID_DOCUMENT_TYPE") return res.status(400).json({ success: false, message: err.message });
    if (err) return next(err);
    if (req.file) {
      const detected = detectFileType(req.file.buffer);
      if (!detected) {
        return res.status(400).json({ success: false, message: "The file is not a valid PNG, JPG, WEBP, or PDF." });
      }
      // Store the type the file really is, not the one the browser declared.
      req.file.mimetype = detected;
    }
    return next();
  });
}

router.use(authenticate);
router.use(authorize(["Patient"]));

router.get("/me", ctrl.getMine);
router.post("/ocr", express.json({ limit: "15mb" }), ctrl.ocrImage);
router.post("/", receiveDocumentFile, ctrl.create);
router.patch("/:id", requireIdParam("id", "document"), ctrl.update);
router.delete("/:id", requireIdParam("id", "document"), ctrl.remove);

module.exports = router;
