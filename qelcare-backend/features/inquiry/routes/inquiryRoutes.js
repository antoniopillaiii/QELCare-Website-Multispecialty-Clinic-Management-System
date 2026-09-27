const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const ctrl = require("../controllers/inquiryController");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");

// Anonymous submissions are throttled per client IP (trust proxy = 1 in
// server.js, so this is the real visitor IP). A person sending a question or
// two is never affected; a script flooding the inbox is stopped.
const inquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many inquiries sent from this connection. Please wait a few minutes and try again, or call the clinic." },
});

router.param("id", (req, res, next, value) => {
  if (/^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647) return next();
  return res.status(400).json({ success: false, message: "Invalid inquiry id." });
});

// Public: anyone (no account) can submit an inquiry.
router.post("/", inquiryLimiter, ctrl.create);

// Staff inbox: Admin / Front desk only.
router.get("/", authenticate, authorize(["Admin", "Frontdesk"]), ctrl.list);
router.patch("/:id", authenticate, authorize(["Admin", "Frontdesk"]), ctrl.update);

module.exports = router;
