const pool = require("../../../config/database");
const { normalizePhone } = require("../../../shared/utils/profileRules");

// Fields a user edits on their own profile, in the order changes are reported.
const PROFILE_FIELDS = [
 "first_name",
 "last_name",
 "middle_name",
 "suffix",
 "email",
 "phone",
 "alternate_phone",
 "gender",
 "date_of_birth",
 "region_code",
 "province_code",
 "municipality_code",
 "barangay_code",
 "address_line",
];

// Value used to decide whether a field changed: null and "" are the same,
// email case and phone spacing don't count as a change.
function comparable(field, value) {
 const textValue = value === undefined || value === null ? "" : String(value).trim();
 if (field === "email") return textValue.toLowerCase();
 if (field === "phone" || field === "alternate_phone") return normalizePhone(textValue);
 return textValue;
}

class User {
 // db: pool or a transaction client; lock: take the user row's lock (FOR UPDATE).
 static async getProfile(userId, db = pool, { lock = false } = {}) {
 const result = await db.query(
 `SELECT
 u.user_id,
 u.username,
 u.email,
 u.first_name,
 u.last_name,
 u.middle_name,
 u.suffix,
 u.phone,
 u.alternate_phone,
 u.gender,
 TO_CHAR(u.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
 u.profile_picture,
 u.status,
 u.failed_login_attempts,
 u.lockout_until,
 u.last_login,
 u.email_changed_at,
 u.password_changed_at,
 u.created_at,
 u.updated_at,
 u.role_id,
 r.role_name AS role,
 u.specialty_id,
 s.specialty_name,
 ua.region_code,
 ua.province_code,
 ua.municipality_code,
 ua.barangay_code,
 ua.address_line
 FROM users u
 LEFT JOIN roles r ON u.role_id = r.role_id
 LEFT JOIN specialties s ON u.specialty_id = s.specialty_id
 LEFT JOIN user_addresses ua ON u.user_id = ua.user_id
 WHERE u.user_id = $1${lock ? " FOR UPDATE OF u" : ""}`,
 [userId]
 );
 return result.rows[0] || null;
 }

 static async getAllUsers() {
 const result = await pool.query(
 `SELECT
 u.user_id,
 u.username,
 u.email,
 u.first_name,
 u.last_name,
 u.middle_name,
 u.suffix,
 u.phone,
 u.alternate_phone,
 u.gender,
 u.profile_picture,
 u.status,
 u.failed_login_attempts,
 u.lockout_until,
 u.last_login,
 u.created_at,
 u.updated_at,
 u.role_id,
 r.role_name AS role,
 u.specialty_id,
 s.specialty_name
 FROM users u
 LEFT JOIN roles r ON u.role_id = r.role_id
 LEFT JOIN specialties s ON u.specialty_id = s.specialty_id
 ORDER BY u.created_at DESC`
 );
 return result.rows;
 }

 static async getUserById(userId) {
 const result = await pool.query(
 "SELECT user_id, password, status FROM users WHERE user_id = $1",
 [userId]
 );
 return result.rows[0] || null;
 }

 // Saves the caller's own profile in one transaction. `data` holds validated,
 // normalized values (an empty email keeps the current one). The user row is
 // locked while the change is compared and written, and `before`/`after` are
 // read inside that transaction, so the caller's audit entry describes exactly
 // this change even when two saves run at once. Nothing is written when no
 // field changed. Hooks run inside the transaction (a throw rolls it back):
 // beforeWrite(client, { before, changed }) and afterWrite(client, { before, changed }).
 // Returns null (no such user) or { before, after, changed }.
 static async updateProfile(userId, data, hooks = {}) {
 const client = await pool.connect();
 try {
 await client.query("BEGIN");

 const before = await User.getProfile(userId, client, { lock: true });
 if (!before) {
 await client.query("ROLLBACK");
 return null;
 }

 const next = { ...data, email: data.email || before.email };
 const changed = PROFILE_FIELDS.filter((field) => comparable(field, before[field]) !== comparable(field, next[field]));
 if (changed.length === 0) {
 await client.query("ROLLBACK");
 return { before, after: before, changed };
 }

 if (hooks.beforeWrite) await hooks.beforeWrite(client, { before, changed });

 if (changed.includes("email")) {
 const duplicate = await client.query(
 "SELECT user_id FROM users WHERE LOWER(email) = LOWER($1) AND user_id <> $2",
 [next.email, userId]
 );
 if (duplicate.rows.length > 0) {
 const error = new Error("Email is already used by another account");
 error.status = 409;
 throw error;
 }
 }

 await client.query(
 `UPDATE users
 SET first_name = $1,
 last_name = $2,
 middle_name = $3,
 suffix = $4,
 gender = $5,
 phone = $6,
 alternate_phone = $7,
 email = $8::text,
 date_of_birth = $9,
 email_changed_at = CASE
 WHEN LOWER(email) <> LOWER($8::text) THEN NOW()
 ELSE email_changed_at
 END,
 updated_at = NOW()
 WHERE user_id = $10`,
 [
 next.first_name,
 next.last_name,
 next.middle_name || null,
 next.suffix || null,
 next.gender || null,
 next.phone || null,
 next.alternate_phone || null,
 next.email,
 next.date_of_birth || null,
 userId,
 ]
 );

 await client.query(
 `INSERT INTO user_addresses
 (user_id, region_code, province_code, municipality_code, barangay_code, address_line)
 VALUES ($1, $2, $3, $4, $5, $6)
 ON CONFLICT (user_id) DO UPDATE SET
 region_code = EXCLUDED.region_code,
 province_code = EXCLUDED.province_code,
 municipality_code = EXCLUDED.municipality_code,
 barangay_code = EXCLUDED.barangay_code,
 address_line = EXCLUDED.address_line,
 updated_at = NOW()`,
 [
 userId,
 next.region_code || null,
 next.province_code || null,
 next.municipality_code || null,
 next.barangay_code || null,
 next.address_line || null,
 ]
 );

 if (hooks.afterWrite) await hooks.afterWrite(client, { before, changed });

 const after = await User.getProfile(userId, client);
 await client.query("COMMIT");
 return { before, after, changed };
 } catch (error) {
 await client.query("ROLLBACK");
 throw error;
 } finally {
 client.release();
 }
 }

