// Per-account limit on wrong "current password" entries by a signed-in user
// (changing their email or their password). The IP limit on the auth routes
// doesn't stop one account being guessed from many addresses, so after
// MAX_FAILURES wrong entries in the window every further re-authentication for
// that account is refused until the window ends - even with the right password.
// Both screens share one counter per account.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // user_id -> { count, since }

// Seconds until the account may try again; 0 when it isn't blocked.
function retryAfterSeconds(userId) {
  const entry = failures.get(userId);
  if (!entry) return 0;
  const remaining = entry.since + WINDOW_MS - Date.now();
  if (remaining <= 0) {
    failures.delete(userId);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(userId) {
  const entry = failures.get(userId);
  if (!entry || entry.since + WINDOW_MS <= Date.now()) {
    failures.set(userId, { count: 1, since: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(userId) {
  failures.delete(userId);
}

function tooManyMessage(retryAfter) {
  return `Too many incorrect passwords. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`;
}

module.exports = { MAX_FAILURES, retryAfterSeconds, recordFailure, clearFailures, tooManyMessage };
