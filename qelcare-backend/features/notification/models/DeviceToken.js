const db = require("../../../config/database");

// ============================================================================
// DeviceToken — FCM registration tokens for push notifications.
// ----------------------------------------------------------------------------
// One row per (device token). A user can have several (phone + tablet, or a
// reinstalled app). Tokens are rotated by FCM, so `register` upserts on the
// token and re-points it at the current user; dead tokens are pruned when FCM
// reports them UNREGISTERED on send.
// ============================================================================

const DeviceToken = {
  // Idempotent: safe to call on every boot. Creates the table + indexes if the
  // deploy DB doesn't have them yet, so there is no separate migration step.
  async ensureSchema() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token        TEXT NOT NULL UNIQUE,
        platform     VARCHAR(20) DEFAULT 'android',
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(
      "CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id)"
    );
  },

  async register({ user_id, token, platform = "android" }) {
    if (!user_id || !token) return null;
    const result = await db.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET
         user_id      = EXCLUDED.user_id,
         platform     = EXCLUDED.platform,
         updated_at   = NOW(),
         last_seen_at = NOW()
       RETURNING *`,
      [user_id, String(token).slice(0, 4096), String(platform || "android").slice(0, 20)]
    );
    return result.rows[0];
  },

  async remove(token) {
    if (!token) return 0;
    const result = await db.query("DELETE FROM device_tokens WHERE token = $1", [token]);
    return result.rowCount;
  },

  // Belt-and-suspenders: a user can only remove a token bound to their own id.
  async removeForUser({ user_id, token }) {
    if (!user_id || !token) return 0;
    const result = await db.query(
      "DELETE FROM device_tokens WHERE token = $1 AND user_id = $2",
      [token, user_id]
    );
    return result.rowCount;
  },

  async tokensForUser(user_id) {
    if (!user_id) return [];
    const result = await db.query(
      "SELECT token FROM device_tokens WHERE user_id = $1",
      [user_id]
    );
    return result.rows.map((r) => r.token);
  },

  async pruneTokens(tokens = []) {
    if (!tokens.length) return 0;
    const result = await db.query(
      "DELETE FROM device_tokens WHERE token = ANY($1::text[])",
      [tokens]
    );
    return result.rowCount;
  },
};

module.exports = DeviceToken;
