const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const tokenManager = require("./shared/utils/tokenManager");
const Appointment = require("./features/appointment/models/Appointment");
const DeviceToken = require("./features/notification/models/DeviceToken");
const { sweepStaleQueue } = require("./shared/utils/queueSweep");

const app = express();

// Behind Railway's proxy/load balancer. Trust exactly ONE hop so:
//  (a) express-rate-limit reads the real client IP from X-Forwarded-For (not the
//      proxy's) — otherwise every request shares one key and the limits are wrong,
//  (b) req.secure / protocol detection is correct for HTTPS.
// Use `1`, never `true`: `true` lets a client spoof X-Forwarded-For to dodge limits.
app.set("trust proxy", 1);

// Never advertise the server framework (helmet also hides this; be explicit).
app.disable("x-powered-by");

// ── Security headers (helmet) ─────────────────────────────────
// This service is a JSON API; the browser app is the React build on Vercel
// (which carries its own headers via my-app/vercel.json). We still send a full,
// explicit header set here so the API scores an A on its own and so any HTML it
// emits (errors, health checks) is locked down. connect/img sources also cover
// the backend's own outbound integrations for scanner parity + defence in depth.
const CLOUDINARY_IMG = "https://res.cloudinary.com";
const CLOUDINARY_API = "https://api.cloudinary.com";
const GEMINI_API = "https://generativelanguage.googleapis.com";

app.use(
  helmet({
    // Relaxed so a cross-origin <img> (Cloudinary / any backend-served asset) is
    // not blocked by Cross-Origin-Resource-Policy when embedded from Vercel.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // HSTS: 1 year, subdomains, preload — mirrors what the frontend advertises.
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    // Clickjacking: this API is never meant to be framed.
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", CLOUDINARY_IMG],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", GEMINI_API, CLOUDINARY_API, CLOUDINARY_IMG],
        workerSrc: ["'self'", "blob:"],
      },
    },
  })
);

// Helmet dropped Permissions-Policy years ago; set it ourselves to switch off
// browser features this API/app never uses (blunts abuse if HTML is ever served).
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()"
  );
  next();
});

// ── Rate limiters ─────────────────────────────────────────────
// IP-based throttles on the auth surface, layered on top of the per-email OTP
// cooldown and the per-account login lockout already enforced in the DB layer.
const rateLimitOptions = { standardHeaders: true, legacyHeaders: false };

// General auth traffic (registration, verification, token ops).
const authLimiter = rateLimit({
  ...rateLimitOptions,
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: "Too many requests. Please try again later." },
});

// Tighter limit for credential and OTP endpoints (brute-force / spam defence).
const loginLimiter = rateLimit({
  ...rateLimitOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many attempts. Please wait a few minutes and try again." },
});

const otpLimiter = rateLimit({
  ...rateLimitOptions,
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { success: false, message: "Too many verification requests. Please wait and try again." },
});

// Public queue display (waiting-room screens poll it). It is read-only, but it
// is also unauthenticated — cap the per-IP rate so it can't be hammered.
const displayLimiter = rateLimit({
  ...rateLimitOptions,
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many requests. Please slow down." },
});

