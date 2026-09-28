// ============================================================================
// Request input helpers shared by the records, billing and analytics modules,
// so malformed ids and search text are a 400 (or a literal search) instead of
// a database error. Same rules as the appointment module's own helpers.
// ============================================================================

// Postgres `integer` id: 1..2147483647, digits only ("1.5", "abc", "0" fail).
function isPositiveInt(value) {
  return /^[1-9]\d{0,9}$/.test(String(value ?? "").trim()) && Number(value) <= 2147483647;
}

// Treat search text literally in ILIKE: without escaping, "%" or "_" act as
// wildcards (a search for "_" matched every row). Backslash is Postgres's
// default LIKE escape character.
function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Route middleware: 400 unless req.params[name] is a valid id.
function requireIdParam(name, label) {
  return (req, res, next) => {
    if (isPositiveInt(req.params[name])) return next();
    return res.status(400).json({ success: false, message: `Invalid ${label} id.` });
  };
}

module.exports = { isPositiveInt, escapeLike, requireIdParam };
