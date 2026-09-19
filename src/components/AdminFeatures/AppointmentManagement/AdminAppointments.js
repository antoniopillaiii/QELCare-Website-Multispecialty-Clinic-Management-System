import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../../Layout/MainLayout";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { C } from "../../../utils/adminTheme";
import ReasonModal from "../../common/ReasonModal";
import { X } from "lucide-react";

const EXPORT_COLUMNS = [
  { header: "Reference", value: (appt) => `APT-${String(appt.id).padStart(5, "0")}` },
  { header: "Patient", value: (appt) => appt.patient_name || "" },
  { header: "Phone", value: (appt) => appt.patient_phone || "" },
  { header: "Doctor", value: (appt) => appt.doctor_name || "" },
  { header: "Specialty", value: (appt) => appt.specialty_name || "" },
  { header: "Date", value: (appt) => formatDate(appt.date) },
  { header: "Time", value: (appt) => formatTime(appt.time) },
  { header: "Status", value: (appt) => STATUS_META[appt.status]?.label || appt.status || "" },
  { header: "Type", value: (appt) => appt.type || "" },
  { header: "Chief Complaint", value: (appt) => appt.chief_complaint || appt.notes || "" },
];

const STATUS_OPTIONS = ["PENDING", "CONFIRMED", "IN_QUEUE", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"];
const TYPE_OPTIONS = [
  { value: "consultation", label: "Consultation" },
  { value: "follow_up", label: "Follow-up" },
  { value: "walk_in", label: "Walk-in" },
  { value: "emergency", label: "Emergency" },
];

const STATUS_META = {
  PENDING: { label: "Pending", color: C.purple, bg: "#f2eafa" },
  CONFIRMED: { label: "Confirmed", color: C.blue, bg: "#eef3fb" },
  IN_QUEUE: { label: "In Queue", color: C.amber, bg: "#fff4de" },
  COMPLETED: { label: "Completed", color: C.teal, bg: "#eaf8f4" },
  CANCELLED: { label: "Cancelled", color: C.red, bg: "#fff2f4" },
  RESCHEDULED: { label: "Rescheduled", color: C.amber, bg: "#fff4de" },
  NO_SHOW: { label: "No Show", color: "#666", bg: "#f1f1f1" },
};

const TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_QUEUE", "CANCELLED", "NO_SHOW"],
  IN_QUEUE: ["CANCELLED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

async function parseApi(response) {
  if (!response) throw new Error("Request was not completed.");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Request failed.");
  }
  return payload;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "Not set";
  const [h, m] = String(value).split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return `${twelve}:${m || "00"} ${suffix}`;
}

function todayInput() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function patientName(patient) {
  return patient.display_name || patient.name || [patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Unnamed Patient";
}

function doctorName(doctor) {
  return [doctor.first_name, doctor.last_name].filter(Boolean).join(" ") || doctor.username || "Unnamed Doctor";
}

function Badge({ status }) {
  const meta = STATUS_META[status] || { label: status || "Unknown", color: "#555", bg: "#eee" };
  return (
    <span style={{ display: "inline-flex", padding: "5px 10px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
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
        opacity: disabled ? 0.6 : 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

const inputStyle = {
  height: 42,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "0 12px",
  background: "#fff",
  color: C.navy,
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  minWidth: 0,
};

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 7, color: C.navy, fontSize: 13, fontWeight: 800 }}>
      {label}
      {children}
    </label>
  );
}

function StatCard({ label, value, sub, color, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${active ? color : C.border}`,
        borderTop: `3px solid ${color}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: active ? "0 8px 22px rgba(15,23,42,.10)" : "0 2px 10px rgba(15,23,42,.05)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 900, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{sub}</div>
    </button>
  );
}

function AppointmentModal({ mode, appointment, patients, doctors, specialties, saving, onClose, onSave }) {
  const isEdit = !!appointment;
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    patient_id: appointment?.patient_id || "",
    doctor_id: appointment?.doctor_id || "",
    specialty_id: appointment?.specialty_id || "",
    date: appointment?.date || todayInput(),
    time: appointment?.time ? String(appointment.time).slice(0, 5) : "",
    type: appointment?.type || "consultation",
    chief_complaint: appointment?.chief_complaint || "",
    notes: appointment?.notes || "",
  }));

  const set = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    setError("");
    if (!form.patient_id || !form.doctor_id || !form.date || !form.time) {
      setError("Patient, doctor, date, and time are required.");
      return;
    }
    onSave({
      patient_id: Number(form.patient_id),
      doctor_id: Number(form.doctor_id),
      specialty_id: form.specialty_id ? Number(form.specialty_id) : null,
      date: form.date,
      time: form.time,
      type: form.type,
      chief_complaint: form.chief_complaint.trim() || null,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <div onMouseDown={(event) => event.target === event.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(10,20,35,.58)", display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ width: "min(820px,100%)", maxHeight: "90vh", overflow: "hidden", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
        <div style={{ padding: "18px 22px", background: C.blue, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{isEdit ? "Reschedule Appointment" : "Create Appointment"}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{isEdit ? `Appointment #${appointment.id}` : "Book an existing patient with a clinic doctor"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, border: "none", borderRadius: 8, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 24, background: "#fafbfd", maxHeight: "calc(90vh - 74px)", overflowY: "auto", display: "grid", gap: 16 }}>
          {error && <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fff2f4", color: C.red, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 800 }}>{error}</div>}

          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
            <Field label="Patient *">
              <select name="patient_id" value={form.patient_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">Select patient</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientName(patient)} / #{patient.id}</option>)}
              </select>
            </Field>
            <Field label="Doctor *">
              <select name="doctor_id" value={form.doctor_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">Select doctor</option>
                {doctors.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
              </select>
            </Field>
            <Field label="Specialty">
              <select name="specialty_id" value={form.specialty_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">Unassigned</option>
                {specialties.map((spec) => <option key={spec.specialty_id} value={spec.specialty_id}>{spec.specialty_name}</option>)}
              </select>
            </Field>
            <Field label="Visit Type">
              <select name="type" value={form.type} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                {TYPE_OPTIONS.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </Field>
            <Field label="Date *"><input type="date" min={todayInput()} name="date" value={form.date} onChange={set} style={inputStyle} /></Field>
            <Field label="Time *"><input type="time" name="time" value={form.time} onChange={set} style={inputStyle} /></Field>
          </div>

          {!isEdit && (
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gap: 14 }}>
              <Field label="Chief Complaint">
                <input name="chief_complaint" value={form.chief_complaint} onChange={set} style={inputStyle} placeholder="Reason for visit" />
              </Field>
              <Field label="Notes">
                <textarea name="notes" value={form.notes} onChange={set} rows={3} style={{ ...inputStyle, height: "auto", padding: 12, resize: "vertical" }} />
              </Field>
            </div>
          )}

          {isEdit && (
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fff4de", color: C.amber, fontSize: 13, fontWeight: 800 }}>
              Rescheduling returns the appointment to Pending so staff can reconfirm the new time.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Reschedule" : "Create Appointment"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AppointmentRow({ appointment, onStatus, onReschedule }) {
  const actions = TRANSITIONS[appointment.status] || [];
  const terminal = actions.length === 0;
  const isToday = appointment.date === todayInput();
  // Prefer the backend-computed flag; fall back to a local date+time check.
  const isPast =
    appointment.is_past === true ||
    (appointment.date && appointment.date < todayInput());
  const nonTerminal = !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);
  // A past appointment that was never resolved needs settling.
  const needsSettle = isPast && nonTerminal && appointment.status !== "IN_QUEUE";

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
      <td data-label="Reference" style={tdStyle}>
        <div style={{ color: C.navy, fontWeight: 900 }}>APT-{String(appointment.id).padStart(5, "0")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>{appointment.type || "consultation"}</div>
      </td>
      <td data-label="Patient" style={tdStyle}>
        <div style={{ color: C.navy, fontWeight: 900 }}>{appointment.patient_name || "Unknown patient"}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>{appointment.patient_phone || "No phone"}</div>
      </td>
      <td data-label="Doctor" style={tdStyle}>
        <div style={{ color: C.navy, fontWeight: 800 }}>{appointment.doctor_name || "Unknown doctor"}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>{appointment.specialty_name || "No specialty"}</div>
      </td>
      <td data-label="Date/Time" style={tdStyle}>
        <div style={{ color: C.navy, fontWeight: 800 }}>{formatDate(appointment.date)}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>{formatTime(appointment.time)}</div>
      </td>
      <td data-label="Status" style={tdStyle}><Badge status={appointment.status} /></td>
      <td data-label="Reason" className="qc-td-block" style={{ ...tdStyle, maxWidth: 220 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {appointment.chief_complaint || appointment.notes || "None"}
        </div>
      </td>
      <td data-label="Actions" className="qc-td-block" style={{ ...tdStyle, textAlign: "right" }}>
        <div className="qc-actions" style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
          {needsSettle ? (
            <>
              <span style={{ color: C.amber, fontSize: 12, fontWeight: 800, alignSelf: "center" }}>Past — settle:</span>
              <Button onClick={() => onStatus(appointment, "NO_SHOW")}>No Show</Button>
              <Button variant="danger" onClick={() => onStatus(appointment, "CANCELLED")}>Cancel</Button>
            </>
          ) : (
            <>
              {!isPast && actions.includes("CONFIRMED") && <Button onClick={() => onStatus(appointment, "CONFIRMED")}>{isToday ? "Approve and Queue" : "Approve"}</Button>}
              {!isPast && actions.includes("IN_QUEUE") && isToday && <Button onClick={() => onStatus(appointment, "IN_QUEUE")}>Check In</Button>}
              {!isPast && actions.includes("NO_SHOW") && isToday && <Button onClick={() => onStatus(appointment, "NO_SHOW")}>No Show</Button>}
              {!isPast && ["PENDING", "CONFIRMED", "RESCHEDULED"].includes(appointment.status) && <Button onClick={() => onReschedule(appointment)}>Reschedule</Button>}
              {!isPast && actions.includes("CANCELLED") && <Button variant="danger" onClick={() => onStatus(appointment, "CANCELLED")}>Cancel</Button>}
              {!isPast && appointment.status === "CONFIRMED" && !isToday && <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>Waiting date</span>}
              {appointment.status === "IN_QUEUE" && isPast && <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>In consultation workflow</span>}
              {terminal && <span style={{ color: C.muted, fontSize: 12 }}>No actions</span>}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

const thStyle = { textAlign: "left", padding: "12px 14px", color: C.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", whiteSpace: "nowrap" };
const tdStyle = { padding: "13px 14px", color: C.text, fontSize: 13, verticalAlign: "middle" };

// Statuses accepted from the ?status= deep-link (e.g. from dashboard cards).
const APPT_STATUS_VALUES = ["PENDING", "CONFIRMED", "IN_QUEUE", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"];

export default function AdminAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState("");
  // Preset filters from the URL so dashboard cards can deep-link here, e.g.
  // /admin/appointments?date=today  or  ?date=today&status=COMPLETED
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(() => {
    const s = searchParams.get("status");
    return s && APPT_STATUS_VALUES.includes(s) ? s : "all";
  });
  const [dateFilter, setDateFilter] = useState(() => {
    const d = searchParams.get("date");
    if (d === "today") return todayInput();
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return "";
  });
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.setTimeout(() => setAlert(null), 4200);
  }, []);

  const loadLookups = useCallback(async () => {
    const [patientsPayload, usersPayload, specsPayload] = await Promise.all([
      parseApi(await authFetch("/patients")),
      parseApi(await authFetch("/users")),
      parseApi(await authFetch("/queue/specialties")),
    ]);

    const patientList = Array.isArray(patientsPayload.data) ? patientsPayload.data : patientsPayload.patients || [];
    const userList = Array.isArray(usersPayload.data) ? usersPayload.data : [];
    const specList = Array.isArray(specsPayload.data) ? specsPayload.data : [];

    setPatients(patientList.filter((patient) => patient.is_active !== false));
    setDoctors(userList.filter((user) => user.role === "Doctor" && user.status !== "deactivated"));
    setSpecialties(specList);
  }, []);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("limit", "100");

      const payload = await parseApi(await authFetch(`/appointments?${query.toString()}`));
      setAppointments(Array.isArray(payload.data) ? payload.data : payload.appointments || []);
    } catch (error) {
      console.error("Appointment load error:", error);
      showAlert("err", error.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadLookups().catch((error) => {
      console.error("Appointment lookup load error:", error);
      showAlert("err", error.message || "Failed to load appointment lookups");
    });
  }, [loadLookups, showAlert]);

  useEffect(() => {
    const id = window.setTimeout(loadAppointments, 250);
    return () => window.clearTimeout(id);
  }, [loadAppointments]);

  const stats = useMemo(() => {
    const today = todayInput();
    return {
      total: appointments.length,
      today: appointments.filter((appt) => appt.date === today).length,
      pending: appointments.filter((appt) => appt.status === "PENDING").length,
      confirmed: appointments.filter((appt) => appt.status === "CONFIRMED").length,
      inQueue: appointments.filter((appt) => appt.status === "IN_QUEUE").length,
      completed: appointments.filter((appt) => appt.status === "COMPLETED").length,
      cancelled: appointments.filter((appt) => ["CANCELLED", "NO_SHOW"].includes(appt.status)).length,
    };
  }, [appointments]);

  const visibleAppointments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return appointments.filter((appointment) => {
      const statusMatches = statusFilter === "all" || appointment.status === statusFilter;
      const dateMatches = !dateFilter || appointment.date === dateFilter;
      const doctorMatches = doctorFilter === "all" || String(appointment.doctor_id) === String(doctorFilter);
      const searchMatches = !query || [
        appointment.id,
        appointment.patient_name,
        appointment.patient_phone,
        appointment.doctor_name,
        appointment.specialty_name,
        appointment.chief_complaint,
        appointment.notes,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      return statusMatches && dateMatches && doctorMatches && searchMatches;
    });
  }, [appointments, dateFilter, doctorFilter, search, statusFilter]);

  const saveAppointment = async (payload) => {
    setSaving(true);
    try {
      const isReschedule = modal?.appointment;
      const response = await parseApi(await authFetch(
        isReschedule ? `/appointments/${modal.appointment.id}/reschedule` : "/appointments",
        {
          method: isReschedule ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }
      ));
      const saved = response.data || response.appointment;
      setAppointments((prev) => {
        const index = prev.findIndex((appt) => appt.id === saved.id);
        if (index < 0) return [saved, ...prev];
        const next = [...prev];
        next[index] = saved;
        return next;
      });
      setModal(null);
      showAlert("ok", isReschedule ? "Appointment rescheduled successfully" : "Appointment created successfully");
    } catch (error) {
      console.error("Appointment save error:", error);
      showAlert("err", error.message || "Failed to save appointment");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (appointment, nextStatus, cancel_reason = null) => {
    if (nextStatus === "CANCELLED" && cancel_reason == null) {
      setCancelTarget(appointment);
      return;
    }

    try {
      const response = await parseApi(await authFetch(`/appointments/${appointment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, cancel_reason }),
      }));
      const saved = response.data || response.appointment;
      setAppointments((prev) => prev.map((appt) => (appt.id === saved.id ? saved : appt)));
      showAlert("ok", response.message || `Appointment updated to ${STATUS_META[saved.status]?.label || saved.status}`);
    } catch (error) {
      console.error("Appointment status error:", error);
      showAlert("err", error.message || "Failed to update appointment");
    }
  };


  return (
    <MainLayout pageTitle="Appointments" pageSubtitle="Manage clinic appointment schedules">
      {alert && (
        <div style={{
          position: "fixed",
          top: 22,
          right: 22,
          zIndex: 700,
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
          <h1 style={{ margin: "4px 0 4px", color: C.navy, fontSize: 24, lineHeight: 1.2 }}>Appointment Management</h1>
          <div style={{ color: C.text, fontSize: 13 }}>Book, approve, reschedule, cancel, and mark no-shows. Same-day approvals enter the live queue.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ExportMenu
            filename="qelcare-appointments"
            title="QELCare Appointments"
            subtitle={`${visibleAppointments.length} appointment${visibleAppointments.length === 1 ? "" : "s"} matching the current filters`}
            sheetTitle="Appointments"
            columns={EXPORT_COLUMNS}
            rows={visibleAppointments}
            disabled={loading}
          />
          <Button onClick={loadAppointments} disabled={loading}>Refresh</Button>
          <Button variant="primary" onClick={() => setModal({ mode: "create", appointment: null })}>Add Appointment</Button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard label="Total" value={loading ? "-" : stats.total} sub="Loaded appointments" color={C.blue} active={statusFilter === "all" && !dateFilter} onClick={() => { setStatusFilter("all"); setDateFilter(""); }} />
        <StatCard label="Today" value={loading ? "-" : stats.today} sub="Scheduled today" color={C.teal} active={dateFilter === todayInput()} onClick={() => setDateFilter(todayInput())} />
        <StatCard label="Pending" value={loading ? "-" : stats.pending} sub="Needs confirmation" color={C.purple} active={statusFilter === "PENDING"} onClick={() => setStatusFilter("PENDING")} />
        <StatCard label="Confirmed" value={loading ? "-" : stats.confirmed} sub="Ready for clinic" color={C.blue} active={statusFilter === "CONFIRMED"} onClick={() => setStatusFilter("CONFIRMED")} />
        <StatCard label="In Queue" value={loading ? "-" : stats.inQueue} sub="Being processed" color={C.amber} active={statusFilter === "IN_QUEUE"} onClick={() => setStatusFilter("IN_QUEUE")} />
        <StatCard label="Done" value={loading ? "-" : stats.completed} sub="Completed visits" color={C.teal} active={statusFilter === "COMPLETED"} onClick={() => setStatusFilter("COMPLETED")} />
        <StatCard label="Cancelled/No Show" value={loading ? "-" : stats.cancelled} sub="Lost visits" color={C.red} active={statusFilter === "CANCELLED"} onClick={() => setStatusFilter("CANCELLED")} />
      </section>

      <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.border}`, background: "linear-gradient(to right,#f8fafd,#fff)", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1.5fr) repeat(4,minmax(145px,1fr))", gap: 10, alignItems: "center" }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, doctor, phone, ref..." style={inputStyle} />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_META[status]?.label || status}</option>)}
            </select>
            <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} style={inputStyle} />
            <select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} style={inputStyle}>
              <option value="all">All Doctors</option>
              {doctors.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
            </select>
            <Button onClick={() => { setSearch(""); setStatusFilter("all"); setDateFilter(""); setDoctorFilter("all"); }}>Clear Filters</Button>
          </div>
          <div style={{ color: C.text, fontSize: 12, fontWeight: 800 }}>
            Showing {visibleAppointments.length} of {appointments.length} loaded appointment{appointments.length === 1 ? "" : "s"}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr style={{ background: C.soft }}>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Patient</th>
                <th style={thStyle}>Doctor</th>
                <th style={thStyle}>Date/Time</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Reason</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>Loading appointments...</td></tr>
              ) : visibleAppointments.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 42, textAlign: "center" }}>
                    <div style={{ color: C.navy, fontSize: 16, fontWeight: 900 }}>No appointments found</div>
                    <div style={{ color: C.text, fontSize: 13, marginTop: 5 }}>Create the first appointment when patient records and doctors are ready.</div>
                  </td>
                </tr>
              ) : (
                visibleAppointments.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    onStatus={updateStatus}
                    onReschedule={(selected) => setModal({ mode: "reschedule", appointment: selected })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <AppointmentModal
          mode={modal.mode}
          appointment={modal.appointment}
          patients={patients}
          doctors={doctors}
          specialties={specialties}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={saveAppointment}
        />
      )}

      {cancelTarget && (
        <ReasonModal
          title="Cancel Appointment"
          subtitle={`APT-${String(cancelTarget.id).padStart(5, "0")}${cancelTarget.patient_name ? ` · ${cancelTarget.patient_name}` : ""}`}
          label="Cancellation reason"
          placeholder="Why is this appointment being cancelled?"
          confirmText="Confirm Cancellation"
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => {
            const target = cancelTarget;
            setCancelTarget(null);
            updateStatus(target, "CANCELLED", reason);
          }}
        />
      )}
    </MainLayout>
  );
}
