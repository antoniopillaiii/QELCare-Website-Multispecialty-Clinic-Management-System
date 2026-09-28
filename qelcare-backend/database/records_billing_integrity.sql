-- ============================================================================
-- Medical Records / Billing integrity (Medical Records & Billing fix release).
--
-- The application now enforces, server-side:
--   * one medical record per appointment (a second one is rejected with 409),
--   * a record's appointment and vitals must belong to the record's patient,
--   * a record's appointment must be the authoring doctor's own appointment.
-- This script adds the database backstop for the first rule and lists older
-- rows that break these rules, so a person can review them. It never changes
-- or deletes clinical data.
--
-- How to run (psql or any SQL console, against the target database):
--   1. Run the PREVIEW query and review the counts.
--   2. If "Appointments with more than one medical record" is not 0, resolve
--      those first (MANUAL REVIEW query A): keep one record per appointment and
--      unlink or merge the others with the doctor. The index step refuses to
--      run while duplicates exist.
--   3. Run the INDEX block. Safe to re-run.
--   4. Review MANUAL REVIEW queries B-D (older cross-links); not changed here.
-- ============================================================================

-- ---------------------------------------------------------------- PREVIEW ---
SELECT 'Appointments with more than one medical record' AS issue, COUNT(*) AS rows
  FROM (SELECT appointment_id FROM medical_records
         WHERE appointment_id IS NOT NULL
         GROUP BY appointment_id HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'Record linked to another patient''s appointment', COUNT(*)
  FROM medical_records mr JOIN appointments a ON a.id = mr.appointment_id
 WHERE a.patient_id <> mr.patient_id
UNION ALL
SELECT 'Record linked to another patient''s vitals', COUNT(*)
  FROM medical_records mr JOIN vitals v ON v.id = mr.vital_id
 WHERE v.patient_id IS DISTINCT FROM mr.patient_id
UNION ALL
SELECT 'Record doctor differs from the appointment''s doctor', COUNT(*)
  FROM medical_records mr JOIN appointments a ON a.id = mr.appointment_id
 WHERE mr.doctor_id IS NOT NULL AND mr.doctor_id <> a.doctor_id
UNION ALL
SELECT 'Paid bill whose patient differs from its appointment''s patient', COUNT(*)
  FROM billing b JOIN appointments a ON a.id = b.appointment_id
 WHERE b.status = 'PAID' AND b.patient_id <> a.patient_id;

-- ------------------------------------------------------------------ INDEX ---
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM medical_records
     WHERE appointment_id IS NOT NULL
     GROUP BY appointment_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Some appointments have more than one medical record. Resolve them first (MANUAL REVIEW query A), then run this block again.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_medical_records_appointment
  ON public.medical_records (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- ---------------------------------------------------------- MANUAL REVIEW ---
-- A. Duplicate records per appointment (ids only; open them in the app).
SELECT mr.appointment_id, mr.record_id, mr.doctor_id,
       TO_CHAR(mr.visit_date, 'YYYY-MM-DD') AS visit_date, mr.created_at
  FROM medical_records mr
 WHERE mr.appointment_id IN (
         SELECT appointment_id FROM medical_records
          WHERE appointment_id IS NOT NULL
          GROUP BY appointment_id HAVING COUNT(*) > 1)
 ORDER BY mr.appointment_id, mr.created_at;

-- B. Records pointing at another patient's appointment.
SELECT mr.record_id, mr.patient_id AS record_patient, mr.appointment_id, a.patient_id AS appointment_patient
  FROM medical_records mr JOIN appointments a ON a.id = mr.appointment_id
 WHERE a.patient_id <> mr.patient_id
 ORDER BY mr.record_id;

-- C. Records pointing at another patient's vitals.
SELECT mr.record_id, mr.patient_id AS record_patient, mr.vital_id, v.patient_id AS vitals_patient
  FROM medical_records mr JOIN vitals v ON v.id = mr.vital_id
 WHERE v.patient_id IS DISTINCT FROM mr.patient_id
 ORDER BY mr.record_id;

-- D. Records written on another doctor's appointment.
SELECT mr.record_id, mr.doctor_id AS record_doctor, mr.appointment_id, a.doctor_id AS appointment_doctor
  FROM medical_records mr JOIN appointments a ON a.id = mr.appointment_id
 WHERE mr.doctor_id IS NOT NULL AND mr.doctor_id <> a.doctor_id
 ORDER BY mr.record_id;
