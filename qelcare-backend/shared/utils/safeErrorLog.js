// ============================================================================
// Error logging for modules that handle clinical or financial data.
// ----------------------------------------------------------------------------
// console.error(err) prints every property of a pg error, and its `detail`
// ("Failing row contains (...)", "Key (...)=(...)") and `where` echo the row
// being written: diagnoses, doctor notes, amounts. Log only the message, the
// stack frames and the SQLSTATE / constraint / table / column names instead.
// ============================================================================

function logSafeError(context, err) {
  if (!err || typeof err !== "object") {
    console.error(`${context}:`, err);
    return;
  }
  const meta = ["code", "constraint", "table", "column"]
    .filter((key) => err[key])
    .map((key) => `${key}=${err[key]}`)
    .join(" ");
  const trace = String(err.stack || err.message || "Unknown error").split("\n").slice(0, 8).join("\n");
  console.error(`${context}: ${trace}${meta ? `\n    (${meta})` : ""}`);
}

module.exports = { logSafeError };
