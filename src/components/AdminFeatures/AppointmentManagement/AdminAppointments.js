import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
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

const PAGE_SIZE = 10;
// Lost visits: one filter value so the "Cancelled/No Show" card and the list agree.
const LOST_FILTER = "CANCELLED,NO_SHOW";

const STATUS_OPTIONS = ["PENDING", "CONFIRMED", "IN_QUEUE", "FOR_BILLING", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];
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
  FOR_BILLING: { label: "For Billing", color: "#0b7285", bg: "#e6f6f8" },
  COMPLETED: { label: "Completed", color: C.teal, bg: "#eaf8f4" },
  CANCELLED: { label: "Cancelled", color: C.red, bg: "#fff2f4" },
  RESCHEDULED: { label: "Rescheduled", color: C.amber, bg: "#fff4de" },
  NO_SHOW: { label: "No Show", color: "#666", bg: "#f1f1f1" },
};

// Mirrors the server's rules (the server enforces them). No Show is only
// offered once the scheduled time has passed ("settle"); an In Queue patient is
// no-showed from the Queue screen; For Billing waits for the cashier.
const TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_QUEUE", "CANCELLED"],
  IN_QUEUE: ["CANCELLED"],
  RESCHEDULED: ["CONFIRMED", "CANCELLED"],
  FOR_BILLING: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// Clinic hours enforced by the server for every booking and reschedule.
const CLINIC_OPEN = "08:00";
const CLINIC_CLOSE = "20:00";

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

function buildQuery({ status, date, doctor, search }, page, limit) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status !== "all") query.set("status", status);
  if (date) query.set("date", date);
  if (doctor !== "all") query.set("doctor_id", doctor);
  if (search) query.set("search", search);
  return query.toString();
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

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "grid", gap: 7, color: C.navy, fontSize: 13, fontWeight: 800 }}>
      {label}
      {children}
      {hint && <span style={{ color: C.muted, fontSize: 11.5, fontWeight: 700 }}>{hint}</span>}
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

