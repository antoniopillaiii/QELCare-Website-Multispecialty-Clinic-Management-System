import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/auth";
import MainLayout from "../Layout/MainLayout";
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
} from "../Workflow/ClinicUi";
import ConfirmModal from "../common/ConfirmModal";

const ACTIVE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS", "SKIPPED"];

export default function QNurseStationVitals() {
  const navigate = useNavigate();
  const [specialties, setSpecialties] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const date = todayISO();
      const specialtyRes = await authFetch(`/queue/specialties?date=${date}`);
      const specialtyPayload = await specialtyRes.json();
      if (!specialtyRes.ok) throw new Error(specialtyPayload.message || "Failed to load nurse queues.");

      const specialtyRows = getRows(specialtyPayload, "specialties");
      setSpecialties(specialtyRows);

      const queuePayloads = await Promise.all(
        specialtyRows.map(async (specialty) => {
          const response = await authFetch(`/queue/specialty/${specialty.specialty_id}?date=${date}`);
          const payload = await response.json();
          return response.ok ? getRows(payload, "queue").map((entry) => ({ ...entry, specialty_slug: specialty.slug || entry.specialty_slug })) : [];
        })
      );

      setQueue(queuePayloads.flat());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeQueue = useMemo(() => {
    return queue
      .filter((entry) => ACTIVE_STATUSES.includes(entry.status))
      .sort((a, b) => {
        const rank = { IN_PROGRESS: 1, CALLED: 2, WAITING: 3, SKIPPED: 4 };
        const diff = (rank[a.status] || 9) - (rank[b.status] || 9);
        if (diff !== 0) return diff;
        return Number(a.queue_number || 0) - Number(b.queue_number || 0);
      });
  }, [queue]);

  const stats = useMemo(() => {
    return {
      active: activeQueue.length,
      waiting: activeQueue.filter((entry) => entry.status === "WAITING").length,
      called: activeQueue.filter((entry) => entry.status === "CALLED").length,
      inProgress: activeQueue.filter((entry) => entry.status === "IN_PROGRESS").length,
      skipped: activeQueue.filter((entry) => entry.status === "SKIPPED").length,
    };
  }, [activeQueue]);

  const callEmergency = () => {
    setConfirm({
      title: "Call Emergency Hotline",
      message: "Call the national emergency hotline (911)?\n\nUse this only for a real medical emergency.",
      confirmText: "Call 911",
      tone: "danger",
      onConfirm: () => { window.location.href = "tel:911"; },
    });
  };

  return (
    <MainLayout pageTitle="Nurse Vitals Workbench" pageSubtitle="Today's active queue and vitals entry shortcuts">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
          <Metric label="Active Queue" value={stats.active} />
          <Metric label="Waiting" value={stats.waiting} />
          <Metric label="Called" value={stats.called} />
          <Metric label="In Progress" value={stats.inProgress} />
          <Metric label="Skipped" value={stats.skipped} />
        </div>

        <Panel style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900, color: "#162235" }}>Today's Nurse Queue</div>
              <div style={{ color: "#6b778c", fontSize: 12 }}>
                Open the patient's specialty queue to call, skip, and record vitals.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ActionButton tone="danger" onClick={callEmergency}>Emergency 911</ActionButton>
              <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
            </div>
          </div>

          {loading ? (
            <LoadingState label="Loading nurse queue..." />
          ) : activeQueue.length === 0 ? (
            <EmptyState title="No active queue patients" detail="Same-day approved appointments will appear after frontdesk check-in." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f7fafd", color: "#65758b" }}>
                    {["Queue", "Patient", "Schedule", "Doctor", "Specialty", "Status", "Action"].map((heading) => (
                      <th key={heading} style={{ textAlign: "left", padding: "11px 14px", fontSize: 11, textTransform: "uppercase" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeQueue.map((entry) => (
                    <tr key={entry.queue_id} style={{ borderTop: "1px solid #eef3f9" }}>
                      <td data-label="Queue" style={{ padding: "12px 14px", color: "#163a6b", fontSize: 20, fontWeight: 900 }}>#{entry.queue_number}</td>
                      <td data-label="Patient" className="qc-td-block" style={{ padding: "12px 14px" }}>
                        <div style={{ color: "#162235", fontWeight: 900 }}>{entry.patient_name}</div>
                        <div style={{ color: "#6b778c", fontSize: 12 }}>{entry.chief_complaint || "No complaint entered"}</div>
                      </td>
                      <td data-label="Schedule" style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{formatDate(entry.appointment_date)} {formatTime(entry.appointment_time)}</td>
                      <td data-label="Doctor" style={{ padding: "12px 14px" }}>{entry.doctor_name || "-"}</td>
                      <td data-label="Specialty" style={{ padding: "12px 14px" }}>{entry.specialty_name || "-"}</td>
                      <td data-label="Status" style={{ padding: "12px 14px" }}><StatusBadge status={entry.status} /></td>
                      <td data-label="Action" className="qc-td-block" style={{ padding: "12px 14px" }}>
                        <ActionButton onClick={() => navigate(`/nurse/queue/${entry.specialty_slug}`)}>Open Vitals</ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel style={{ padding: 16 }}>
          <div style={{ fontWeight: 900, color: "#162235", marginBottom: 8 }}>Specialty Queues</div>
          {loading ? (
            <LoadingState />
          ) : specialties.length === 0 ? (
            <EmptyState title="No specialties found" detail="Admin must set active specialties." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {specialties.map((specialty) => (
                <button
                  key={specialty.specialty_id}
                  type="button"
                  onClick={() => navigate(`/nurse/queue/${specialty.slug}`)}
                  style={{
                    border: "1px solid #e3ebf5",
                    borderRadius: 8,
                    background: "#fff",
                    padding: 14,
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ color: "#162235", fontWeight: 900 }}>{specialty.specialty_name}</div>
                  <div style={{ color: "#6b778c", fontSize: 12, marginTop: 4 }}>
                    Waiting {specialty.waiting || 0} - In progress {specialty.in_progress || 0} - Skipped {specialty.skipped || 0}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          tone={confirm.tone}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const c = confirm; setConfirm(null); c.onConfirm(); }}
        />
      )}
    </MainLayout>
  );
}

function Metric({ label, value }) {
  return (
    <Panel style={{ padding: 16 }}>
      <div style={{ color: "#6b778c", fontSize: 12, fontWeight: 900 }}>{label}</div>
      <div style={{ color: "#162235", fontSize: 28, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </Panel>
  );
}
