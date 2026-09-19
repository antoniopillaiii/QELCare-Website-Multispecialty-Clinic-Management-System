import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { C } from "../../../utils/adminTheme";
import { X } from "lucide-react";

const EXPORT_COLUMNS = [
  { header: "Record", value: (record) => `MR-${String(recordId(record)).padStart(5, "0")}` },
  { header: "Patient", value: (record) => record.patient_name || "" },
  { header: "Phone", value: (record) => record.patient_phone || "" },
  { header: "Doctor", value: (record) => record.doctor_name || "" },
  { header: "Visit Date", value: (record) => formatDate(record.visit_date) },
  { header: "Specialty", value: (record) => record.specialty_name || "" },
  { header: "Diagnosis", value: (record) => record.diagnosis || "" },
  { header: "Chief Complaint", value: (record) => record.chief_complaint || "" },
  { header: "Vitals", value: (record) => (record.vital_id ? `Vitals #${record.vital_id}` : "Not linked") },
  { header: "Follow-up", value: (record) => { const f = record.follow_up_date_text || record.follow_up_date; return f ? formatDate(f) : ""; } },
  { header: "Confidential", value: (record) => (record.is_confidential ? "Yes" : "No") },
];

const inputStyle = {
  height: 40,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "0 12px",
  background: "#fff",
  color: C.navy,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  minWidth: 0,
};

const textareaStyle = {
  ...inputStyle,
  minHeight: 88,
  height: "auto",
  padding: 12,
  resize: "vertical",
  lineHeight: 1.45,
};

async function parseApi(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Request failed.");
  }
  return payload;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Not set";
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "Not set";
  const [h, m] = String(value).split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return value;
  return `${hour % 12 || 12}:${m || "00"} ${hour >= 12 ? "PM" : "AM"}`;
}

function patientName(patient) {
  return patient.display_name || patient.name || [patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Unnamed Patient";
}

function doctorName(doctor) {
  return [doctor.first_name, doctor.last_name].filter(Boolean).join(" ") || doctor.username || "Unnamed Doctor";
}

function recordId(record) {
  return record?.record_id || record?.id;
}

function Field({ label, children, span = 1 }) {
  return (
    <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 800, color: C.navy, gridColumn: span === 2 ? "1 / -1" : undefined }}>
      {label}
      {children}
    </label>
  );
}

function Button({ children, onClick, type = "button", variant = "secondary", disabled }) {
  const primary = variant === "primary";
  const danger = variant === "danger";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 38,
        padding: "0 14px",
        borderRadius: 10,
        border: primary || danger ? "none" : `1px solid ${C.border}`,
        background: danger ? C.red : primary ? C.blue : "#fff",
        color: primary || danger ? "#fff" : C.blue,
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.62 : 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 2px 10px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function DetailBox({ label, value }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.soft, padding: 13 }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, whiteSpace: "pre-wrap" }}>{value || "Not set"}</div>
    </div>
  );
}

