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
import Modal from "../common/Modal";
import ReasonModal from "../common/ReasonModal";

const APPOINTMENT_MANAGER_ROLES = ["Admin", "Frontdesk"];
const STATUS_FILTERS = ["ALL", "PENDING", "CONFIRMED", "IN_QUEUE", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"];
const ACTIVE_STATUSES = ["IN_QUEUE", "CONFIRMED", "PENDING", "RESCHEDULED"];
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
const STATUS_ORDER = {
  IN_QUEUE: 0,
  CONFIRMED: 1,
  PENDING: 2,
  RESCHEDULED: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  NO_SHOW: 6,
};

function manilaNowKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function scheduleKey(item) {
  const date = String(item.date || "").slice(0, 10);
  const time = String(item.time || "00:00").slice(0, 5);
  return `${date}T${time}`;
}

function isHistory(item) {
  if (item.is_history === true) return true;
  if (TERMINAL_STATUSES.includes(item.status)) return true;
  return ACTIVE_STATUSES.includes(item.status) && scheduleKey(item) <= manilaNowKey();
}

function compareAppointments(a, b) {
  const aHistory = isHistory(a);
  const bHistory = isHistory(b);
  if (aHistory !== bHistory) return aHistory ? 1 : -1;

  const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
  if (statusDiff !== 0) return statusDiff;

  const aSchedule = scheduleKey(a);
  const bSchedule = scheduleKey(b);
  if (!aHistory && !bHistory && aSchedule !== bSchedule) return aSchedule.localeCompare(bSchedule);
  if (aHistory && bHistory && aSchedule !== bSchedule) return bSchedule.localeCompare(aSchedule);

  return Number(b.id || 0) - Number(a.id || 0);
}

function appointmentDate(item) {
  return String(item.date || "").slice(0, 10);
}

function isToday(item) {
  const date = appointmentDate(item);
  return Boolean(date && date === todayISO());
}

function isPastDateTime(date, time) {
  if (!date || !time) return false;
  return `${date}T${String(time).slice(0, 5)}` <= manilaNowKey();
}

function minTimeFor(date) {
  return date === todayISO() ? manilaNowKey().slice(11, 16) : undefined;
}

function workflowHelp(status, isPatient, history) {
  if (history) return "History record. No workflow actions are available.";

  const patientCopy = {
    PENDING: "Waiting for clinic confirmation.",
    CONFIRMED: "Confirmed. Please arrive on time for queue processing.",
    IN_QUEUE: "You are in the live clinic queue.",
    COMPLETED: "Consultation completed. Records and prescriptions appear after doctor entry.",
    CANCELLED: "This appointment was cancelled.",
    RESCHEDULED: "Schedule was changed and is awaiting clinic confirmation.",
    NO_SHOW: "Marked as no-show by the clinic.",
  };

  const staffCopy = {
    PENDING: "Confirm, reschedule, or cancel.",
    CONFIRMED: "Approved. Same-day visits enter queue automatically.",
    IN_QUEUE: "Nurse and doctor workflow is active.",
    COMPLETED: "Completed appointment history.",
    CANCELLED: "Cancelled appointment history.",
    RESCHEDULED: "Confirm the new schedule or cancel.",
    NO_SHOW: "No-show history.",
  };

  return (isPatient ? patientCopy : staffCopy)[status] || "No workflow note.";
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 38,
        padding: "0 13px",
        borderRadius: 8,
        border: `1px solid ${active ? "#163a6b" : "#d7e2ef"}`,
        background: active ? "#163a6b" : "#fff",
        color: active ? "#fff" : "#163a6b",
        cursor: "pointer",
        fontWeight: 900,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export default function AppointmentList() {
  const role = getUserRole();
  const isPatient = role === "Patient";
  const canManage = APPOINTMENT_MANAGER_ROLES.includes(role);

  const [appointments, setAppointments] = useState([]);
  const [view, setView] = useState("active");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reschedule, setReschedule] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const endpoint = isPatient ? "/appointments/me?limit=100" : "/appointments?limit=100";
      const response = await authFetch(endpoint);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to load appointments.");
      setAppointments(getRows(payload, "appointments"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isPatient]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments
      .filter((item) => (view === "history" ? isHistory(item) : !isHistory(item)))
      .filter((item) => status === "ALL" || item.status === status)
      .filter((item) => !date || String(item.date || "").slice(0, 10) === date)
      .filter((item) => {
        if (!q) return true;
        return [
          item.patient_name,
          item.doctor_name,
          item.specialty_name,
          item.chief_complaint,
          item.booked_by_name,
          String(item.id || ""),
        ].some((value) => String(value || "").toLowerCase().includes(q));
      })
      .sort(compareAppointments);
  }, [appointments, date, search, status, view]);

  async function changeStatus(appointment, nextStatus, cancelReason = "") {
    if (isHistory(appointment)) {
      setError("History appointments cannot be changed.");
      return;
    }

    setSavingId(appointment.id);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`/appointments/${appointment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, cancel_reason: cancelReason }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to update appointment.");
      setMessage(payload.message || `Appointment #${appointment.id} changed to ${nextStatus}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!reschedule?.date || !reschedule?.time) return;
    if (isPastDateTime(reschedule.date, reschedule.time)) {
      setError("Choose a future date and time using Asia/Manila time.");
      return;
    }
    setSavingId(reschedule.id);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`/appointments/${reschedule.id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ date: reschedule.date, time: reschedule.time }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to reschedule appointment.");
      setMessage(`Appointment #${reschedule.id} rescheduled and returned to pending.`);
      setReschedule(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel style={{ padding: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#42526a", fontSize: 13, lineHeight: 1.45 }}>
            {isPatient
              ? "Bookings are clinic-controlled after submission. Past, completed, cancelled, and no-show appointments move to history without actions."
              : "Active appointments can be managed by Admin and Frontdesk. Past or finished appointments are read-only history for all roles."}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TabButton active={view === "active"} onClick={() => setView("active")}>Active</TabButton>
            <TabButton active={view === "history"} onClick={() => setView("history")}>History</TabButton>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 150px 150px auto", gap: 10, alignItems: "end" }}>
            <Field label="Search">
              <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, doctor, specialty, appointment #" />
            </Field>
            <Field label="Status">
              <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTERS.map((item) => (
                  <option key={item} value={item}>{item === "ALL" ? "All statuses" : item.replace("_", " ")}</option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
          </div>
        </div>
      </Panel>

      <ErrorState message={error} />
      {message && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{message}</div>}

      {reschedule && (
        <Modal
          title="Reschedule Appointment"
          subtitle={`#${reschedule.id}${reschedule.patient_name ? ` · ${reschedule.patient_name}` : ""}`}
          onClose={() => (savingId === reschedule.id ? null : setReschedule(null))}
        >
          <form onSubmit={submitReschedule} style={{ display: "grid", gap: 14 }}>
            <ErrorState message={error} />
            <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fff4de", color: "#9a6500", fontSize: 12.5, fontWeight: 800 }}>
              Rescheduling returns the appointment to Pending so staff can reconfirm the new time.
            </div>
            <Field label="New date">
              <input style={inputStyle} type="date" min={todayISO()} value={reschedule.date} onChange={(e) => setReschedule({ ...reschedule, date: e.target.value })} />
            </Field>
            <Field label="New time">
              <input style={inputStyle} type="time" min={minTimeFor(reschedule.date)} value={reschedule.time} onChange={(e) => setReschedule({ ...reschedule, time: e.target.value })} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <ActionButton type="button" tone="secondary" disabled={savingId === reschedule.id} onClick={() => setReschedule(null)}>Cancel</ActionButton>
              <ActionButton type="submit" disabled={savingId === reschedule.id}>{savingId === reschedule.id ? "Saving..." : "Save"}</ActionButton>
            </div>
          </form>
        </Modal>
      )}

      {cancelTarget && (
        <ReasonModal
          title="Cancel Appointment"
          subtitle={`#${cancelTarget.id}${cancelTarget.patient_name ? ` · ${cancelTarget.patient_name}` : ""}`}
          label="Cancellation reason"
          placeholder="Why is this appointment being cancelled?"
          confirmText="Confirm Cancellation"
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => {
            const target = cancelTarget;
            setCancelTarget(null);
            changeStatus(target, "CANCELLED", reason);
          }}
        />
      )}

      <Panel style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>{view === "history" ? "Appointment History" : "Active Appointments"}</div>
            <div style={{ fontSize: 12, color: "#6b778c", marginTop: 2 }}>
              {filtered.length} record(s) - {view === "history" ? "read-only past and finished appointments" : "future/current active appointments"}
            </div>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading appointments..." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No appointments found" detail="Adjust filters or refresh the list." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f7fafd", color: "#65758b" }}>
                  {["ID", "Patient", "Doctor", "Specialty", "Schedule", "Status", isPatient ? "Next Step" : "Workflow"].map((heading) => (
                    <th key={heading} style={{ textAlign: "left", padding: "11px 14px", fontSize: 11, textTransform: "uppercase" }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const rowHistory = isHistory(item);
                  return (
                    <tr key={item.id} style={{ borderTop: "1px solid #eef3f9" }}>
                      <td style={{ padding: "12px 14px", color: "#6b778c", fontWeight: 800 }}>#{item.id}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 900, color: "#162235" }}>{item.patient_name || "-"}</div>
                        <div style={{ fontSize: 12, color: "#6b778c" }}>{item.patient_phone || item.patient_email || ""}</div>
                        {item.booked_for === "other" && <div style={{ fontSize: 11, color: "#6b778c", marginTop: 2 }}>Booked by {item.booked_by_name || "patient account"} for {item.booked_for_relationship || "relative"}</div>}
                      </td>
                      <td style={{ padding: "12px 14px", fontWeight: 700 }}>{item.doctor_name || "-"}</td>
                      <td style={{ padding: "12px 14px" }}>{item.specialty_name || "-"}</td>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(item.date)} at {formatTime(item.time)}</td>
                      <td style={{ padding: "12px 14px" }}><StatusBadge status={item.status} /></td>
                      <td style={{ padding: "12px 14px" }}>
                        {canManage && !rowHistory ? (
                          <div style={{ display: "grid", gap: 7 }}>
                            <div style={{ color: "#6b778c", fontSize: 12 }}>{workflowHelp(item.status, false, false)}</div>
                            <div className="qc-actions" style={{ display: "flex", gap: 6 }}>
                              {item.status === "PENDING" && <ActionButton disabled={savingId === item.id} tone="success" onClick={() => changeStatus(item, "CONFIRMED")}>Confirm</ActionButton>}
                              {["PENDING", "CONFIRMED", "RESCHEDULED"].includes(item.status) && <ActionButton disabled={savingId === item.id} tone="secondary" onClick={() => setReschedule({ id: item.id, patient_name: item.patient_name, date: item.date || todayISO(), time: item.time || "" })}>Reschedule</ActionButton>}
                              {["PENDING", "CONFIRMED", "RESCHEDULED"].includes(item.status) && <ActionButton disabled={savingId === item.id} tone="danger" onClick={() => setCancelTarget(item)}>Cancel</ActionButton>}
                              {["CONFIRMED", "IN_QUEUE"].includes(item.status) && isToday(item) && <ActionButton disabled={savingId === item.id} tone="warning" onClick={() => changeStatus(item, "NO_SHOW")}>No Show</ActionButton>}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "#42526a", fontSize: 12, lineHeight: 1.45 }}>{workflowHelp(item.status, isPatient, rowHistory)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
