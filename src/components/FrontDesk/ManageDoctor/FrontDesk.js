import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../../utils/auth";
import MainLayout from "../../Layout/MainLayout";
import AppointmentList from "../../UserSide/AppointmentList";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  StatusBadge,
  formatDate,
  formatTime,
  getRows,
  todayISO,
} from "../../Workflow/ClinicUi";
import ReasonModal from "../../common/ReasonModal";

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_QUEUE", "FOR_BILLING", "RESCHEDULED"];

export default function FrontDesk() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await authFetch("/appointments?limit=100");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to load frontdesk data.");
      setAppointments(getRows(payload, "appointments"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayISO();

  const stats = useMemo(() => {
    const todayRows = appointments.filter((item) => String(item.date || "").slice(0, 10) === today);
    return {
      totalActive: appointments.filter((item) => ACTIVE_STATUSES.includes(item.status)).length,
      today: todayRows.length,
      pending: appointments.filter((item) => item.status === "PENDING").length,
      todayQueue: todayRows.filter((item) => item.status === "IN_QUEUE").length,
      confirmedFuture: appointments.filter((item) => item.status === "CONFIRMED" && String(item.date || "").slice(0, 10) > today).length,
    };
  }, [appointments, today]);

  const needsApproval = useMemo(() => {
    return appointments
      .filter((item) => ["PENDING", "RESCHEDULED"].includes(item.status))
      .filter((item) => String(item.date || "").slice(0, 10) >= today)
      .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`))
      .slice(0, 15);
  }, [appointments, today]);

  const readyToCheckIn = useMemo(() => {
    return appointments
      .filter((item) => item.status === "CONFIRMED" && String(item.date || "").slice(0, 10) === today)
      .sort((a, b) => `${a.time || ""}`.localeCompare(`${b.time || ""}`))
      .slice(0, 15);
  }, [appointments, today]);

  async function updateStatus(appointment, nextStatus, cancelReason = "") {
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

      setMessage(payload.message || `Appointment #${appointment.id} updated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  const renderWorklist = (title, subtitle, rows, emptyTitle) => (
    <Panel style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6" }}>
        <div style={{ fontWeight: 900, color: "#162235" }}>{title}</div>
        <div style={{ color: "#6b778c", fontSize: 12 }}>{subtitle}</div>
      </div>
      {loading ? (
        <LoadingState label="Loading appointments..." />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} detail="" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f7fafd", color: "#65758b" }}>
                {["Schedule", "Patient", "Doctor", "Specialty", "Status", "Action"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "11px 14px", fontSize: 11, textTransform: "uppercase" }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const isToday = String(item.date || "").slice(0, 10) === today;
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #eef3f9" }}>
                    <td data-label="Schedule" style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 900, color: "#162235" }}>{formatDate(item.date)}</div>
                      <div style={{ color: "#6b778c", fontSize: 12 }}>{formatTime(item.time)}</div>
                    </td>
                    <td data-label="Patient" style={{ padding: "12px 14px" }}>
                      <strong style={{ color: "#162235" }}>{item.patient_name}</strong>
                      <div style={{ color: "#6b778c", fontSize: 12 }}>{item.patient_phone || item.patient_email || ""}</div>
                    </td>
                    <td data-label="Doctor" style={{ padding: "12px 14px" }}>{item.doctor_name || "-"}</td>
                    <td data-label="Specialty" style={{ padding: "12px 14px" }}>{item.specialty_name || "-"}</td>
                    <td data-label="Status" style={{ padding: "12px 14px" }}><StatusBadge status={item.status} /></td>
                    <td data-label="Action" className="qc-td-block" style={{ padding: "12px 14px" }}>
                      <div className="qc-actions" style={{ display: "flex", gap: 6 }}>
                        {["PENDING", "RESCHEDULED"].includes(item.status) && (
                          <ActionButton disabled={savingId === item.id} tone="success" onClick={() => updateStatus(item, "CONFIRMED")}>
                            {isToday ? "Approve and Queue" : "Approve"}
                          </ActionButton>
                        )}
                        {item.status === "CONFIRMED" && isToday && (
                          <ActionButton disabled={savingId === item.id} onClick={() => updateStatus(item, "IN_QUEUE")}>Check In</ActionButton>
                        )}
                        {["PENDING", "CONFIRMED", "RESCHEDULED"].includes(item.status) && (
                          <ActionButton disabled={savingId === item.id} tone="danger" onClick={() => setCancelTarget(item)}>Cancel</ActionButton>
                        )}
                        {item.status === "CONFIRMED" && isToday && (
                          <ActionButton disabled={savingId === item.id} tone="warning" onClick={() => updateStatus(item, "NO_SHOW")}>No Show</ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  return (
    <MainLayout pageTitle="Frontdesk Dashboard" pageSubtitle="Approve appointments, check in today's confirmed patients, and manage cancellations or no-shows">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />
        {message && (
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>
            {message}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
          <Metric label="Active Workload" value={stats.totalActive} onClick={() => navigate("/frontdesk/appointments")} />
          <Metric label="Today" value={stats.today} onClick={() => navigate("/frontdesk/appointments")} />
          <Metric label="Pending Approval" value={stats.pending} onClick={() => navigate("/frontdesk/appointments")} />
          <Metric label="Today Queue" value={stats.todayQueue} onClick={() => navigate("/frontdesk/appointments")} />
          <Metric label="Future Confirmed" value={stats.confirmedFuture} onClick={() => navigate("/frontdesk/appointments")} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
          <ActionButton onClick={() => navigate("/frontdesk/appointments")}>All Appointments</ActionButton>
        </div>

        {renderWorklist(
          "Needs Approval",
          "New bookings waiting for you to confirm. Approving a same-day booking also sends it to the queue.",
          needsApproval,
          "No bookings waiting for approval"
        )}

        {renderWorklist(
          "Ready to Check In",
          "Confirmed patients scheduled today - check them in to send them to the nurse queue.",
          readyToCheckIn,
          "No one to check in right now"
        )}

        <AppointmentList />
      </div>

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
            updateStatus(target, "CANCELLED", reason);
          }}
        />
      )}
    </MainLayout>
  );
}

function Metric({ label, value, onClick }) {
  const inner = (
    <Panel style={{ padding: 16 }}>
      <div style={{ color: "#6b778c", fontSize: 12, fontWeight: 900 }}>{label}</div>
      <div style={{ color: "#162235", fontSize: 28, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </Panel>
  );
  if (typeof onClick !== "function") return inner;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value}. Open appointments.`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(22,58,107,.14)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
      onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 3px rgba(22,58,107,.18)"; }}
      onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; }}
      style={{ cursor: "pointer", borderRadius: 8, outline: "none", transition: "transform .18s, box-shadow .18s" }}
    >
      {inner}
    </div>
  );
}
