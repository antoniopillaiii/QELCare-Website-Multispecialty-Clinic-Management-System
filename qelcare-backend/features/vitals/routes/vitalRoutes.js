const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/vitalController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const { isPositiveInt } = require("../../../shared/utils/requestValidation");

// Reject non-numeric / out-of-range ids with a 400 before any query runs.
function requireIdParam(label) {
  return (req, res, next, value) => {
    if (isPositiveInt(value)) return next();
    return res.status(400).json({ success: false, message: `Invalid ${label} id.` });
  };
}
router.param("id", requireIdParam("vitals"));
router.param("patientId", requireIdParam("patient"));
router.param("appointmentId", requireIdParam("appointment"));

router.use(authenticate);

router.get("/me", authorize(["Patient"]), ctrl.getMyVitals);
router.post("/", authorize(["Admin", "Nurse"]), ctrl.create);
router.get("/patient/:patientId/latest", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getLatest);
router.get("/patient/:patientId", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getByPatient);
router.get("/appointment/:appointmentId", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getByAppointment);
router.get("/:id", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getById);

module.exports = router;
