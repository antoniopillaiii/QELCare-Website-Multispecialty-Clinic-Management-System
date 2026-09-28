// ============================================================================
// QELCare patient self-registration routes
// ----------------------------------------------------------------------------
// PRIMARY FIX (the bug you hit):
//   Registration used to COMMIT the new `unverified` user and ONLY THEN try to
//   send the OTP. If the email failed, you were left with an account that
//   could never be verified. Now the user row AND the OTP are created in the
//   SAME transaction: if the verification email cannot be sent, the whole
//   thing rolls back and the user can simply try again. No stranded accounts.
//
// SECONDARY FIXES:
//   * Case-insensitive duplicate check on username and email.
//   * Structured error codes passed through to the frontend.
//   * OTP issued via authService.sendOTP({ client, skipUserCheck }) so it
//     participates in the transaction.
// ============================================================================

const router = require("express").Router();
const bcrypt = require("bcrypt");
const pool = require("../../../config/database");
const logger = require("../../../shared/utils/activityLogger");
const { authenticate, authorize } = require("../../../shared/middleware/tokenMiddleware");
const authService = require("../services/authService");
const { ageOnManilaToday } = require("../../../shared/utils/manilaTime");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");
const profileRules = require("../../../shared/utils/profileRules");
const {
  validateEmail,
  validateOTPCode,
  validatePasswordStrength,
} = require("../validators/authValidator");

const OTP_PURPOSE_REGISTRATION = authService.PURPOSES.REGISTRATION;
const OTP_PURPOSE_PROFILE = authService.PURPOSES.PROFILE_UPDATE;

const LIMITS = {
  username: 50,
  email: 100,
  first_name: 50,
  last_name: 50,
  middle_name: 50,
  suffix: 10,
  phone: 20,
  alternate_phone: 20,
  gender: 10,
};

function clean(value) {
  return String(value || "").trim();
}
function normalizeEmail(value) {
  return authService.normalizeEmail(value);
}
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validUsername(value) {
  return new RegExp(`^[a-zA-Z][a-zA-Z0-9._-]{2,${LIMITS.username - 1}}$`).test(value);
}
function addMaxLengthError(errors, label, value, max) {
  if (value && String(value).length > max) errors.push(`${label} must be ${max} characters or less.`);
}
function validateSqlLengths(errors, fields) {
  addMaxLengthError(errors, "Username", fields.username, LIMITS.username);
  addMaxLengthError(errors, "Email", fields.email, LIMITS.email);
  addMaxLengthError(errors, "First name", fields.firstName, LIMITS.first_name);
  addMaxLengthError(errors, "Last name", fields.lastName, LIMITS.last_name);
  addMaxLengthError(errors, "Middle name", fields.middleName, LIMITS.middle_name);
  addMaxLengthError(errors, "Suffix", fields.suffix, LIMITS.suffix);
  addMaxLengthError(errors, "Phone", fields.phone, LIMITS.phone);
  addMaxLengthError(errors, "Alternate phone", fields.alternatePhone, LIMITS.alternate_phone);
  addMaxLengthError(errors, "Gender", fields.gender, LIMITS.gender);
}
// Age as of the clinic's current day (Asia/Manila), independent of the server's
// time zone — so a birthday counts from Manila midnight, not UTC midnight.
function calcAge(dateValue) {
  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  return ageOnManilaToday(dateValue);
}
function validPhone(value) {
  if (!value) return true;
  const cleaned = String(value).replace(/[\s\-()]/g, "");
  return /^(09\d{9}|\+639\d{9}|\+\d{10,14})$/.test(cleaned);
}

const dns = require("dns").promises;

