const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../config/database");

// active_tokens.token holds the SHA-256 hex digest of the session JWT, never
// the JWT itself, so a copy of the table (backup, SQL console, log of a failed
// INSERT) can't be replayed as a live session. Rows written before this change
// hold the raw JWT; verifyToken upgrades those in place on first use, and
// database/hash_active_tokens.sql converts them all at once.
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

// ============================================================
// CREATE TOKEN — saves its hash to active_tokens
// ============================================================
const createToken = async (payload, options = {}) => {
  const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || "24h";
  // jti: a random 122-bit id per session, so two logins by the same user in the
  // same second (identical user/role/iat/exp) still get distinct tokens instead
  // of colliding on active_tokens' unique constraint.
  const token = jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn });

  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000);

  await pool.query(
    `INSERT INTO active_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [payload.user_id, hashToken(token), expiresAt]
  );

  return token;
};

// ============================================================
// VERIFY TOKEN — checks JWT signature + DB existence
// ============================================================
const verifyToken = async (token) => {
  // 1. Verify JWT signature
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  // 2. Check the session still exists (not revoked or expired)
  const hashed = hashToken(token);
  let result = await pool.query(
    `SELECT token_id FROM active_tokens
     WHERE token = $1 AND expires_at > NOW()`,
    [hashed]
  );

  if (result.rows.length === 0) {
    // Legacy row that still holds the raw JWT: replace it with its hash.
    result = await pool.query(
      `UPDATE active_tokens SET token = $2
       WHERE token = $1 AND expires_at > NOW()
       RETURNING token_id`,
      [token, hashed]
    );
  }

  if (result.rows.length === 0) {
    const err = new Error("Token has been revoked or expired. Please login again.");
    err.name = "TokenRevokedError";
    throw err;
  }

  return decoded;
};

// ============================================================
// REVOKE SINGLE TOKEN
// ============================================================
const revokeToken = async (token) => {
  await pool.query("DELETE FROM active_tokens WHERE token = ANY($1::text[])", [[hashToken(token), token]]);
};

// ============================================================
// REVOKE ALL TOKENS FOR USER (logout all devices)
// ============================================================
const revokeAllUserTokens = async (userId) => {
  await pool.query("DELETE FROM active_tokens WHERE user_id = $1", [userId]);
};

// ============================================================
// REVOKE EVERY SESSION OF A USER EXCEPT THE CURRENT ONE
// ============================================================
const revokeOtherUserTokens = async (userId, currentToken, db = pool) => {
  const result = await db.query(
    "DELETE FROM active_tokens WHERE user_id = $1 AND NOT (token = ANY($2::text[]))",
    [userId, [hashToken(currentToken), currentToken]]
  );
  return result.rowCount;
};

// ============================================================
// CLEANUP EXPIRED TOKENS (run on schedule)
// ============================================================
const cleanupExpiredTokens = async () => {
  const result = await pool.query(
    "DELETE FROM active_tokens WHERE expires_at < NOW()"
  );
  console.log(`🧹 Cleaned ${result.rowCount} expired tokens`);
};

// The raw bearer token from a request (the one authenticate() verified).
const bearerToken = (req) => {
  const header = req.headers?.authorization || "";
  return header.startsWith("Bearer ") ? header.split(" ")[1] : null;
};

module.exports = {
  hashToken,
  createToken,
  verifyToken,
  revokeToken,
  revokeAllUserTokens,
  revokeOtherUserTokens,
  cleanupExpiredTokens,
  bearerToken,
};
