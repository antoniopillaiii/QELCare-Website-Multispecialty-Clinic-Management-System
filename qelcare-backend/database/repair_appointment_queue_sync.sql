-- ============================================================================
-- One-time repair: appointment <-> queue rows left inconsistent by bugs that
-- the application now prevents (fixed in the Admin Appointments/Queue release).
--
--   * Cancelling / no-showing an In-Queue appointment used to leave its queue
--     entry active (still Waiting/Called on the queue and waiting-room display).
--   * Pressing Done again on a paid visit flipped it back to For Billing.
--   * Viewing a future date's queue enqueued that day's appointments early.
--   * A rejected check-in could leave an appointment "In Queue" with no entry.
--
-- How to run (psql or any SQL console, against the target database):
--   1. Run the PREVIEW query and review the counts.
--   2. Run the REPAIR block (one transaction). Safe to re-run; it only touches
--      rows that are still inconsistent.
--   3. Run the MANUAL REVIEW query; those rows need a person to decide.
-- "Today" is the clinic's day in Asia/Manila (the database itself runs on UTC).
-- ============================================================================

-- ---------------------------------------------------------------- PREVIEW ---
SELECT 'Active queue entry, appointment cancelled/no-show' AS issue, COUNT(*) AS rows
  FROM queue_entries q JOIN appointments a ON a.id = q.appointment_id
 WHERE q.status IN ('WAITING', 'CALLED', 'IN_PROGRESS', 'SKIPPED')
   AND a.status IN ('CANCELLED', 'NO_SHOW')
UNION ALL
SELECT 'Paid visit shown as For Billing', COUNT(*)
  FROM appointments a
 WHERE a.status = 'FOR_BILLING'
   AND EXISTS (SELECT 1 FROM billing b WHERE b.appointment_id = a.id AND b.status = 'PAID')
UNION ALL
SELECT 'Future-dated queue entry (queued early by viewing)', COUNT(*)
  FROM queue_entries q JOIN appointments a ON a.id = q.appointment_id
 WHERE q.queue_date > (NOW() AT TIME ZONE 'Asia/Manila')::date
   AND q.status = 'WAITING' AND a.status = 'IN_QUEUE'
UNION ALL
SELECT 'In Queue appointment without a queue entry (today/future)', COUNT(*)
  FROM appointments a
 WHERE a.status = 'IN_QUEUE'
   AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
   AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.appointment_id = a.id);

-- ----------------------------------------------------------------- REPAIR ---
BEGIN;

-- 1. A cancelled / no-show appointment's queue entry leaves the live queue.
UPDATE queue_entries q
   SET status = a.status,
       completed_at = COALESCE(q.completed_at, NOW()),
       updated_at = NOW()
  FROM appointments a
 WHERE a.id = q.appointment_id
   AND q.status IN ('WAITING', 'CALLED', 'IN_PROGRESS', 'SKIPPED')
   AND a.status IN ('CANCELLED', 'NO_SHOW');

-- 2. A visit with a PAID bill is Completed, never For Billing.
UPDATE appointments a
   SET status = 'COMPLETED', updated_at = NOW()
 WHERE a.status = 'FOR_BILLING'
   AND EXISTS (SELECT 1 FROM billing b WHERE b.appointment_id = a.id AND b.status = 'PAID');

-- 3. Undo early enqueues: drop the future-dated entry, back to Confirmed. The
--    lifecycle job queues them on the day (numbered by appointment time).
WITH early AS (
  DELETE FROM queue_entries q
   USING appointments a
   WHERE a.id = q.appointment_id
     AND q.queue_date > (NOW() AT TIME ZONE 'Asia/Manila')::date
     AND q.status = 'WAITING'
     AND a.status = 'IN_QUEUE'
  RETURNING q.appointment_id
)
UPDATE appointments
   SET status = 'CONFIRMED', updated_at = NOW()
 WHERE id IN (SELECT appointment_id FROM early)
   AND status = 'IN_QUEUE';

-- 4. "In Queue" with no queue entry (rejected check-in) returns to Confirmed.
--    Today's are queued again by the lifecycle job within 5 minutes.
UPDATE appointments a
   SET status = 'CONFIRMED', updated_at = NOW()
 WHERE a.status = 'IN_QUEUE'
   AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
   AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.appointment_id = a.id);

COMMIT;

-- ---------------------------------------------------------- MANUAL REVIEW ---
-- Rows where the queue says the visit happened but the appointment doesn't
-- (e.g. a For Billing visit that was settled as No Show or rescheduled before
-- the fix). Decide per row with the cashier/front desk; not changed above.
SELECT a.id AS appointment_id, a.status AS appointment_status,
       TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
       q.queue_id, q.status AS queue_status, TO_CHAR(q.queue_date, 'YYYY-MM-DD') AS queue_date
  FROM queue_entries q JOIN appointments a ON a.id = q.appointment_id
 WHERE q.status = 'DONE'
   AND a.status NOT IN ('FOR_BILLING', 'COMPLETED')
 ORDER BY q.queue_date DESC, a.id;
