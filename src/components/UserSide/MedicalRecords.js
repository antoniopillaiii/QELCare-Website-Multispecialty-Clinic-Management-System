import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch, getUserRole } from "../../utils/auth";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Panel,
  StatusBadge,
  formatDate,
  formatTime,
  getRows,
  inputStyle,
  todayISO,
} from "../Workflow/ClinicUi";

const blankRecord = {
  patient_id: "",
  appointment_id: "",
  vital_id: "",
  visit_date: todayISO(),
  chief_complaint: "",
  history_of_illness: "",
  physical_exam: "",
  diagnosis: "",
  treatment_plan: "",
  prescriptions: "",
  lab_requests: "",
  doctor_notes: "",
  follow_up_date: "",
  follow_up_notes: "",
};

// Common diagnostic tests / exams a doctor can order with one click, so the
// requested workup is specific (CBC, Fecalysis, Eyesight, etc.) instead of free text.
const COMMON_TESTS = [
  "CBC", "Urinalysis", "Fecalysis", "Blood Chemistry", "FBS (Blood Sugar)",
  "Lipid Profile", "Chest X-ray", "ECG", "Visual Acuity (Eyesight)",
  "Urine Culture", "Pregnancy Test", "COVID-19 Test",
];

function buildFormFromAppointment(appointment, latestVital) {
  return {
    ...blankRecord,
    patient_id: appointment?.patient_id || "",
    appointment_id: appointment?.id || appointment?.appointment_id || "",
    vital_id: latestVital?.id || latestVital?.vital_id || "",
    chief_complaint: appointment?.chief_complaint || latestVital?.chief_complaint || "",
  };
}

