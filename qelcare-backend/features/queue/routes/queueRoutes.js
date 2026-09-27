const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/queueController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");

router.get("/display", ctrl.getDisplay);

// Reject non-numeric / out-of-range ids with a 400 before any query runs.
function requireIdParam(label) {
  return (req, res, next, value) => {
    if (/^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647) return next();
    return res.status(400).json({ success: false, message: `Invalid ${label} id.` });
  };
}
router.param("queueId", requireIdParam("queue"));
router.param("specialtyId", requireIdParam("specialty"));

router.use(authenticate);

router.get(
  "/specialties",
  authorize(["Admin", "Nurse", "Doctor", "Frontdesk"]),
  ctrl.getSpecialties
);

router.get(
  "/specialty/:specialtyId",
  authorize(["Admin", "Nurse", "Doctor", "Frontdesk"]),
  ctrl.getQueueBySpecialty
);

router.post(
  "/auto-enqueue",
  authorize(["Admin", "Frontdesk"]),
  ctrl.autoEnqueue
);

router.patch(
  "/:queueId/status",
  authorize(["Admin", "Nurse", "Doctor", "Frontdesk"]),
  ctrl.updateStatus
);

module.exports = router;
