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
// Counts for the Admin screen's patient / doctor pickers. Admin only: it names
// doctor accounts with their current status and role, which other roles don't see.
router.get("/filter-options", authorize(["Admin"]), ctrl.getFilterOptions);
router.get("/patient/:patientId", authorize(["Admin", "Nurse", "Doctor"]), requireIdParam("patientId", "patient"), ctrl.getByPatient);
router.get("/:id", authorize(["Admin", "Nurse", "Doctor"]), requireIdParam("id", "medical record"), ctrl.getById);
router.put("/:id", authorize(["Doctor"]), requireIdParam("id", "medical record"), ctrl.update);
router.patch("/:id", authorize(["Doctor"]), requireIdParam("id", "medical record"), ctrl.update);

module.exports = router;
