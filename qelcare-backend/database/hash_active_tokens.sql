-- ============================================================================
-- Session tokens: store only a SHA-256 hash (Auth/session fix release).
--
-- The backend now saves sha256(token) in active_tokens.token instead of the
-- signed session token itself, so a copy of this table can't be used to sign
-- in as someone. Sessions created before the release still hold the raw token;
-- the backend converts each one the first time it is used, and this script
-- converts all of them at once so none stay stored in plain form.
--
-- Nobody is signed out: the hash is computed the same way the backend does.
-- Safe to re-run (a hex hash never starts with 'eyJ', the start of every JWT).
--
-- How to run (psql or any SQL console, against the target database), AFTER
-- the new backend is deployed:
--   1. Run the PREVIEW query.
--   2. Run the CONVERT statement.
--   3. Run the PREVIEW query again; "Raw session tokens" must be 0.
-- ============================================================================

-- ---------------------------------------------------------------- PREVIEW ---
SELECT 'Raw session tokens' AS kind, COUNT(*) AS rows
  FROM active_tokens WHERE token LIKE 'eyJ%'
UNION ALL
SELECT 'Hashed session tokens', COUNT(*)
  FROM active_tokens WHERE token ~ '^[0-9a-f]{64}$';

-- ---------------------------------------------------------------- CONVERT ---
UPDATE active_tokens
   SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex')
 WHERE token LIKE 'eyJ%';
