const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/appointmentController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");

// Reject non-numeric / out-of-range ids with a 400 before any query runs.
function requireIdParam(label) {
  return (req, res, next, value) => {
    if (/^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647) return next();
    return res.status(400).json({ success: false, message: `Invalid ${label} id.` });
  };
}
router.param("id", requireIdParam("appointment"));
router.param("doctorId", requireIdParam("doctor"));

router.use(authenticate);

router.get("/me", authorize(["Patient"]), ctrl.getMyAppointments);
router.post("/book", authorize(["Patient"]), ctrl.bookMyAppointment);
// Patient self-service on their OWN appointments.
router.post("/:id/cancel", authorize(["Patient"]), ctrl.cancelMine);
router.put("/:id/edit", authorize(["Patient"]), ctrl.editMine);
router.patch("/:id/edit", authorize(["Patient"]), ctrl.editMine);

router.post("/", authorize(["Admin", "Frontdesk"]), ctrl.create);
router.get("/", authorize(["Admin", "Nurse", "Doctor", "Cashier", "Frontdesk"]), ctrl.getAll);
router.get("/stats", authorize(["Admin", "Frontdesk"]), ctrl.getStats);
router.get("/today/:doctorId?", authorize(["Admin", "Nurse", "Doctor", "Frontdesk"]), ctrl.getTodayByDoctor);

// Bulk settle of long-past, unresolved appointments (Admin only).
router.post("/sweep-past", authorize(["Admin"]), ctrl.sweepPast);

router.get("/:id", authorize(["Admin", "Nurse", "Doctor", "Cashier", "Frontdesk"]), ctrl.getById);
router.put("/:id/status", authorize(["Admin", "Frontdesk"]), ctrl.updateStatus);
router.patch("/:id/status", authorize(["Admin", "Frontdesk"]), ctrl.updateStatus);

// Explicit settle of a single past appointment (NO_SHOW / CANCELLED).
router.post("/:id/settle", authorize(["Admin", "Frontdesk"]), ctrl.settlePast);

router.put("/:id/reschedule", authorize(["Admin", "Frontdesk"]), ctrl.reschedule);
router.patch("/:id/reschedule", authorize(["Admin", "Frontdesk"]), ctrl.reschedule);

module.exports = router;
