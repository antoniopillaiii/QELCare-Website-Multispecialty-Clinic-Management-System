const User = require("../models/User");
const pool = require("../../../config/database");
const logger = require("../../../shared/utils/activityLogger");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");
const bcrypt = require("bcrypt");
const tokenManager = require("../../../shared/utils/tokenManager");
const rules = require("../../../shared/utils/profileRules");
const reauth = require("../../../shared/utils/reauthThrottle");
const {
 validateEmail,
 validatePasswordStrength,
 validateUsername,
 validatePersonName,
} = require("../../auth/validators/authValidator");

const VALID_STATUSES = ["verified", "unverified", "locked", "deactivated"];
const VALID_GENDERS = ["", null, undefined, "Male", "Female", "Other"];

// Capitalize each word so "kelly celocia" is stored as "Kelly Celocia".
function toTitleCase(value) {
 return String(value || "")
 .trim()
 .toLowerCase()
 .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// App-wide phone rule (matches registration): PH mobile 09XXXXXXXXX, +639XXXXXXXXX,
// or international +<10-14 digits>. Field is optional -> empty passes. Length is
// capped at the users.phone column width (20). Returns an error string or null.
function phoneError(value, label) {
 if (value === undefined || value === null || String(value).trim() === "") return null;
 const raw = String(value).trim();
 if (raw.length > 20) return `${label} must be 20 characters or less.`;
 const cleaned = raw.replace(/[\s\-()]/g, "");
 if (!/^(09\d{9}|\+639\d{9}|\+\d{10,14})$/.test(cleaned)) {
 return `${label} is invalid. Use 09XXXXXXXXX or +639XXXXXXXXX.`;
 }
 return null;
}

async function roleExists(roleId) {
 const result = await pool.query("SELECT role_id FROM roles WHERE role_id = $1", [roleId]);
 return result.rowCount > 0;
}

async function specialtyExists(specialtyId) {
 if (!specialtyId) return true;
 const result = await pool.query("SELECT specialty_id FROM specialties WHERE specialty_id = $1", [specialtyId]);
 return result.rowCount > 0;
}

async function getRoleName(roleId) {
 const result = await pool.query("SELECT role_name FROM roles WHERE role_id = $1", [roleId]);
 return result.rows[0]?.role_name || null;
}

async function getAuditUser(userId) {
 const result = await pool.query(
 `SELECT
 u.user_id,
 u.username,
 u.email,
 u.first_name,
 u.last_name,
 u.role_id,
 u.status,
 r.role_name
 FROM users u
 LEFT JOIN roles r ON u.role_id = r.role_id
 WHERE u.user_id = $1`,
 [userId]
 );
 return result.rows[0] || null;
}

function displayName(user) {
 if (!user) return "Unknown user";
 const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
 return name || user.username || `User #${user.user_id}`;
}

async function writeLog(req, payload) {
 await logger.log({
 userId: req.user?.user_id || null,
 ip: logger.getIP(req),...payload,
 });
}

const getProfile = async (req, res) => {
 try {
 const profile = await User.getProfile(req.user.user_id);
 if (!profile) return res.status(404).json({ success: false, message: "User not found" });
 res.status(200).json({ success: true, data: profile });
 } catch (error) {
 logSafeError("getProfile error", error);
 res.status(500).json({ success: false, message: "Failed to fetch profile" });
 }
};

// Re-authentication for an email change: a signed-in session alone isn't
// enough to move the account (and its password-reset codes) to a new address.
// Wrong passwords are throttled per account (shared with password change),
// since the IP limit on the sign-in and password endpoints doesn't cover this one.

function httpError(status, message, extra = {}) {
 const error = new Error(message);
 error.status = status;
 error.extra = extra;
 return error;
}

const updateProfile = async (req, res) => {
 try {
 // Patients have their own endpoint, which confirms contact changes with an
 // emailed code and keeps the linked patient record in sync.
 if (req.user.role === "Patient") {
 return res.status(403).json({
 success: false,
 code: "USE_PATIENT_PROFILE",
 message: "Patients update their profile from My Profile, which verifies contact changes with a code.",
 });
 }

 const body = req.body || {};
 const data = {
 first_name: rules.text(body.first_name),
 last_name: rules.text(body.last_name),
 middle_name: rules.text(body.middle_name),
 suffix: rules.text(body.suffix),
 email: rules.text(body.email).toLowerCase(),
 phone: rules.normalizePhone(body.phone),
 alternate_phone: rules.normalizePhone(body.alternate_phone),
 gender: body.gender || null,
 date_of_birth: rules.text(body.date_of_birth) || null,
 region_code: rules.text(body.region_code),
 province_code: rules.text(body.province_code),
 municipality_code: rules.text(body.municipality_code),
 barangay_code: rules.text(body.barangay_code),
 address_line: rules.text(body.address_line),
 };

 const errors = [
 rules.requiredNameError(data.first_name, "First name"),
 rules.requiredNameError(data.last_name, "Last name"),
 rules.optionalNameError(data.middle_name, "Middle name", rules.LIMITS.middle_name),
 rules.optionalNameError(data.suffix, "Suffix", rules.LIMITS.suffix),
 ...(data.email ? validateEmail(data.email) : []),
 VALID_GENDERS.includes(data.gender) ? null : "Invalid gender",
 rules.phoneError(data.phone, "Phone"),
 rules.phoneError(data.alternate_phone, "Alternate phone"),
 rules.birthDateError(data.date_of_birth),
 ...rules.addressCodeErrors(data),
 ].filter(Boolean);
 if (errors.length) return res.status(400).json({ success: false, message: errors[0], errors });

 const currentToken = tokenManager.bearerToken(req);
 const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
 let signedOutSessions = 0;

 const result = await User.updateProfile(req.user.user_id, data, {
 beforeWrite: async (client, { changed }) => {
 if (!changed.includes("email")) return;
 const retryAfter = reauth.retryAfterSeconds(req.user.user_id);
 if (retryAfter) {
 throw httpError(429, reauth.tooManyMessage(retryAfter), {
 code: "TOO_MANY_ATTEMPTS",
 retry_after: retryAfter,
 });
 }
 if (!currentPassword) {
 throw httpError(400, "Enter your current password to change your email.", { code: "CURRENT_PASSWORD_REQUIRED" });
 }
 const row = await client.query("SELECT password FROM users WHERE user_id = $1", [req.user.user_id]);
 // 400, not 401: the client treats 401 as an expired session.
 if (!(await bcrypt.compare(currentPassword.slice(0, 128), row.rows[0]?.password || ""))) {
 reauth.recordFailure(req.user.user_id);
 throw httpError(400, "Incorrect current password", { code: "INCORRECT_CURRENT_PASSWORD" });
 }
 reauth.clearFailures(req.user.user_id);
 },
 afterWrite: async (client, { changed }) => {
 // A new sign-in email ends every other session; this one stays signed in.
 if (changed.includes("email")) {
 signedOutSessions = await tokenManager.revokeOtherUserTokens(req.user.user_id, currentToken, client);
 }
 },
 });

 if (!result) return res.status(404).json({ success: false, message: "User not found" });
 const { before, after, changed } = result;

 if (changed.length === 0) {
 return res.status(200).json({ success: true, changed: false, message: "No changes to save.", data: after });
 }

 await writeLog(req, {
 action: "PROFILE_UPDATED",
 entityType: "user",
 entityId: req.user.user_id,
 description: `${displayName(after)} updated their profile (${changed.join(", ").replace(/_/g, " ")}).`,
 metadata: {
 user_id: req.user.user_id,
 changed_fields: changed,
 ...(changed.includes("email") && {
 email_changed: true,
 previous_email: before.email,
 other_sessions_signed_out: signedOutSessions,
 }),
 },
 });

 res.status(200).json({
 success: true,
 changed: true,
 message: changed.includes("email")
 ? "Profile updated. Your other signed-in devices were signed out."
 : "Profile updated",
 data: after,
 });
 } catch (error) {
 if (error.code === "23505") {
 return res.status(409).json({ success: false, message: "Email is already used by another account" });
 }
 if (error.status) {
 return res.status(error.status).json({ success: false, message: error.message, ...(error.extra || {}) });
 }
 logSafeError("updateProfile error", error);
 res.status(500).json({ success: false, message: "Failed to update profile" });
 }
};

const getAllUsers = async (_req, res) => {
 try {
 const users = await User.getAllUsers();
 res.status(200).json({ success: true, data: users });
 } catch (error) {
 logSafeError("getAllUsers error", error);
 res.status(500).json({ success: false, message: "Failed to fetch users" });
 }
};

const getDoctors = async (_req, res) => {
 try {
 const result = await pool.query(
 `SELECT
 u.user_id,
 u.username,
 u.email,
 u.first_name,
 u.last_name,
 NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS doctor_name,
 u.phone,
 u.gender,
 u.specialty_id,
 s.specialty_name,
 s.slug AS specialty_slug
 FROM users u
 JOIN roles r ON u.role_id = r.role_id
 LEFT JOIN specialties s ON u.specialty_id = s.specialty_id
 WHERE r.role_name = 'Doctor'
 AND u.status = 'verified'
 AND u.specialty_id IS NOT NULL
 AND COALESCE(s.is_active, true) = true
 ORDER BY COALESCE(s.display_order, 999), s.specialty_name, u.last_name, u.first_name`
 );

 res.status(200).json({
 success: true,
 data: result.rows,
 doctors: result.rows,
 });
 } catch (error) {
 logSafeError("getDoctors error", error);
 res.status(500).json({ success: false, message: "Failed to fetch doctors" });
 }
};

// 409 message for a username/email that already exists (case-insensitive).
function duplicateMessage(usernameTaken, emailTaken) {
 if (usernameTaken && emailTaken) return "Username already taken and email already in use.";
 return usernameTaken ? "Username already taken." : "Email already in use.";
}

const createUser = async (req, res) => {
 try {
 const username = String(req.body.username || "").trim();
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");
 const first_name = String(req.body.first_name || "").trim();
 const last_name = String(req.body.last_name || "").trim();
 const phone = req.body.phone ? String(req.body.phone).trim() : null;
 const gender = req.body.gender || null;
 const { role_id, specialty_id } = req.body;

 if (!username || !email || !password || !first_name || !last_name || !role_id) {
 return res.status(400).json({
 success: false,
 message: "Username, email, password, first name, last name, and role are required",
 });
 }

 // Admin-created accounts follow the same rules as patient self-registration;
 // the Add User form is not the only way to reach this endpoint.
 const errors = [
 ...validateUsername(username),
 ...validateEmail(email),
 ...validatePersonName(first_name, "First name"),
 ...validatePersonName(last_name, "Last name"),
 ...validatePasswordStrength(password),
 ];
 const phoneMsg = phoneError(phone, "Phone");
 if (phoneMsg) errors.push(phoneMsg);
 if (!VALID_GENDERS.includes(gender)) errors.push("Invalid gender");
 if (errors.length) return res.status(400).json({ success: false, message: errors[0], errors });

 if (!(await roleExists(role_id))) {
 return res.status(400).json({ success: false, message: "Invalid role" });
 }
 const isDoctor = (await getRoleName(role_id)) === "Doctor";
 if (isDoctor && !specialty_id) {
 return res.status(400).json({ success: false, message: "Doctor accounts require a specialty." });
 }
 if (isDoctor && !(await specialtyExists(specialty_id))) {
 return res.status(400).json({ success: false, message: "Invalid specialty" });
 }

 const existing = await pool.query(
 `SELECT LOWER(username) = LOWER($1) AS username_taken, LOWER(email) = LOWER($2) AS email_taken
 FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)`,
 [username, email]
 );
 if (existing.rows.length > 0) {
 const usernameTaken = existing.rows.some((row) => row.username_taken);
 const emailTaken = existing.rows.some((row) => row.email_taken);
 return res.status(409).json({ success: false, message: duplicateMessage(usernameTaken, emailTaken) });
 }

 let newUser;
 try {
 newUser = await User.createUser({
 username,
 email,
 password,
 first_name: toTitleCase(first_name),
 last_name: toTitleCase(last_name),
 role_id,
 // Only Doctor accounts carry a specialty.
 specialty_id: isDoctor ? specialty_id : null,
 phone,
 gender,
 });
 } catch (insertError) {
 // A concurrent request can still hit the unique indexes; report it as the
 // conflict it is rather than a generic 500.
 if (insertError.code === "23505") {
 const constraint = String(insertError.constraint || "");
 return res.status(409).json({
 success: false,
 message: duplicateMessage(constraint.includes("username"), constraint.includes("email")),
 });
 }
 throw insertError;
 }

 const roleName = await getRoleName(role_id);
 await writeLog(req, {
 action: "USER_CREATED",
 entityType: "user",
 entityId: newUser.user_id,
 description: `Created user account for ${displayName(newUser)}${roleName ? ` as ${roleName}` : ""}.`,
 metadata: {
 created_user_id: newUser.user_id,
 username: newUser.username,
 email: newUser.email,
 role_id: Number(role_id),
 role_name: roleName,
 specialty_id: specialty_id ? Number(specialty_id) : null,
 status: newUser.status,
 },
 });

 res.status(201).json({ success: true, message: "User created successfully", data: newUser });
 } catch (error) {
 logSafeError("createUser error", error);
 res.status(500).json({ success: false, message: "Failed to create user" });
 }
};

const updateUserStatus = async (req, res) => {
 try {
 const { userId } = req.params;
 const { status } = req.body;

 if (!VALID_STATUSES.includes(status)) {
 return res.status(400).json({ success: false, message: "Invalid status" });
 }
 // An admin can never lock, deactivate or un-verify their own account. This
 // also means at least one active admin always remains: the admin making a
 // change is active and can't remove themselves.
 if (Number(userId) === Number(req.user.user_id)) {
 return res.status(400).json({ success: false, message: "You can't change the status of your own account." });
 }

 const before = await getAuditUser(userId);
 const updated = await User.updateStatus(userId, status);
 if (!updated) return res.status(404).json({ success: false, message: "User not found" });

 await writeLog(req, {
 action: "USER_STATUS_CHANGED",
 entityType: "user",
 entityId: Number(userId),
 description: `Changed ${displayName(before)} status from ${before?.status || "unknown"} to ${status}.`,
 metadata: {
 target_user_id: Number(userId),
 previous_status: before?.status || null,
 new_status: status,
 },
 });

 res.status(200).json({ success: true, message: `User status updated to ${status}`, data: updated });
 } catch (error) {
 logSafeError("updateUserStatus error", error);
 res.status(500).json({ success: false, message: "Failed to update status" });
 }
};

const updateUserRole = async (req, res) => {
 try {
 const { userId } = req.params;
 const { role_id } = req.body;

 if (!role_id) return res.status(400).json({ success: false, message: "role_id is required" });
 if (!(await roleExists(role_id))) {
 return res.status(400).json({ success: false, message: "Invalid role" });
 }
 // Same reason as status: an admin can't demote themselves out of admin access.
 if (Number(userId) === Number(req.user.user_id)) {
 return res.status(400).json({ success: false, message: "You can't change the role of your own account." });
 }

 const before = await getAuditUser(userId);
 if (!before) return res.status(404).json({ success: false, message: "User not found" });
 const newRoleName = await getRoleName(role_id);
 // Doctors must have a specialty so patients can book them. The Edit User
 // form saves the specialty first, then the role.
 if (newRoleName === "Doctor") {
 const current = await pool.query("SELECT specialty_id FROM users WHERE user_id = $1", [userId]);
 if (!current.rows[0]?.specialty_id) {
 return res.status(400).json({ success: false, message: "Assign a specialty before changing this user to Doctor." });
 }
 }

 const updated = await User.updateRole(userId, role_id);
 if (!updated) return res.status(404).json({ success: false, message: "User not found" });
 if (newRoleName !== "Doctor") {
 // Only Doctor accounts carry a specialty.
 await pool.query("UPDATE users SET specialty_id = NULL WHERE user_id = $1 AND specialty_id IS NOT NULL", [userId]);
 }
 await writeLog(req, {
 action: "USER_ROLE_CHANGED",
 entityType: "user",
 entityId: Number(userId),
 description: `Changed ${displayName(before)} role from ${before?.role_name || "unknown"} to ${newRoleName || `role #${role_id}`}.`,
 metadata: {
 target_user_id: Number(userId),
 previous_role_id: before?.role_id || null,
 previous_role_name: before?.role_name || null,
 new_role_id: Number(role_id),
 new_role_name: newRoleName,
 },
 });

 res.status(200).json({ success: true, message: "User role updated", data: updated });
 } catch (error) {
 logSafeError("updateUserRole error", error);
 res.status(500).json({ success: false, message: "Failed to update role" });
 }
};

const updateUserDetails = async (req, res) => {
 try {
 const { userId } = req.params;
 const { phone, gender, specialty_id } = req.body;

 if (!VALID_GENDERS.includes(gender)) {
 return res.status(400).json({ success: false, message: "Invalid gender" });
 }
 if (!(await specialtyExists(specialty_id))) {
 return res.status(400).json({ success: false, message: "Invalid specialty" });
 }
 const phoneMsg = phoneError(phone, "Phone");
 if (phoneMsg) return res.status(400).json({ success: false, message: phoneMsg });

 const before = await getAuditUser(userId);
 if (!before) return res.status(404).json({ success: false, message: "User not found" });
 if (Object.prototype.hasOwnProperty.call(req.body, "specialty_id") && !specialty_id && before.role_name === "Doctor") {
 return res.status(400).json({ success: false, message: "Doctor accounts require a specialty." });
 }
 const details = {};
 if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
 details.phone = typeof phone === "string" ? phone.trim() : phone;
 }
 if (Object.prototype.hasOwnProperty.call(req.body, "gender")) {
 details.gender = gender || null;
 }
 if (Object.prototype.hasOwnProperty.call(req.body, "specialty_id")) {
 details.specialty_id = specialty_id || null;
 }

 const updated = await User.updateAdminDetails(userId, details);
 if (!updated) return res.status(404).json({ success: false, message: "User not found" });

 await writeLog(req, {
 action: "USER_DETAILS_UPDATED",
 entityType: "user",
 entityId: Number(userId),
 description: `Updated contact details for ${displayName(before)}.`,
 metadata: {
 target_user_id: Number(userId),
 phone_updated: Object.prototype.hasOwnProperty.call(req.body, "phone"),
 gender_updated: Object.prototype.hasOwnProperty.call(req.body, "gender"),
 specialty_updated: Object.prototype.hasOwnProperty.call(req.body, "specialty_id"),
 },
 });

 res.status(200).json({ success: true, message: "User details updated", data: updated });
 } catch (error) {
 logSafeError("updateUserDetails error", error);
 res.status(500).json({ success: false, message: "Failed to update user details" });
 }
};

const getRoles = async (_req, res) => {
 try {
 const result = await pool.query("SELECT role_id, role_name FROM roles ORDER BY role_id");
 res.status(200).json({ success: true, data: result.rows });
 } catch (error) {
 logSafeError("getRoles error", error);
 res.status(500).json({ success: false, message: "Failed to fetch roles" });
 }
};

module.exports = {
 getProfile,
 updateProfile,
 getAllUsers,
 getDoctors,
 createUser,
 updateUserStatus,
 updateUserRole,
 updateUserDetails,
 getRoles,
};
