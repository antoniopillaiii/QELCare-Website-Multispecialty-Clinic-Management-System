// ============================================================================
// patientNotifier — fan a patient-facing event out to the extra channels
// (OS push + SMS) beyond the in-app notification + email that already exist.
// ----------------------------------------------------------------------------
// Everything here is BEST-EFFORT and fully guarded: a failure in push or SMS
// must never break the request that triggered it (booking, status change, …).
// The in-app notification (features/notification) remains the source of truth;
// these are additional delivery channels.
// ============================================================================

const db = require("../../config/database");
const pushNotifier = require("./pushNotifier");
const smsNotifier = require("./smsNotifier");
const DeviceToken = require("../../features/notification/models/DeviceToken");

// Send an OS push to all of a user's registered devices; prune dead tokens.
async function pushToUser(userId, { title, body, data = {} }) {
  try {
    const tokens = await DeviceToken.tokensForUser(userId);
    if (!tokens.length) return { sent: 0 };
    const result = await pushNotifier.sendPushToTokens(tokens, { title, body, data });
    if (result.invalidTokens?.length) {
      await DeviceToken.pruneTokens(result.invalidTokens).catch(() => {});
    }
    return result;
  } catch (err) {
    console.error("pushToUser error:", err.message);
    return { sent: 0, failed: 0 };
  }
}

// Look up a user's best contact number and text them.
async function smsToUser(userId, message) {
  try {
    const { rows } = await db.query(
      "SELECT phone, alternate_phone FROM users WHERE user_id = $1",
      [userId]
    );
    const phone = rows[0]?.phone || rows[0]?.alternate_phone;
    if (!phone) return { ok: false, skipped: true };
    return await smsNotifier.sendSms({ to: phone, message });
  } catch (err) {
    console.error("smsToUser error:", err.message);
    return { ok: false, reason: err.message };
  }
}

// Convenience: push + SMS the same patient event in one call. `sms` is optional
// (omit to skip SMS for that event); when omitted we reuse the push body.
async function notifyUserChannels({ userId, title, body, data = {}, sms }) {
  if (!userId) return;
  await Promise.all([
    pushToUser(userId, { title, body, data }),
    smsToUser(userId, sms || `${title}${body ? ` — ${body}` : ""}`),
  ]);
}

module.exports = { pushToUser, smsToUser, notifyUserChannels };