export default function MedicalRecords({ appointment, latestVital, onCreated }) {
  const role = getUserRole();
  const isPatient = role === "Patient";
  const canCreate = role === "Doctor";
  const isConsultationEntry = canCreate && Boolean(appointment);

  const [records, setRecords] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(isConsultationEntry);
  const [form, setForm] = useState(() => buildFormFromAppointment(appointment, latestVital));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const recordEndpoint = isPatient
        ? "/medical-records/me"
        : appointment?.patient_id
          ? `/medical-records/patient/${appointment.patient_id}`
          : "/medical-records?limit=100";

      const [recordRes, appointmentRes] = await Promise.all([
        authFetch(recordEndpoint),
        canCreate && !appointment ? authFetch("/appointments?limit=100") : Promise.resolve(null),
      ]);

      const recordPayload = await recordRes.json();
      if (!recordRes.ok) throw new Error(recordPayload.message || "Failed to load records.");
      setRecords(getRows(recordPayload, "records"));

      if (appointmentRes) {
        const appointmentPayload = await appointmentRes.json();
        if (appointmentRes.ok) setAppointments(getRows(appointmentPayload, "appointments"));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [appointment, canCreate, isPatient]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!appointment) return;
    setShowForm(canCreate);
    setForm((current) => ({
      ...current,
      ...buildFormFromAppointment(appointment, latestVital),
      history_of_illness: current.history_of_illness,
      physical_exam: current.physical_exam,
      diagnosis: current.diagnosis,
      treatment_plan: current.treatment_plan,
      prescriptions: current.prescriptions,
      lab_requests: current.lab_requests,
      doctor_notes: current.doctor_notes,
      follow_up_date: current.follow_up_date,
      follow_up_notes: current.follow_up_notes,
    }));
  }, [appointment, canCreate, latestVital]);

  const selectedAppointment = useMemo(() => {
    if (appointment) return appointment;
    return appointments.find((item) => String(item.id) === String(form.appointment_id));
  }, [appointment, appointments, form.appointment_id]);

  function updateField(name, value) {
    if (name === "appointment_id") {
      const selected = appointments.find((item) => String(item.id) === String(value));
      setForm((current) => ({
        ...current,
        appointment_id: value,
        patient_id: selected?.patient_id || current.patient_id,
        chief_complaint: selected?.chief_complaint || current.chief_complaint,
      }));
      return;
    }

    setForm((current) => ({ ...current, [name]: value }));
  }

  // Append a selected test to the requested-labs field (no duplicates).
  function addTest(test) {
    setForm((current) => {
      const existing = String(current.lab_requests || "").trim();
      const items = existing ? existing.split(/,\s*/).filter(Boolean) : [];
      if (items.includes(test)) return current;
      return { ...current, lab_requests: [...items, test].join(", ") };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!canCreate) {
      setError("Only doctors can create medical records.");
      return;
    }
    if (!form.patient_id || !form.diagnosis) {
      setError("Patient and diagnosis are required.");
      return;
    }

    setSaving(true);
    try {
      const response = await authFetch("/medical-records", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          patient_id: Number(form.patient_id),
          appointment_id: form.appointment_id ? Number(form.appointment_id) : null,
          vital_id: form.vital_id ? Number(form.vital_id) : null,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to create record.");

      setMessage(isConsultationEntry ? "Medical record saved. Completing visit..." : "Medical record created.");
      setForm(appointment ? buildFormFromAppointment(appointment, latestVital) : { ...blankRecord });
      setShowForm(Boolean(appointment));
      await load();

      if (onCreated) await onCreated(payload.record || payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <ErrorState message={error} />
      {message && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>
          {message}
        </div>
      )}

      {canCreate && (
        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900, color: "#162235" }}>
                {isConsultationEntry ? "Consultation Record" : "Doctor Record Entry"}
              </div>
              <div style={{ color: "#6b778c", fontSize: 13 }}>
                Save diagnosis, treatment plan, prescriptions, and requested procedures after consultation.
              </div>
            </div>
            {!isConsultationEntry && (
              <ActionButton tone={showForm ? "secondary" : "primary"} onClick={() => setShowForm((value) => !value)}>
                {showForm ? "Close Form" : "New Record"}
              </ActionButton>
            )}
          </div>

          {showForm && (
            <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {isConsultationEntry ? (
                <div style={{ padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
                  <strong style={{ color: "#162235" }}>{appointment.patient_name}</strong>
                  <span> - Appointment #{appointment.id} - {formatDate(appointment.date)} {formatTime(appointment.time)}</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 120px 120px", gap: 10 }}>
                  <Field label="Appointment">
                    <select style={inputStyle} value={form.appointment_id} onChange={(e) => updateField("appointment_id", e.target.value)}>
                      <option value="">No appointment link</option>
                      {appointments.map((item) => (
                        <option key={item.id} value={item.id}>
                          #{item.id} {item.patient_name} - {formatDate(item.date)} {formatTime(item.time)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Patient ID">
                    <input style={inputStyle} value={form.patient_id} onChange={(e) => updateField("patient_id", e.target.value)} />
                  </Field>
                  <Field label="Visit date">
                    <input style={inputStyle} type="date" value={form.visit_date} onChange={(e) => updateField("visit_date", e.target.value)} />
                  </Field>
                </div>
              )}

              {selectedAppointment && !isConsultationEntry && (
                <div style={{ padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
                  <strong style={{ color: "#162235" }}>{selectedAppointment.patient_name}</strong> with {selectedAppointment.doctor_name} ({selectedAppointment.specialty_name || "No specialty"})
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Chief complaint">
                  <textarea style={{ ...inputStyle, minHeight: 72 }} value={form.chief_complaint} onChange={(e) => updateField("chief_complaint", e.target.value)} />
                </Field>
                <Field label="History of illness">
                  <textarea style={{ ...inputStyle, minHeight: 72 }} value={form.history_of_illness} onChange={(e) => updateField("history_of_illness", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Physical exam">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={form.physical_exam} onChange={(e) => updateField("physical_exam", e.target.value)} />
                </Field>
                <Field label="Diagnosis">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={form.diagnosis} onChange={(e) => updateField("diagnosis", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Treatment plan">
                  <textarea style={{ ...inputStyle, minHeight: 86 }} value={form.treatment_plan} onChange={(e) => updateField("treatment_plan", e.target.value)} />
                </Field>
                <Field label="Prescriptions">
                  <textarea style={{ ...inputStyle, minHeight: 86 }} value={form.prescriptions} onChange={(e) => updateField("prescriptions", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Requested procedures or labs">
                  {canCreate && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {COMMON_TESTS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => addTest(t)}
                          style={{ border: "1px solid #d7e2ef", background: "#f1f6fc", color: "#163a6b", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={form.lab_requests} onChange={(e) => updateField("lab_requests", e.target.value)} placeholder="Click a test above to add it, or type specific labs/exams (e.g. CBC, Fecalysis, Eyesight)" />
                </Field>
                <Field label="Doctor notes">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={form.doctor_notes} onChange={(e) => updateField("doctor_notes", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10 }}>
                <Field label="Follow-up date">
                  <input style={inputStyle} type="date" value={form.follow_up_date} onChange={(e) => updateField("follow_up_date", e.target.value)} />
                </Field>
                <Field label="Follow-up notes">
                  <input style={inputStyle} value={form.follow_up_notes} onChange={(e) => updateField("follow_up_notes", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <ActionButton type="submit" disabled={saving}>{saving ? "Saving..." : isConsultationEntry ? "Save Record and Complete Visit" : "Add Record"}</ActionButton>
                {!isConsultationEntry && <ActionButton tone="secondary" onClick={() => setShowForm(false)}>Cancel</ActionButton>}
              </div>
            </form>
          )}
        </Panel>
      )}

      <Panel style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6" }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>{isPatient ? "Consultation Records" : "Medical Records"}</div>
          <div style={{ fontSize: 12, color: "#6b778c", marginTop: 2 }}>{records.length} record(s)</div>
        </div>

        {loading ? (
          <LoadingState label="Loading records..." />
        ) : records.length === 0 ? (
          <EmptyState title="No records found" detail={isPatient ? "Completed doctor records will show here." : "Patient history will appear here after records are created."} />
        ) : (
          <div style={{ display: "grid" }}>
            {records.map((record) => (
              <article key={record.record_id || record.id} style={{ padding: 16, borderTop: "1px solid #eef3f9", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900, color: "#162235" }}>{record.diagnosis || "No diagnosis entered"}</div>
                    <div style={{ color: "#6b778c", fontSize: 13 }}>
                      {record.patient_name || "Patient"} - {record.doctor_name || "Doctor"} - {formatDate(record.visit_date || record.appointment_date)}
                    </div>
                  </div>
                  <StatusBadge status={record.appointment_status || "COMPLETED"} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Chief complaint" value={record.chief_complaint} />
                  <RecordBlock label="Physical exam" value={record.physical_exam} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Treatment" value={record.treatment_plan} />
                  <RecordBlock label="Prescription" value={record.prescriptions || record.prescription} />
                  <RecordBlock label="Requested procedures" value={record.lab_requests} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Follow-up" value={record.follow_up_date_text || record.follow_up_date} formatter={formatDate} />
                  <RecordBlock label="Doctor notes" value={record.doctor_notes} />
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RecordBlock({ label, value, formatter }) {
  const display = formatter && value ? formatter(value) : value;
  return (
    <div style={{ border: "1px solid #e8eef6", borderRadius: 8, padding: 10, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#6b778c", fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 4, color: "#162235", fontSize: 13, whiteSpace: "pre-wrap" }}>{display || "-"}</div>
    </div>
  );
}