 static async updateProfilePicture(userId, profile_picture) {
 const result = await pool.query(
 `UPDATE users
 SET profile_picture = $1, updated_at = NOW()
 WHERE user_id = $2
 RETURNING user_id, profile_picture, updated_at`,
 [profile_picture, userId]
 );
 return result.rows[0] || null;
 }

 static async createUser({
 username,
 email,
 password,
 first_name,
 last_name,
 role_id,
 phone = null,
 gender = null,
 specialty_id = null,
 date_of_birth = null,
 middle_name = null,
 suffix = null,
 alternate_phone = null,
 }) {
 const bcrypt = require("bcrypt");
 const hashedPassword = await bcrypt.hash(password, 12);

 const result = await pool.query(
 `INSERT INTO users
 (username, email, password, first_name, last_name, middle_name, suffix, role_id, phone, alternate_phone, gender, date_of_birth, specialty_id, status)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'verified')
 RETURNING
 user_id,
 username,
 email,
 first_name,
 last_name,
 middle_name,
 suffix,
 phone,
 alternate_phone,
 gender,
 TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
 profile_picture,
 role_id,
 specialty_id,
 status,
 created_at,
 updated_at`,
 [
 username,
 email,
 hashedPassword,
 first_name,
 last_name,
 middle_name || null,
 suffix || null,
 role_id,
 phone || null,
 alternate_phone || null,
 gender || null,
 date_of_birth || null,
 specialty_id || null,
 ]
 );
 return result.rows[0];
 }

 static async updateStatus(userId, status) {
 // Setting a user to any non-locked status (e.g. an admin activating a locked
 // account back to "verified") must FULLY clear the lock state — the failed
 // login counter AND the lockout timer. Otherwise the account is left sitting
 // at the lock threshold and the login flow re-locks it on the very next
 // attempt (attempts stays at 8 -> 8+1 >= 8 -> "Account permanently locked").
 const clearLock = status !== "locked";
 const result = await pool.query(
 `UPDATE users
 SET status = $1,
 failed_login_attempts = CASE WHEN $3::boolean THEN 0 ELSE failed_login_attempts END,
 lockout_until = CASE WHEN $3::boolean THEN NULL ELSE lockout_until END,
 updated_at = NOW()
 WHERE user_id = $2
 RETURNING user_id, status, failed_login_attempts, lockout_until`,
 [status, userId, clearLock]
 );
 return result.rows[0] || null;
 }

 static async updateRole(userId, role_id) {
 const result = await pool.query(
 `UPDATE users
 SET role_id = $1, updated_at = NOW()
 WHERE user_id = $2
 RETURNING user_id, role_id`,
 [role_id, userId]
 );
 return result.rows[0] || null;
 }

 static async updateAdminDetails(userId, { phone = undefined, gender = undefined, specialty_id = undefined }) {
 const phoneProvided = phone !== undefined;
 const genderProvided = gender !== undefined;
 const specialtyProvided = specialty_id !== undefined;
 const result = await pool.query(
 `UPDATE users
 SET phone = CASE WHEN $1::boolean THEN $2 ELSE phone END,
 gender = CASE WHEN $3::boolean THEN $4 ELSE gender END,
 specialty_id = CASE WHEN $5::boolean THEN $6::int ELSE specialty_id END,
 updated_at = NOW()
 WHERE user_id = $7
 RETURNING user_id, phone, gender, specialty_id, updated_at`,
 [
 phoneProvided,
 phone || null,
 genderProvided,
 gender || null,
 specialtyProvided,
 specialty_id || null,
 userId,
 ]
 );
 return result.rows[0] || null;
 }
}

module.exports = User;