// Names: letters (incl. accents), spaces, hyphen, apostrophe, period only.
const NAME_REGEX = /^[A-Za-zÀ-ÿ.'\- ]+$/;

// Capitalize the first letter of every word so "kelly celocia" is stored as
// "Kelly Celocia" and an ALL-CAPS "JUAN" as "Juan", but keep intentional mixed
// case such as "McArthur" or "DeLeon" exactly as typed. Mirrors formatName() on
// the Sign Up screen (web + mobile).
function toTitleCase(value) {
  return clean(value)
    .replace(/[A-Za-zÀ-ÿ]+/g, (word) => (word.length > 1 && word === word.toUpperCase() ? word.toLowerCase() : word))
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// Throwaway / temporary mail providers we reject for real accounts.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
  "guerrillamail.com", "sharklasers.com", "yopmail.com", "trashmail.com",
  "getnada.com", "throwawaymail.com", "fakeinbox.com", "maildrop.cc",
  "dispostable.com", "mintemail.com", "discard.email",
]);

// Verify the email's DOMAIN can actually receive mail (has MX or A records), so a
// dummy/typo domain is rejected up front instead of being "successfully sent".
// Fails OPEN on transient DNS/network errors so a flaky connection never blocks a
// genuine sign-up. (A real mailbox at a real provider can't be verified
// synchronously — which is exactly why we still require OTP verification after.)
async function checkEmailDeliverable(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase();
  if (!domain) return { ok: false, message: "A valid email is required." };
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, message: "Temporary or disposable email addresses are not allowed. Please use a real email." };
  }
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length > 0) return { ok: true };
    const a = await dns.resolve(domain).catch(() => []);
    if (a && a.length > 0) return { ok: true };
    return { ok: false, message: "This email's domain can't receive mail. Please check the address for typos." };
  } catch (err) {
    if (err && (err.code === "ENOTFOUND" || err.code === "ENODATA")) {
      const a = await dns.resolve(domain).catch(() => []);
      if (a && a.length > 0) return { ok: true };
      return { ok: false, message: "This email's domain doesn't exist. Please check the address for typos." };
    }
    return { ok: true }; // transient DNS error -> don't block a real user
  }
}

function validateRegistration(body) {
  const username = clean(body.username).toLowerCase();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const firstNameRaw = clean(body.first_name);
  const lastNameRaw = clean(body.last_name);
  const firstName = toTitleCase(firstNameRaw); // "kelly" -> "Kelly"
  const lastName = toTitleCase(lastNameRaw);
  const phone = profileRules.normalizePhone(body.phone); // stored without spaces/hyphens, like the profile
  const dateOfBirth = clean(body.date_of_birth);

  const errors = [];
  if (!firstNameRaw) errors.push("First name is required.");
  else if (firstNameRaw.length < 2) errors.push("First name must be at least 2 characters.");
  else if (!NAME_REGEX.test(firstNameRaw)) errors.push("First name can only contain letters, spaces, hyphens, and apostrophes.");

  if (!lastNameRaw) errors.push("Last name is required.");
  else if (lastNameRaw.length < 2) errors.push("Last name must be at least 2 characters.");
  else if (!NAME_REGEX.test(lastNameRaw)) errors.push("Last name can only contain letters, spaces, hyphens, and apostrophes.");

  if (!dateOfBirth) errors.push("Date of birth is required.");

  const age = calcAge(dateOfBirth);
  if (dateOfBirth && (age === null || age < 0 || age > 120)) errors.push("Please enter a valid date of birth.");
  else if (dateOfBirth && age < 1) errors.push("Date of birth must be at least 1 year ago.");
  if (phone && !validPhone(phone)) errors.push("Invalid phone number. Use 09XXXXXXXXX or +639XXXXXXXXX format.");

  if (!email || !isEmail(email)) errors.push("A valid email is required.");
  if (!username) errors.push("Username is required.");
  if (username && !validUsername(username)) {
    errors.push("Username must start with a letter and be 3-50 characters using letters, numbers, dot, underscore, or hyphen.");
  }
  validateSqlLengths(errors, { username, email, firstName, lastName, phone });
  errors.push(...validatePasswordStrength(password));

  return {
    errors,
    data: { username, email, password, firstName, lastName, phone, dateOfBirth },
  };
}

async function getPatientRoleId(client = pool) {
  const role = await client.query("SELECT role_id FROM roles WHERE role_name = 'Patient'");
  if (role.rows[0]?.role_id) return role.rows[0].role_id;
  const inserted = await client.query("INSERT INTO roles (role_name) VALUES ('Patient') RETURNING role_id");
  return inserted.rows[0].role_id;
}