function AppointmentModal({ appointment, patients, doctors, specialties, saving, onClose, onSave }) {
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

  // A doctor belongs to exactly one specialty: choosing a specialty narrows the
  // doctor list, and choosing a doctor sets the specialty to theirs.
  const doctorOptions = useMemo(
    () => (form.specialty_id ? doctors.filter((d) => String(d.specialty_id) === String(form.specialty_id)) : doctors),
    [doctors, form.specialty_id]
  );

  const set = (event) => {
    const { name, value } = event.target;
    setError("");
    setForm((prev) => {
      if (name === "doctor_id") {
        const doctor = doctors.find((d) => String(d.user_id) === String(value));
        return { ...prev, doctor_id: value, specialty_id: doctor ? doctor.specialty_id : prev.specialty_id };
      }
      if (name === "specialty_id") {
        const doctor = doctors.find((d) => String(d.user_id) === String(prev.doctor_id));
        const keepDoctor = doctor && String(doctor.specialty_id) === String(value);
        return { ...prev, specialty_id: value, doctor_id: keepDoctor ? prev.doctor_id : "" };
      }
      return { ...prev, [name]: value };
    });
  };

  const submit = (event) => {
    event.preventDefault();
    setError("");
    if (!form.patient_id || !form.doctor_id || !form.date || !form.time) {
      setError("Patient, doctor, date, and time are required.");
      return;
    }
    if (form.date < todayInput()) {
      setError("Choose today or a future date.");
      return;
    }
    if (form.time < CLINIC_OPEN || form.time > CLINIC_CLOSE) {
      setError("Clinic hours are 8:00 AM to 8:00 PM. Please choose a time within clinic hours.");
      return;
    }
    onSave(isEdit
      ? { date: form.date, time: form.time }
      : {
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
            <div style={{ fontSize: 18, fontWeight: 900 }}>{isEdit ? "Reschedule Appointment" : "Add Appointment"}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{isEdit ? `Appointment #${appointment.id}` : "Book an existing patient with a clinic doctor"}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, border: "none", borderRadius: 8, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 24, background: "#fafbfd", maxHeight: "calc(90vh - 74px)", overflowY: "auto", display: "grid", gap: 16 }}>
          {error && <div role="alert" style={{ padding: "12px 14px", borderRadius: 10, background: "#fff2f4", color: C.red, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 800 }}>{error}</div>}

          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
            <Field label="Patient *">
              <select name="patient_id" value={form.patient_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">Select patient</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientName(patient)} / #{patient.id}</option>)}
              </select>
            </Field>
            <Field label="Specialty">
              <select name="specialty_id" value={form.specialty_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">All specialties</option>
                {specialties.map((spec) => <option key={spec.specialty_id} value={spec.specialty_id}>{spec.specialty_name}</option>)}
              </select>
            </Field>
            <Field label="Doctor *" hint={!isEdit ? "The appointment uses the doctor's specialty." : undefined}>
              <select name="doctor_id" value={form.doctor_id} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                <option value="">{doctorOptions.length ? "Select doctor" : "No doctors in this specialty"}</option>
                {doctorOptions.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
              </select>
            </Field>
            <Field label="Visit Type">
              <select name="type" value={form.type} onChange={set} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.75 : 1 }}>
                {TYPE_OPTIONS.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </Field>
            <Field label="Date *"><input type="date" min={todayInput()} name="date" value={form.date} onChange={set} style={inputStyle} /></Field>
            <Field label="Time *" hint="Clinic hours: 8:00 AM to 8:00 PM"><input type="time" min={CLINIC_OPEN} max={CLINIC_CLOSE} name="time" value={form.time} onChange={set} style={inputStyle} /></Field>
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
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Appointment"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AppointmentRow({ appointment, busy, onStatus, onReschedule }) {
  const actions = TRANSITIONS[appointment.status] || [];
  const isToday = appointment.date === todayInput();
  // Prefer the backend-computed flag; fall back to a local date check.
  const isPast =
    appointment.is_past === true ||
    (appointment.date && appointment.date < todayInput());
  // A past pre-visit appointment that was never resolved needs settling.
  const needsSettle = isPast && ["PENDING", "CONFIRMED", "RESCHEDULED"].includes(appointment.status);
  const terminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);

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
              <Button disabled={busy} onClick={() => onStatus(appointment, "NO_SHOW")}>No Show</Button>
              <Button variant="danger" disabled={busy} onClick={() => onStatus(appointment, "CANCELLED")}>Cancel</Button>
            </>
          ) : (
            <>
              {!isPast && actions.includes("CONFIRMED") && <Button disabled={busy} onClick={() => onStatus(appointment, "CONFIRMED")}>{isToday ? "Approve and Queue" : "Approve"}</Button>}
              {!isPast && actions.includes("IN_QUEUE") && isToday && <Button disabled={busy} onClick={() => onStatus(appointment, "IN_QUEUE")}>Check In</Button>}
              {!isPast && ["PENDING", "CONFIRMED", "RESCHEDULED"].includes(appointment.status) && <Button disabled={busy} onClick={() => onReschedule(appointment)}>Reschedule</Button>}
              {!isPast && actions.includes("CANCELLED") && <Button variant="danger" disabled={busy} onClick={() => onStatus(appointment, "CANCELLED")}>Cancel</Button>}
              {!isPast && appointment.status === "CONFIRMED" && !isToday && <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>Waiting date</span>}
              {appointment.status === "IN_QUEUE" && isPast && <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>In consultation workflow</span>}
              {appointment.status === "FOR_BILLING" && <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>Awaiting payment</span>}
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
const APPT_STATUS_VALUES = [...STATUS_OPTIONS, LOST_FILTER];

export default function AdminAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState(null);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [alert, setAlert] = useState(null);
  const alertTimer = useRef(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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

  const filters = useMemo(
    () => ({ status: statusFilter, date: dateFilter, doctor: doctorFilter, search: debouncedSearch }),
    [statusFilter, dateFilter, doctorFilter, debouncedSearch]
  );
  const hasFilters = statusFilter !== "all" || !!dateFilter || doctorFilter !== "all" || !!debouncedSearch;

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.clearTimeout(alertTimer.current);
    alertTimer.current = window.setTimeout(() => setAlert(null), 4200);
  }, []);
  useEffect(() => () => window.clearTimeout(alertTimer.current), []);

  // Every filter change starts again from page 1 (batched with the change).
  const changeFilter = (setter) => (value) => { setter(value); setPage(1); };

  // Search runs on the server, 300 ms after typing stops.
  useEffect(() => {
    const next = search.trim();
    if (next === debouncedSearch) return undefined;
    const id = window.setTimeout(() => { setDebouncedSearch(next); setPage(1); }, 300);
    return () => window.clearTimeout(id);
  }, [search, debouncedSearch]);

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
    setDoctors(userList.filter((user) => user.role === "Doctor" && user.status !== "deactivated" && user.specialty_id));
    setSpecialties(specList);
  }, []);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await parseApi(await authFetch(`/appointments?${buildQuery(filters, page, PAGE_SIZE)}`));
      const rows = Array.isArray(payload.data) ? payload.data : payload.appointments || [];
      const lastPage = Math.max(1, payload.pages || 1);
      if (rows.length === 0 && page > lastPage) {
        setPage(lastPage); // the page emptied (e.g. after an action); step back
        return;
      }
      setAppointments(rows);
      setTotal(payload.total || 0);
      setPages(lastPage);
      setLoadError("");
    } catch (error) {
      console.error("Appointment load error:", error);
      setLoadError(error.message || "Failed to load appointments.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const loadStats = useCallback(async () => {
    try {
      const payload = await parseApi(await authFetch("/appointments/stats"));
      setStats(payload.data || null);
    } catch (error) {
      console.error("Appointment stats error:", error);
      setStats(null);
    }
  }, []);

  const refreshAll = useCallback(() => Promise.all([loadAppointments(), loadStats()]), [loadAppointments, loadStats]);

  useEffect(() => {
    loadLookups().catch((error) => {
      console.error("Appointment lookup load error:", error);
      showAlert("err", error.message || "Failed to load appointment lookups");
    });
  }, [loadLookups, showAlert]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // Every matching row (all pages) for the export menu.
  const loadAllRows = useCallback(async () => {
    const all = [];
    for (let p = 1; p <= 1000; p += 1) {
      const payload = await parseApi(await authFetch(`/appointments?${buildQuery(filters, p, 100)}`));
      all.push(...(payload.data || []));
      if (p >= (payload.pages || 1)) break;
    }
    return all;
  }, [filters]);

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
      setModal(null);
      showAlert("ok", isReschedule
        ? "Appointment rescheduled successfully"
        : `Appointment created successfully (APT-${String(saved?.id || "").padStart(5, "0")})`);
      await refreshAll();
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
    if (busyId) return;

    setBusyId(appointment.id);
    try {
      const response = await parseApi(await authFetch(`/appointments/${appointment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, cancel_reason }),
      }));
      const saved = response.data || response.appointment;
      showAlert("ok", response.message || `Appointment updated to ${STATUS_META[saved.status]?.label || saved.status}`);
    } catch (error) {
      console.error("Appointment status error:", error);
      showAlert("err", error.message || "Failed to update appointment");
    } finally {
      // Reload from the server either way: a confirm may have declined other
      // rows, and a rejected action means this row's state was stale.
      await refreshAll();
      setBusyId(null);
    }
  };

  const statValue = (value) => (stats ? value : "-");
  const byStatus = stats?.by_status || {};
  const today = todayInput();
  const todayOnlyFilter = dateFilter === today && statusFilter === "all" && doctorFilter === "all" && !debouncedSearch;

  return (
    <MainLayout>
      {alert && (
        <div role={alert.type === "ok" ? "status" : "alert"} style={{
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
          maxWidth: "min(420px, calc(100vw - 44px))",
        }}>
          {alert.message}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: C.text, fontSize: 13 }}>Book, approve, reschedule, cancel, and settle past appointments. Same-day approvals enter the live queue.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ExportMenu
            filename="qelcare-appointments"
            title="QELCare Appointments"
            subtitle={`${total} appointment${total === 1 ? "" : "s"} matching the current filters`}
            sheetTitle="Appointments"
            columns={EXPORT_COLUMNS}
            rows={appointments}
            rowCount={total}
            loadRows={loadAllRows}
            disabled={loading || !!loadError}
          />
          <Button onClick={refreshAll} disabled={loading}>Refresh</Button>
          <Button variant="primary" onClick={() => setModal({ appointment: null })}>Add Appointment</Button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard label="Total" value={statValue(stats?.total)} sub={stats ? "All appointments" : "Not loaded"} color={C.blue} active={statusFilter === "all" && !dateFilter} onClick={() => { setStatusFilter("all"); setDateFilter(""); setPage(1); }} />
        <StatCard label="Today" value={statValue(stats?.today?.active)} sub={stats ? `${stats.today.total} scheduled incl. cancelled/no-show` : "Not loaded"} color={C.teal} active={dateFilter === today} onClick={() => changeFilter(setDateFilter)(today)} />
        <StatCard label="Pending" value={statValue(byStatus.PENDING)} sub="Needs confirmation" color={C.purple} active={statusFilter === "PENDING"} onClick={() => changeFilter(setStatusFilter)("PENDING")} />
        <StatCard label="Confirmed" value={statValue(byStatus.CONFIRMED)} sub="Ready for clinic" color={C.blue} active={statusFilter === "CONFIRMED"} onClick={() => changeFilter(setStatusFilter)("CONFIRMED")} />
        <StatCard label="In Queue" value={statValue(byStatus.IN_QUEUE)} sub="Being processed" color={C.amber} active={statusFilter === "IN_QUEUE"} onClick={() => changeFilter(setStatusFilter)("IN_QUEUE")} />
        <StatCard label="For Billing" value={statValue(byStatus.FOR_BILLING)} sub="Awaiting payment" color={STATUS_META.FOR_BILLING.color} active={statusFilter === "FOR_BILLING"} onClick={() => changeFilter(setStatusFilter)("FOR_BILLING")} />
        <StatCard label="Done" value={statValue(byStatus.COMPLETED)} sub="Completed visits" color={C.teal} active={statusFilter === "COMPLETED"} onClick={() => changeFilter(setStatusFilter)("COMPLETED")} />
        <StatCard label="Cancelled/No Show" value={statValue(stats?.lost)} sub="Lost visits" color={C.red} active={statusFilter === LOST_FILTER} onClick={() => changeFilter(setStatusFilter)(LOST_FILTER)} />
      </section>

      {loadError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", marginBottom: 14, borderRadius: 12, background: "#fff2f4", color: C.red, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 800 }}>
          <span>Couldn't load appointments: {loadError}</span>
          <Button onClick={refreshAll}>Retry</Button>
        </div>
      )}

      <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.border}`, background: "linear-gradient(to right,#f8fafd,#fff)", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1.5fr) repeat(4,minmax(145px,1fr))", gap: 10, alignItems: "center" }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, doctor, phone, ref (APT-00012)..." style={inputStyle} aria-label="Search appointments" />
            <select value={statusFilter} onChange={(event) => changeFilter(setStatusFilter)(event.target.value)} style={inputStyle} aria-label="Status filter">
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_META[status]?.label || status}</option>)}
              <option value={LOST_FILTER}>Cancelled + No Show</option>
            </select>
            <input type="date" value={dateFilter} onChange={(event) => changeFilter(setDateFilter)(event.target.value)} style={inputStyle} aria-label="Date filter" />
            <select value={doctorFilter} onChange={(event) => changeFilter(setDoctorFilter)(event.target.value)} style={inputStyle} aria-label="Doctor filter">
              <option value="all">All Doctors</option>
              {doctors.map((doctor) => <option key={doctor.user_id} value={doctor.user_id}>{doctorName(doctor)}</option>)}
            </select>
            <Button onClick={() => { setSearch(""); setDebouncedSearch(""); setStatusFilter("all"); setDateFilter(""); setDoctorFilter("all"); setPage(1); }}>Clear Filters</Button>
          </div>
          <div style={{ color: C.text, fontSize: 12, fontWeight: 800 }}>
            {loadError ? "Appointments not loaded" : `${total} appointment${total === 1 ? "" : "s"} ${hasFilters ? (total === 1 ? "matches your filters" : "match your filters") : "in total"}`}
            {todayOnlyFilter && stats && !loadError ? ` · ${stats.today.active} excluding cancelled and no-show` : ""}
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
              {loading && appointments.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>Loading appointments...</td></tr>
              ) : loadError && appointments.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 36, textAlign: "center", color: C.red, fontWeight: 800 }}>Appointments could not be loaded. Use Retry above.</td></tr>
              ) : appointments.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 42, textAlign: "center" }}>
                    <div style={{ color: C.navy, fontSize: 16, fontWeight: 900 }}>{hasFilters ? "No appointments match your filters" : "No appointments yet"}</div>
                    <div style={{ color: C.text, fontSize: 13, marginTop: 5 }}>{hasFilters ? "Try another search or use Clear Filters." : "Use Add Appointment to book the first one."}</div>
                  </td>
                </tr>
              ) : (
                appointments.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    busy={busyId !== null}
                    onStatus={updateStatus}
                    onReschedule={(selected) => setModal({ appointment: selected })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loadError && (
          <Pagination
            page={page}
            totalPages={pages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            label="appointments"
          />
        )}
      </section>

      {modal && (
        <AppointmentModal
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
