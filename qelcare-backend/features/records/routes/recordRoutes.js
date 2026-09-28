const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/recordController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const { requireIdParam } = require("../../../shared/utils/requestValidation");

router.use(authenticate);

router.get("/me", authorize(["Patient"]), ctrl.getMyRecords);
router.post("/", authorize(["Doctor"]), ctrl.create);
// Clinical records are for clinical roles only. Billing staff get the billable
// services (lab_requests / requested_services) through the appointment payload,
// not the full record.
router.get("/", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getAll);
router.get("/summary", authorize(["Admin", "Nurse", "Doctor"]), ctrl.getSummary);
router.get("/patient/:patientId", authorize(["Admin", "Nurse", "Doctor"]), requireIdParam("patientId", "patient"), ctrl.getByPatient);
router.get("/:id", authorize(["Admin", "Nurse", "Doctor"]), requireIdParam("id", "medical record"), ctrl.getById);
router.put("/:id", authorize(["Doctor"]), requireIdParam("id", "medical record"), ctrl.update);
router.patch("/:id", authorize(["Doctor"]), requireIdParam("id", "medical record"), ctrl.update);

module.exports = router;