// ---------------------------------------------------------------------------
// POST /auth/patient/register
// ---------------------------------------------------------------------------
router.post("/register", async (req, res) => {
  const client = await pool.connect();
  try {
    const { errors, data } = validateRegistration(req.body);
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    // Data Privacy Act (RA 10173) consent is mandatory and must be recorded.
    const privacyAgreed = req.body.privacy_agreed === true || req.body.privacy_agreed === "true";
    if (!privacyAgreed) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the Data Privacy Statement and Terms of Service to register.",
      });
    }
    const privacyVersion = String(req.body.privacy_version || "1.0").slice(0, 20);

    // Reject dummy / non-deliverable email domains BEFORE creating anything or
    // claiming a verification code was sent.
    const deliverable = await checkEmailDeliverable(data.email);
    if (!deliverable.ok) {
      return res.status(400).json({ success: false, code: "EMAIL_UNDELIVERABLE", message: deliverable.message });
    }

    await client.query("BEGIN");
    const patientRoleId = await getPatientRoleId(client);

    const duplicate = await client.query(
      `SELECT LOWER(username) = LOWER($1) AS username_taken, LOWER(email) = LOWER($2) AS email_taken
         FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)`,
      [data.username, data.email]
    );
    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      // Name the taken field(s) so Sign Up can send the patient back to the
      // right step. (Saying "already exists" at all reveals as much, so naming
      // the field adds no enumeration risk.)
      const fields = [
        ...(duplicate.rows.some((row) => row.username_taken) ? ["username"] : []),
        ...(duplicate.rows.some((row) => row.email_taken) ? ["email"] : []),
      ];
      const message = fields.length === 2
        ? "That username and email are already registered."
        : fields[0] === "email"
          ? "An account with this email already exists. Sign in instead, or use a different email."
          : "That username is already taken. Please choose another.";
      return res.status(409).json({ success: false, code: "DUPLICATE", field: fields[0], fields, message });
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const userResult = await client.query(
      `INSERT INTO users
         (role_id, username, email, password, first_name, last_name, phone, date_of_birth, status, privacy_agreed_at, privacy_version, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, 'unverified', NOW(), $9, NOW(), NOW())
       RETURNING user_id, username, email, first_name, last_name, phone, date_of_birth, status`,
      [
        patientRoleId,
        data.username,
        data.email,
        hashedPassword,
        data.firstName,
        data.lastName,
        data.phone || null,
        data.dateOfBirth,
        privacyVersion,
      ]
    );
    const user = userResult.rows[0];

    // Persist the OTP row INSIDE the transaction (DB-only, no network) so it
    // can't trigger the pg "client already executing a query" warning.
    const persisted = await authService.persistOtpRow(data.email, OTP_PURPOSE_REGISTRATION, client);
    if (!persisted.ok) {
      await client.query("ROLLBACK");
      return res.status(persisted.result.status || 429).json(persisted.result);
    }

    // Commit user + OTP together, THEN send the email outside the transaction.
    await client.query("COMMIT");

    const delivery = await authService.deliverOtpEmail(data.email, persisted.otp, {
      firstName: data.firstName,
      subject: "QELCare - Patient Registration Verification Code",
    });

    if (!delivery.success) {
      // Email failed in production-style mode -> remove the account + OTP so
      // nothing is stranded. (In dev fallback the code is logged and
      // delivery.success is true, so this branch is skipped.)
      await pool.query("DELETE FROM otp_requests WHERE LOWER(email) = LOWER($1) AND purpose = $2", [data.email, OTP_PURPOSE_REGISTRATION]);
      await pool.query("DELETE FROM users WHERE user_id = $1", [user.user_id]);
      return res.status(delivery.status || 502).json({
        success: false,
        code: delivery.code || "OTP_SEND_FAILED",
        message: `Could not send the verification code: ${delivery.message} Your account was not created — please try again.`,
      });
    }

    await logger.log({
      userId: user.user_id,
      action: "PATIENT_REGISTERED",
      entityType: "user",
      entityId: user.user_id,
      description: `${user.username} created a patient account and is awaiting email verification.`,
      ip: logger.getIP(req),
      metadata: { email: user.email, otp_sent: true, dev_fallback: Boolean(delivery.dev), privacy_version: privacyVersion },
    });

    return res.status(201).json({
      success: true,
      message: delivery.message,
      dev_fallback: Boolean(delivery.dev),
      data: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        status: user.status,
      },
      otp_sent: true,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    logSafeError("Patient register error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to register patient account." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /auth/patient/register/resend
// ---------------------------------------------------------------------------
router.post("/register/resend", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const errors = validateEmail(email);
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    const channel = String(req.body.channel || "email").toLowerCase();
    const userResult = await pool.query(
      `SELECT u.user_id, u.email, u.first_name, u.phone, u.alternate_phone, u.status
         FROM users u
         JOIN roles r ON u.role_id = r.role_id
        WHERE LOWER(u.email) = LOWER($1) AND r.role_name = 'Patient'`,
      [email]
    );

    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, code: "NO_ACCOUNT", message: "Patient account not found." });
    if (user.status === "verified") return res.status(400).json({ success: false, code: "ALREADY_VERIFIED", message: "Account is already verified." });
    if (user.status === "deactivated") return res.status(403).json({ success: false, code: "ACCOUNT_DEACTIVATED", message: "Account is deactivated." });

    const result = await authService.resendOTP(email, {
      channel,
      phone: user.phone || user.alternate_phone || null,
      skipUserCheck: true,
      purpose: OTP_PURPOSE_REGISTRATION,
      firstName: user.first_name,
      subject: "QELCare - Patient Registration Verification Code",
    });

    return res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      channel: result.channel,
      retry_after: result.retry_after,
      dev_fallback: Boolean(result.dev),
      message: result.message,
    });
  } catch (err) {
    logSafeError("Resend patient registration OTP error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to resend verification code." });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/patient/register/verify