// Patient listing/search is already RBAC-gated (staff only), but a stolen staff
// token could bulk-enumerate records. This is a high anti-abuse backstop, not a
// UX throttle: the ceiling is deliberately generous so a shared clinic/NAT IP
// with several receptionists (incl. type-ahead search) is never blocked in normal
// use. A runaway scraper does thousands/min and trips it; humans never will.
// Lower `max` if you switch to per-user keying (keyGenerator on req.user).
const patientSearchLimiter = rateLimit({
  ...rateLimitOptions,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  // Exempt the patient self-read: GET /patients/me returns only the caller's own
  // record (not enumerable), and patient phones share carrier-grade NAT IPs — a
  // shared per-IP cap could wrongly throttle many unrelated patients. The staff
  // list/detail routes (the actual enumeration surface) stay limited.
  skip: (req) =>
    req.method === "GET" && req.originalUrl.split("?")[0] === "/patients/me",
  message: { success: false, message: "Too many requests. Please slow down." },
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5002",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  "http://192.168.1.155:3000",
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
require("./config/database");

// Throttle the sensitive auth endpoints (must be registered before the routers).
app.use("/auth/login", loginLimiter);
app.use("/auth/otp", otpLimiter);
app.use("/auth/password", loginLimiter);
app.use("/auth/patient", authLimiter);
app.use("/queue/display", displayLimiter);
app.use("/patients", patientSearchLimiter);

app.use("/auth/patient", require("./features/auth/routes/patientRegistrationRoutes"));
app.use("/auth", require("./features/auth/routes/authRoutes"));
app.use("/users", require("./features/user/routes/userRoutes"));
app.use("/patients", require("./features/patient/routes/patientRoutes"));
app.use("/appointments", require("./features/appointment/routes/appointmentRoutes"));
app.use("/notifications", require("./features/notification/routes/notificationRoutes"));
app.use("/medical-records", require("./features/records/routes/recordRoutes"));
app.use("/patient-results", require("./features/patientResults/routes/patientResultRoutes"));
app.use("/medications", require("./features/medication/routes/medicationRoutes"));
app.use("/vitals", require("./features/vitals/routes/vitalRoutes"));
app.use("/billing", require("./features/billing/routes/billingRoutes"));
app.use("/queue", require("./features/queue/routes/queueRoutes"));
app.use("/analytics", require("./features/analytics/routes/analyticsRoutes"));
app.use("/activity-logs", require("./features/auth/routes/activityLogRoutes"));
app.use("/inquiries", require("./features/inquiry/routes/inquiryRoutes"));
app.use("/relatives", require("./features/relative/routes/relativeRoutes"));

app.get("/", (_req, res) => res.json({ message: "QELCare Backend is running." }));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.use((req, res) => res.status(404).json({ message: "Route not found." }));
app.use((err, _req, res, _next) => {
  console.error("Server error:", err.message);
  res.status(err.status || 500).json({ message: "Internal server error." });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`QELCare backend running on http://localhost:${PORT}`));

// Ensure the push-notification device-token table exists (idempotent). Runs once
// at boot so there is no separate migration step on deploy; guarded so a DDL
// permission issue can never crash the server.
DeviceToken.ensureSchema()
  .then(() => console.log("device_tokens table ready."))
  .catch((err) => console.error("device_tokens ensureSchema error:", err.message));

setInterval(async () => {
  try {
    await tokenManager.cleanupExpiredTokens();
  } catch (err) {
    console.error("Token cleanup error:", err.message);
  }
}, 60 * 60 * 1000);

// Auto-settle past, unresolved appointments so none sit stuck as PENDING.
// Runs shortly after boot, then hourly. Grace period = 120 min after the slot.
async function runAppointmentSweep() {
  try {
    const result = await Appointment.autoSettlePastAppointments({ graceMinutes: 120 });
    if (result.settled > 0) {
      console.log(`Appointment sweep: settled ${result.settled} past appointment(s) to NO_SHOW.`);
    }
    // Also resolve stale live-queue entries (past-day leftovers + skipped
    // no-shows) that a slot-based sweep can't see, and notify those patients.
    const queueResult = await sweepStaleQueue({ skipGraceMinutes: 30, clinicCloseHour: 20 });
    if (queueResult.appointments.length > 0) {
      console.log(`Queue sweep: no-showed ${queueResult.appointments.length} stale queued appointment(s).`);
    }
  } catch (err) {
    console.error("Appointment sweep error:", err.message);
  }
}

setTimeout(runAppointmentSweep, 15 * 1000);
setInterval(runAppointmentSweep, 60 * 60 * 1000);
