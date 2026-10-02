const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/medicationController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const { isPositiveInt } = require("../../../shared/utils/requestValidation");

// Reject non-numeric / out-of-range ids with a 400 before any query runs.
router.param("id", (req, res, next, value) => {
  if (isPositiveInt(value)) return next();
  return res.status(400).json({ success: false, message: "Invalid medication id." });
});

router.use(authenticate);

// --- Doctor / Admin review queue (declared BEFORE the Patient-only guard) ----
router.get("/pending-review", authorize(["Doctor", "Admin"]), ctrl.pendingReview);
router.patch("/:id/approve", authorize(["Doctor", "Admin"]), ctrl.approve);
router.patch("/:id/reject", authorize(["Doctor", "Admin"]), ctrl.reject);

// Everything below is patient-only.
router.use(authorize(["Patient"]));

// OCR: parse a prescription image into structured medication rows.
router.post("/parse", express.json({ limit: "15mb" }), ctrl.parsePrescription);

// Daily schedule + dose logging + adherence.
router.get("/schedule", ctrl.schedule);
router.post("/log", ctrl.logDose);
router.get("/adherence", ctrl.adherence);

// CRUD.
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.post("/batch", ctrl.createBatch);
router.patch("/:id", ctrl.update);
router.patch("/:id/status", ctrl.setStatus);
router.delete("/:id", ctrl.remove);

module.exports = router;