// ---------------------------------------------------------------------------
router.post("/register/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    const email = normalizeEmail(req.body.email);
    const code = clean(req.body.code);
    const errors = [...validateEmail(email), ...validateOTPCode(code)];
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT u.user_id, u.username, u.email, u.first_name, u.last_name, u.phone, u.date_of_birth, u.status
         FROM users u
         JOIN roles r ON u.role_id = r.role_id
        WHERE LOWER(u.email) = LOWER($1) AND r.role_name = 'Patient'
        FOR UPDATE OF u`,
      [email]
    );

    const user = userResult.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "NO_ACCOUNT", message: "Patient account not found." });
    }
    if (user.status === "verified") {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, code: "ALREADY_VERIFIED", message: "Account is already verified." });
    }
    if (user.status === "deactivated") {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, code: "ACCOUNT_DEACTIVATED", message: "Account is deactivated." });
    }

    const otp = await authService.verifyOTP(email, code, {
      client,
      purpose: OTP_PURPOSE_REGISTRATION,
      consume: true,
    });
    if (!otp.success) {
      // Commit so the incremented attempt counter persists.
      await client.query("COMMIT");
      return res.status(otp.status || 400).json({ success: false, code: otp.code, message: otp.message, attempts_left: otp.attempts_left });
    }

    await client.query(
      `UPDATE users
          SET status = 'verified',
              failed_login_attempts = 0,
              lockout_until = NULL,
              updated_at = NOW()
        WHERE user_id = $1`,
      [user.user_id]
    );

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username;
    await client.query(
      `INSERT INTO patients
         (user_id, first_name, last_name, name, email, phone, contact, date_of_birth, is_active, created_by, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $6, $7, TRUE, $1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         first_name    = EXCLUDED.first_name,
         last_name     = EXCLUDED.last_name,
         name          = EXCLUDED.name,
         email         = EXCLUDED.email,
         phone         = EXCLUDED.phone,
         contact       = EXCLUDED.contact,
         date_of_birth = EXCLUDED.date_of_birth,
         is_active     = TRUE,
         updated_at    = NOW()`,
      [user.user_id, user.first_name || "", user.last_name || "", fullName, user.email, user.phone || null, user.date_of_birth || null]
    );

    await client.query("COMMIT");

    await logger.log({
      userId: user.user_id,
      action: "PATIENT_VERIFIED",
      entityType: "user",
      entityId: user.user_id,
      description: `${user.username} verified their patient account.`,
      ip: logger.getIP(req),
    });

    return res.json({ success: true, message: "Patient account verified. You can now sign in." });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    logSafeError("Verify patient registration error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to verify patient account." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /auth/patient/profile/otp  (send profile-update OTP)
// ---------------------------------------------------------------------------
router.post("/profile/otp", authenticate, authorize(["Patient"]), async (req, res) => {
  try {
    const userResult = await pool.query("SELECT email, first_name, status FROM users WHERE user_id = $1", [req.user.user_id]);
    const user = userResult.rows[0];
    if (!user?.email) return res.status(404).json({ success: false, code: "NO_EMAIL", message: "Account email not found." });
    if (user.status !== "verified") return res.status(403).json({ success: false, code: "NOT_VERIFIED", message: "Account must be verified first." });

    const result = await authService.sendOTP(user.email, {
      channel: String(req.body.channel || "email").toLowerCase(),
      purpose: OTP_PURPOSE_PROFILE,
      firstName: user.first_name,
      subject: "QELCare - Profile Update Verification Code",
    });
    return res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      channel: result.channel,
      retry_after: result.retry_after,
      dev_fallback: Boolean(result.dev),
      message: result.message,
    });
  } catch (err) {
    logSafeError("Profile OTP send error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to send profile update code." });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/patient/profile/otp/check
// ---------------------------------------------------------------------------
router.post("/profile/otp/check", authenticate, authorize(["Patient"]), async (req, res) => {
  try {
    const userResult = await pool.query("SELECT email FROM users WHERE user_id = $1", [req.user.user_id]);
    const email = userResult.rows[0]?.email;
    if (!email) return res.status(404).json({ success: false, code: "NO_EMAIL", message: "Account email not found." });

    const code = clean(req.body.code);
    const errors = validateOTPCode(code);
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    const result = await authService.verifyOTP(email, code, {
      purpose: OTP_PURPOSE_PROFILE,
      consume: false,
    });
    return res.status(result.status || (result.success ? 200 : 400)).json({
      success: result.success,
      code: result.code,
      message: result.message,
      attempts_left: result.attempts_left,
    });
  } catch (err) {
    logSafeError("Profile OTP check error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to verify profile update code." });
  }
});

// ---------------------------------------------------------------------------
// PUT /auth/patient/profile
// ---------------------------------------------------------------------------
// Every patient profile save, from the website or the mobile app, goes through
// here. Changing the username, email, phone, alternate phone or address needs
// a valid emailed code (POST /profile/otp); the check is made here, so no
// client can skip it. The linked patients row is updated in the same
// transaction. Region/province/municipality/barangay codes are only changed
// when the request includes them (the mobile form doesn't) and count as
// address changes.
const ADDRESS_CODE_KEYS = profileRules.ADDRESS_CODE_FIELDS.map(([key]) => key);
const SENSITIVE_PROFILE_FIELDS = ["username", "email", "phone", "alternate_phone", "address_line", ...ADDRESS_CODE_KEYS];
// Account field -> linked patients column(s).
const PATIENT_RECORD_COLUMNS = {
  first_name: ["first_name"],
  last_name: ["last_name"],
  middle_name: ["middle_name"],
  suffix: ["suffix"],
  email: ["email"],
  phone: ["phone", "contact"],
  gender: ["gender"],
  date_of_birth: ["date_of_birth"],
  address_line: ["address"],
};

// Value used to decide whether a field changed: null and "" are the same,
// email case and phone spacing don't count as a change.
function comparableProfileValue(field, value) {
  const textValue = profileRules.text(value);
  if (field === "email" || field === "username") return textValue.toLowerCase();
  if (field === "phone" || field === "alternate_phone") return profileRules.normalizePhone(textValue);
  return textValue;
}

router.put("/profile", authenticate, authorize(["Patient"]), async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.user_id;
    const body = req.body || {};
    const username = profileRules.text(body.username).toLowerCase();
    const email = normalizeEmail(body.email);
    const firstName = profileRules.text(body.first_name);
    const lastName = profileRules.text(body.last_name);
    const middleName = profileRules.text(body.middle_name);
    const suffix = profileRules.text(body.suffix);
    const phone = profileRules.normalizePhone(body.phone);
    const alternatePhone = profileRules.normalizePhone(body.alternate_phone);
    const gender = profileRules.text(body.gender) || null;
    const dateOfBirth = profileRules.text(body.date_of_birth) || null;
    const addressLine = profileRules.text(body.address_line);
    const otpCode = profileRules.text(body.otp_code);
    const codes = Object.fromEntries(
      ADDRESS_CODE_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, profileRules.text(body[key])])
    );

    const errors = [];
    if (!username) errors.push("Username is required.");
    if (username && !validUsername(username)) errors.push("Username must start with a letter and be 3-50 characters using letters, numbers, dot, underscore, or hyphen.");
    if (!email || !isEmail(email)) errors.push("A valid email is required.");
    errors.push(
      ...[
        profileRules.requiredNameError(firstName, "First name"),
        profileRules.requiredNameError(lastName, "Last name"),
        profileRules.optionalNameError(middleName, "Middle name", LIMITS.middle_name),
        profileRules.optionalNameError(suffix, "Suffix", LIMITS.suffix),
        gender && !["Male", "Female", "Other"].includes(gender) ? "Invalid gender." : null,
        profileRules.phoneError(phone, "Phone"),
        profileRules.phoneError(alternatePhone, "Alternate phone"),
        profileRules.birthDateError(dateOfBirth),
      ].filter(Boolean),
      ...profileRules.addressCodeErrors(codes)
    );
    validateSqlLengths(errors, { username, email });
    if (errors.length > 0) return res.status(400).json({ success: false, errors, message: errors[0] });

    await client.query("BEGIN");

    const currentResult = await client.query(
      `SELECT u.user_id, u.username, u.email, u.first_name, u.last_name, u.middle_name, u.suffix,
              u.phone, u.alternate_phone, u.gender, TO_CHAR(u.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              u.profile_picture, ua.region_code, ua.province_code, ua.municipality_code, ua.barangay_code,
              ua.address_line
         FROM users u
         LEFT JOIN user_addresses ua ON ua.user_id = u.user_id
        WHERE u.user_id = $1
        FOR UPDATE OF u`,
      [userId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "NO_ACCOUNT", message: "User not found." });
    }
    // A date of birth given at registration can be corrected, not removed.
    if (!dateOfBirth && current.date_of_birth) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Date of birth is required." });
    }

    const next = {
      username,
      email,
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      suffix,
      phone,
      alternate_phone: alternatePhone,
      gender,
      date_of_birth: dateOfBirth,
      ...Object.fromEntries(ADDRESS_CODE_KEYS.map((key) => [key, key in codes ? codes[key] : profileRules.text(current[key])])),
      address_line: addressLine,
    };
    const changed = Object.keys(next).filter(
      (field) => comparableProfileValue(field, next[field]) !== comparableProfileValue(field, current[field])
    );

    if (changed.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: true, changed: false, message: "No changes to save.", data: current });
    }

    const sensitiveChanged = changed.some((field) => SENSITIVE_PROFILE_FIELDS.includes(field));
    if (sensitiveChanged) {
      if (!otpCode) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          code: "OTP_REQUIRED",
          message: "Enter the verification code sent to your email to change your username, email, phone, or address.",
        });
      }
      const otp = await authService.verifyOTP(current.email, otpCode, {
        client,
        purpose: OTP_PURPOSE_PROFILE,
        consume: true,
      });
      if (!otp.success) {
        // Commit so the failed attempt counts against the code.
        await client.query("COMMIT");
        return res.status(otp.status || 400).json({ success: false, code: otp.code, message: otp.message, attempts_left: otp.attempts_left });
      }
    }

    const duplicate = await client.query(
      `SELECT user_id FROM users
        WHERE user_id <> $1 AND (LOWER(username) = LOWER($2) OR LOWER(email) = LOWER($3))`,
      [userId, username, email]
    );
    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "DUPLICATE", message: "Username or email is already used by another account." });
    }

    await client.query(
      // $3 (email) is used both as a column assignment AND inside LOWER(). Without
      // a cast Postgres deduces two different types for it (varchar vs text) and
      // throws 42P08 "inconsistent types deduced for parameter $3", which failed
      // EVERY profile save. Pin $3 to ::text in both spots (mirrors the web
      // /users/me update in features/user/models/User.js).
      `UPDATE users
          SET username = $2,
              email = $3::text,
              first_name = $4,
              last_name = $5,
              middle_name = $6,
              suffix = $7,
              phone = $8,
              alternate_phone = $9,
              gender = $10,
              date_of_birth = $11,
              email_changed_at = CASE WHEN LOWER(email) <> LOWER($3::text) THEN NOW() ELSE email_changed_at END,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId, username, email, firstName, lastName, middleName || null, suffix || null, phone || null, alternatePhone || null, gender, dateOfBirth]
    );

    await client.query(
      `INSERT INTO user_addresses (user_id, region_code, province_code, municipality_code, barangay_code, address_line)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         region_code = EXCLUDED.region_code,
         province_code = EXCLUDED.province_code,
         municipality_code = EXCLUDED.municipality_code,
         barangay_code = EXCLUDED.barangay_code,
         address_line = EXCLUDED.address_line,
         updated_at = NOW()`,
      [userId, next.region_code || null, next.province_code || null, next.municipality_code || null, next.barangay_code || null, addressLine || null]
    );

    // Copy the changed fields to the linked patient record. Only changed ones:
    // the clinic may have filled patient-record fields (date of birth,
    // address) that the account itself leaves blank, and an unrelated edit
    // must not overwrite those with blanks.
    const patientSets = changed
      .flatMap((field) => PATIENT_RECORD_COLUMNS[field] || [])
      .concat(changed.includes("first_name") || changed.includes("last_name") ? ["name"] : [])
      .map((column) => `${column} = EXCLUDED.${column}`);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    await client.query(
      `INSERT INTO patients
         (user_id, first_name, last_name, middle_name, suffix, name, email, phone, contact, gender, date_of_birth, address, is_active, created_by, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, TRUE, $1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         ${patientSets.map((set) => `${set},`).join("\n         ")}
         is_active     = TRUE,
         updated_at    = NOW()`,
      [userId, firstName, lastName, middleName || null, suffix || null, fullName, email, phone || null, gender, dateOfBirth, addressLine || null]
    );

    const updated = await client.query(
      `SELECT u.user_id, u.username, u.email, u.first_name, u.last_name, u.middle_name, u.suffix,
              u.phone, u.alternate_phone, u.gender, TO_CHAR(u.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              u.profile_picture, ua.region_code, ua.province_code, ua.municipality_code, ua.barangay_code,
              ua.address_line
         FROM users u
         LEFT JOIN user_addresses ua ON ua.user_id = u.user_id
        WHERE u.user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    await logger.log({
      userId,
      action: "PROFILE_UPDATED",
      entityType: "user",
      entityId: userId,
      description: `${username} updated their profile (${changed.join(", ").replace(/_/g, " ")}).`,
      ip: logger.getIP(req),
      metadata: {
        changed_fields: changed,
        sensitive_changed: sensitiveChanged,
        ...(changed.includes("email") && { previous_email: current.email }),
      },
    });

    return res.json({ success: true, changed: true, message: "Profile updated.", data: updated.rows[0] });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    if (err.code === "23505") {
      return res.status(409).json({ success: false, code: "DUPLICATE", message: "Username or email is already used by another account." });
    }
    logSafeError("Patient profile update error", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Failed to update profile." });
  } finally {
    client.release();
  }
});

module.exports = router;