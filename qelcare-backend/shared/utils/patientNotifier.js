// ============================================================================
// patientNotifier — send a patient-facing event as an OS push, beyond the
// in-app notification + email that already exist.
// ----------------------------------------------------------------------------
// Everything here is BEST-EFFORT and fully guarded: a failure in push must
// never break the request that triggered it (booking, status change, …).
// The in-app notification (features/notification) remains the source of truth.
// SMS is not sent from here: it is reserved for the Forgot Password and
// Register Account verification codes (see authService).
// ============================================================================

const pushNotifier = require("./pushNotifier");
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

module.exports = { pushToUser };