function RecordViewModal({ record, onClose }) {
  const followUp = record.follow_up_date_text || record.follow_up_date;
  return (
    <div onMouseDown={(event) => event.target === event.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(10,20,35,.58)", display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ width: "min(980px,100%)", maxHeight: "90vh", overflow: "hidden", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
        <div style={{ padding: "18px 22px", background: C.blue, color: "#fff", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Medical Record #{recordId(record)}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{record.patient_name || "Unknown patient"} / {formatDate(record.visit_date)}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, border: "none", borderRadius: 8, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        <div style={{ padding: 22, background: "#fafbfd", overflowY: "auto", maxHeight: "calc(90vh - 74px)", display: "grid", gap: 16 }}>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
            <DetailBox label="Patient" value={record.patient_name} />
            <DetailBox label="Doctor" value={record.doctor_name} />
            <DetailBox label="Visit Date" value={formatDate(record.visit_date)} />
            <DetailBox label="Appointment" value={record.appointment_id ? `APT-${String(record.appointment_id).padStart(5, "0")} / ${record.appointment_status || "No status"}` : "Not linked"} />
            <DetailBox label="Specialty" value={record.specialty_name} />
            <DetailBox label="Linked Vitals" value={record.vital_id ? `Vitals #${record.vital_id}` : "Not linked"} />
          </section>

          {record.vital_id && (
            <section style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: "#fff", padding: 16 }}>
              <div style={{ fontWeight: 900, color: C.navy, marginBottom: 12 }}>Linked Vitals</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                <DetailBox label="BP" value={record.blood_pressure} />
                <DetailBox label="Pulse" value={record.pulse_rate || record.heart_rate} />
                <DetailBox label="Temp" value={record.temperature ? `${record.temperature} C` : ""} />
                <DetailBox label="O2" value={record.oxygen_saturation || record.o2_saturation} />
                <DetailBox label="Weight" value={record.weight_kg ? `${record.weight_kg} kg` : ""} />
                <DetailBox label="Height" value={record.height_cm ? `${record.height_cm} cm` : ""} />
              </div>
            </section>
          )}

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            <DetailBox label="Chief Complaint" value={record.chief_complaint} />
            <DetailBox label="History of Illness" value={record.history_of_illness} />
            <DetailBox label="Physical Exam" value={record.physical_exam} />
            <DetailBox label="Diagnosis" value={record.diagnosis} />
            <DetailBox label="Treatment Plan" value={record.treatment_plan} />
            <DetailBox label="Prescriptions" value={record.prescriptions} />
            <DetailBox label="Lab Requests" value={record.lab_requests} />
            <DetailBox label="Doctor Notes" value={record.doctor_notes} />
            <DetailBox label="Follow-up" value={followUp ? `${formatDate(followUp)}\n${record.follow_up_notes || ""}` : record.follow_up_notes} />
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordFormModal({ record, patients, doctors, appointments, saving, onClose, onSave }) {
  const isEdit = !!record;
  const [error, setError] = useState("");
  const [vitals, setVitals] = useState([]);
  const [loadingVitals, setLoadingVitals] = useState(false);
  const [form, setForm] = useState(() => ({
    patient_id: record?.patient_id || "",
    appointment_id: record?.appointment_id || "",
    doctor_id: record?.doctor_id || "",
    vital_id: record?.vital_id || "",
    visit_date: record?.visit_date ? String(record.visit_date).slice(0, 10) : todayInput(),
    chief_complaint: record?.chief_complaint || "",
    history_of_illness: record?.history_of_illness || "",
    physical_exam: record?.physical_exam || "",
    diagnosis: record?.diagnosis || "",
    treatment_plan: record?.treatment_plan || "",
    prescriptions: record?.prescriptions || "",
    lab_requests: record?.lab_requests || "",
    doctor_notes: record?.doctor_notes || "",
    follow_up_date: record?.follow_up_date_text || (record?.follow_up_date ? String(record.follow_up_date).slice(0, 10) : ""),
    follow_up_notes: record?.follow_up_notes || "",
    is_confidential: !!record?.is_confidential,
  }));

  const patientAppointments = useMemo(() => {
    return appointments.filter((appointment) => !form.patient_id || String(appointment.patient_id) === String(form.patient_id));
  }, [appointments, form.patient_id]);

  const set = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const setAppointment = (event) => {
    const appointmentId = event.target.value;
    const appointment = appointments.find((item) => String(item.id) === String(appointmentId));
    setForm((prev) => ({
      ...prev,
      appointment_id: appointmentId,
      patient_id: appointment?.patient_id || prev.patient_id,
      doctor_id: appointment?.doctor_id || prev.doctor_id,
      visit_date: appointment?.date || prev.visit_date,
      chief_complaint: prev.chief_complaint || appointment?.chief_complaint || "",
    }));
  };

  useEffect(() => {
    if (!form.patient_id) {
      setVitals([]);
      return;
    }

    let active = true;
    setLoadingVitals(true);
    authFetch(`/vitals/patient/${form.patient_id}`)
      .then(parseApi)
      .then((payload) => {
        if (active) setVitals(Array.isArray(payload.data) ? payload.data : payload.vitals || []);
      })
      .catch(() => {
        if (active) setVitals([]);
      })
      .finally(() => {
        if (active) setLoadingVitals(false);
      });

    return () => {
      active = false;
    };
  }, [form.patient_id]);

  const submit = (event) => {
    event.preventDefault();
    setError("");

    if (!form.patient_id || !form.doctor_id || !form.visit_date) {
      setError("Patient, doctor, and visit date are required.");
      return;
    }

    if (!form.diagnosis && !form.treatment_plan && !form.doctor_notes) {
      setError("Add at least a diagnosis, treatment plan, or doctor note.");
      return;
    }

    onSave({
      patient_id: Number(form.patient_id),
      appointment_id: form.appointment_id ? Number(form.appointment_id) : null,
      doctor_id: Number(form.doctor_id),
      vital_id: form.vital_id ? Number(form.vital_id) : null,
      visit_date: form.visit_date,
      chief_complaint: form.chief_complaint.trim() || null,
      history_of_illness: form.history_of_illness.trim() || null,
      physical_exam: form.physical_exam.trim() || null,
      diagnosis: form.diagnosis.trim() || null,
      treatment_plan: form.treatment_plan.trim() || null,
      prescriptions: form.prescriptions.trim() || null,
      lab_requests: form.lab_requests.trim() || null,
      doctor_notes: form.doctor_notes.trim() || null,
      follow_up_date: form.follow_up_date || null,
      follow_up_notes: form.follow_up_notes.trim() || null,
      is_confidential: form.is_confidential,
    });
  };

  return (
    <div onMouseDown={(event) => event.target === event.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 750, background: "rgba(10,20,35,.58)", display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ width: "min(980px,100%)", maxHeight: "90vh", overflow: "hidden", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
        <div style={{ padding: "18px 22px", background: C.blue, color: "#fff", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{isEdit ? `Edit Medical Record #${recordId(record)}` : "Create Medical Record"}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>Doctor-authored clinical documentation</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, border: "none", borderRadius: 8, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 22, background: "#fafbfd", overflowY: "auto", maxHeight: "calc(90vh - 74px)", display: "grid", gap: 16 }}>
          {error && <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fff2f4", color: C.red, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 800 }}>{error}</div>}

          <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
            <Field label="Patient *">
              <select name="patient_id" value={form.patient_id} onChange={set} style={inputStyle}>
                <option value="">Select patient</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientName(patient)} / #{patient.id}</option>)}
              </select>
            </Field>
            <Field label="Doctor *">
              <select name="doctor_id" value={form.doctor_id} onChange={set} style={inputStyle}>
                <option value="">Select doctor</option>
                {doctors.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
              </select>
            </Field>
            <Field label="Visit Date *">
              <input type="date" name="visit_date" value={form.visit_date} onChange={set} style={inputStyle} />
            </Field>
            <Field label="Appointment Optional">
              <select name="appointment_id" value={form.appointment_id} onChange={setAppointment} style={inputStyle}>
                <option value="">Not linked</option>
                {patientAppointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    APT-{String(appointment.id).padStart(5, "0")} / {formatDate(appointment.date)} {formatTime(appointment.time)} / {appointment.status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Linked Vitals Optional">
              <select name="vital_id" value={form.vital_id} onChange={set} disabled={!form.patient_id || loadingVitals} style={inputStyle}>
                <option value="">{loadingVitals ? "Loading vitals..." : "Not linked"}</option>
                {vitals.map((vital) => (
                  <option key={vital.vital_id || vital.id} value={vital.vital_id || vital.id}>
                    Vitals #{vital.vital_id || vital.id} / {formatDate(vital.recorded_at)} / BP {vital.blood_pressure || "-"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Confidential">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, color: C.text, fontWeight: 800 }}>
                <input type="checkbox" name="is_confidential" checked={form.is_confidential} onChange={set} />
                Mark as confidential
              </label>
            </Field>
          </section>

          <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
            <Field label="Chief Complaint" span={2}><textarea name="chief_complaint" value={form.chief_complaint} onChange={set} style={textareaStyle} /></Field>
            <Field label="History of Illness"><textarea name="history_of_illness" value={form.history_of_illness} onChange={set} style={textareaStyle} /></Field>
            <Field label="Physical Exam"><textarea name="physical_exam" value={form.physical_exam} onChange={set} style={textareaStyle} /></Field>
            <Field label="Diagnosis"><textarea name="diagnosis" value={form.diagnosis} onChange={set} style={textareaStyle} /></Field>
            <Field label="Treatment Plan"><textarea name="treatment_plan" value={form.treatment_plan} onChange={set} style={textareaStyle} /></Field>
            <Field label="Prescriptions"><textarea name="prescriptions" value={form.prescriptions} onChange={set} style={textareaStyle} /></Field>
            <Field label="Lab Requests"><textarea name="lab_requests" value={form.lab_requests} onChange={set} style={textareaStyle} /></Field>
            <Field label="Doctor Notes" span={2}><textarea name="doctor_notes" value={form.doctor_notes} onChange={set} style={textareaStyle} /></Field>
          </section>

          <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, display: "grid", gridTemplateColumns: "minmax(200px,260px) 1fr", gap: 14 }}>
            <Field label="Follow-up Date"><input type="date" name="follow_up_date" value={form.follow_up_date} onChange={set} style={inputStyle} /></Field>
            <Field label="Follow-up Notes"><textarea name="follow_up_notes" value={form.follow_up_notes} onChange={set} style={textareaStyle} /></Field>
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Record"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "12px 14px", color: C.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", whiteSpace: "nowrap" };
const tdStyle = { padding: "13px 14px", color: C.text, fontSize: 13, verticalAlign: "middle" };

export default function AdminRecords() {
  const [records, setRecords] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState("");
  const [patientFilter, setPatientFilter] = useState("all");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [modal, setModal] = useState(null);

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.setTimeout(() => setAlert(null), 4200);
  }, []);

  const loadLookups = useCallback(async () => {
    const [patientsPayload, usersPayload, apptPayload] = await Promise.all([
      parseApi(await authFetch("/patients")),
      parseApi(await authFetch("/users")),
      parseApi(await authFetch("/appointments?limit=100")),
    ]);

    const patientList = Array.isArray(patientsPayload.data) ? patientsPayload.data : patientsPayload.patients || [];
    const userList = Array.isArray(usersPayload.data) ? usersPayload.data : [];
    const appointmentList = Array.isArray(apptPayload.data) ? apptPayload.data : apptPayload.appointments || [];

    setPatients(patientList.filter((patient) => patient.is_active !== false));
    setDoctors(userList.filter((user) => user.role === "Doctor" && user.status !== "deactivated"));
    setAppointments(appointmentList);
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await parseApi(await authFetch("/medical-records?limit=100"));
      setRecords(Array.isArray(payload.data) ? payload.data : payload.records || []);
    } catch (err) {
      console.error("Medical records load error:", err);
      showAlert("err", err.message || "Failed to load medical records");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadLookups().catch((err) => {
      console.error("Medical records lookup error:", err);
      showAlert("err", err.message || "Failed to load record lookups");
    });
  }, [loadLookups, showAlert]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const stats = useMemo(() => {
    const uniquePatients = new Set(records.map((record) => record.patient_id)).size;
    const withVitals = records.filter((record) => record.vital_id).length;
    const followUps = records.filter((record) => record.follow_up_date || record.follow_up_date_text).length;
    const confidential = records.filter((record) => record.is_confidential).length;
    return { total: records.length, uniquePatients, withVitals, followUps, confidential };
  }, [records]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const patientMatches = patientFilter === "all" || String(record.patient_id) === String(patientFilter);
      const doctorMatches = doctorFilter === "all" || String(record.doctor_id) === String(doctorFilter);
      const searchMatches = !query || [
        record.record_id,
        record.patient_name,
        record.doctor_name,
        record.diagnosis,
        record.chief_complaint,
        record.treatment_plan,
        record.doctor_notes,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      return patientMatches && doctorMatches && searchMatches;
    });
  }, [doctorFilter, patientFilter, records, search]);

  const saveRecord = async (payload) => {
    setSaving(true);
    try {
      const isEdit = modal?.mode === "edit";
      const response = await parseApi(await authFetch(
        isEdit ? `/medical-records/${recordId(modal.record)}` : "/medical-records",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }
      ));
      const saved = response.data || response.record;
      setRecords((prev) => {
        const index = prev.findIndex((item) => String(recordId(item)) === String(recordId(saved)));
        if (index < 0) return [saved, ...prev];
        const next = [...prev];
        next[index] = saved;
        return next;
      });
      setModal(null);
      showAlert("ok", isEdit ? "Medical record updated successfully" : "Medical record created successfully");
    } catch (err) {
      console.error("Medical record save error:", err);
      showAlert("err", err.message || "Failed to save medical record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout pageTitle="Medical Records" pageSubtitle="Doctor-authored patient clinical records">
      {alert && (
        <div style={{
          position: "fixed",
          top: 22,
          right: 22,
          zIndex: 900,
          padding: "12px 16px",
          borderRadius: 12,
          background: alert.type === "ok" ? "#eaf8f0" : "#fff2f4",
          color: alert.type === "ok" ? C.teal : C.red,
          border: `1px solid ${alert.type === "ok" ? "#b8e5cc" : "#f7c5cb"}`,
          boxShadow: "0 8px 24px rgba(15,23,42,.16)",
          fontSize: 13,
          fontWeight: 800,
        }}>
          {alert.message}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, color: C.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin</div>
          <h1 style={{ margin: "4px 0 4px", color: C.navy, fontSize: 24, lineHeight: 1.2 }}>Medical Records</h1>
          <div style={{ color: C.text, fontSize: 13 }}>Review doctor-authored records. Clinical edits are restricted to doctors.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ExportMenu
            filename="qelcare-medical-records"
            title="QELCare Medical Records"
            subtitle={`${visibleRecords.length} record${visibleRecords.length === 1 ? "" : "s"} matching the current filters`}
            sheetTitle="Medical Records"
            columns={EXPORT_COLUMNS}
            rows={visibleRecords}
            disabled={loading}
          />
          <Button onClick={loadRecords} disabled={loading}>Refresh</Button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard label="Total Records" value={loading ? "-" : stats.total} sub="Doctor-authored records" color={C.blue} />
        <StatCard label="Unique Patients" value={loading ? "-" : stats.uniquePatients} sub="With records" color={C.purple} />
        <StatCard label="Linked Vitals" value={loading ? "-" : stats.withVitals} sub="With nurse vitals" color={C.teal} />
        <StatCard label="Follow-ups" value={loading ? "-" : stats.followUps} sub="With follow-up plans" color={C.amber} />
        <StatCard label="Confidential" value={loading ? "-" : stats.confidential} sub="Restricted records" color={C.red} />
      </section>

      <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.border}`, background: "linear-gradient(to right,#f8fafd,#fff)", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1.6fr) repeat(2,minmax(170px,1fr)) auto", gap: 10, alignItems: "center" }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search record, patient, diagnosis..." style={inputStyle} />
            <select value={patientFilter} onChange={(event) => setPatientFilter(event.target.value)} style={inputStyle}>
              <option value="all">All Patients</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientName(patient)}</option>)}
            </select>
            <select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} style={inputStyle}>
              <option value="all">All Doctors</option>
              {doctors.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
            </select>
            <Button onClick={() => { setSearch(""); setPatientFilter("all"); setDoctorFilter("all"); }}>Clear</Button>
          </div>
          <div style={{ color: C.text, fontSize: 12, fontWeight: 800 }}>
            Showing {visibleRecords.length} of {records.length} loaded medical record{records.length === 1 ? "" : "s"}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr style={{ background: C.soft }}>
                <th style={thStyle}>Record</th>
                <th style={thStyle}>Patient</th>
                <th style={thStyle}>Doctor</th>
                <th style={thStyle}>Visit</th>
                <th style={thStyle}>Diagnosis</th>
                <th style={thStyle}>Vitals</th>
                <th style={thStyle}>Follow-up</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>Loading medical records...</td></tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 42, textAlign: "center" }}>
                    <div style={{ color: C.navy, fontSize: 16, fontWeight: 900 }}>No medical records found</div>
                    <div style={{ color: C.text, fontSize: 13, marginTop: 5 }}>Create records after a patient visit or completed appointment.</div>
                  </td>
                </tr>
              ) : (
                visibleRecords.map((record) => {
                  const followUp = record.follow_up_date_text || record.follow_up_date;
                  return (
                    <tr key={recordId(record)} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td data-label="Record" style={tdStyle}>
                        <div style={{ color: C.navy, fontWeight: 900 }}>MR-{String(recordId(record)).padStart(5, "0")}</div>
                        <div style={{ color: C.muted, fontSize: 12 }}>{record.is_confidential ? "Confidential" : "Standard"}</div>
                      </td>
                      <td data-label="Patient" style={tdStyle}>
                        <div style={{ color: C.navy, fontWeight: 900 }}>{record.patient_name || "Unknown patient"}</div>
                        <div style={{ color: C.muted, fontSize: 12 }}>{record.patient_phone || "No phone"}</div>
                      </td>
                      <td data-label="Doctor" style={tdStyle}>{record.doctor_name || "Not set"}</td>
                      <td data-label="Visit" style={tdStyle}>
                        <div>{formatDate(record.visit_date)}</div>
                        <div style={{ color: C.muted, fontSize: 12 }}>{record.specialty_name || "No specialty"}</div>
                      </td>
                      <td data-label="Diagnosis" className="qc-td-block" style={{ ...tdStyle, maxWidth: 260 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 800, color: C.navy }}>
                          {record.diagnosis || "No diagnosis"}
                        </div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.muted, fontSize: 12 }}>
                          {record.chief_complaint || "No chief complaint"}
                        </div>
                      </td>
                      <td data-label="Vitals" style={tdStyle}>{record.vital_id ? `Vitals #${record.vital_id}` : "Not linked"}</td>
                      <td data-label="Follow-up" style={tdStyle}>{followUp ? formatDate(followUp) : "None"}</td>
                      <td data-label="Actions" className="qc-td-block" style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 8 }}>
                          <Button onClick={() => setModal({ mode: "view", record })}>View</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal?.mode === "view" && (
        <RecordViewModal
          record={modal.record}
          onClose={() => setModal(null)}
        />
      )}

      {false && ["create", "edit"].includes(modal?.mode) && (
        <RecordFormModal
          record={modal.record}
          patients={patients}
          doctors={doctors}
          appointments={appointments}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={saveRecord}
        />
      )}
    </MainLayout>
  );
}