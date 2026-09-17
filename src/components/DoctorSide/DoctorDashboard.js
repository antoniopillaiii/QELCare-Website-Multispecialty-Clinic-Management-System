import React, { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../utils/auth";
import MainLayout from "../Layout/MainLayout";
import MedicalRecords from "../UserSide/MedicalRecords";
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

const ACTIVE_DOCTOR_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];

function getCurrentUserId() {
  const stored = localStorage.getItem("user");
  if (stored) {
    try {
      const user = JSON.parse(stored);
      if (user?.user_id) return Number(user.user_id);
    } catch {
      // Ignore invalid localStorage user data.
    }
  }
  return Number(localStorage.getItem("userId") || 0);
}

function buildDoctorQueueRows(queueEntries, appointments, doctorId) {
  const appointmentById = new Map(appointments.map((item) => [Number(item.id), item]));

  return queueEntries
    .filter((entry) => Number(entry.doctor_id) === Number(doctorId))
    .filter((entry) => ACTIVE_DOCTOR_QUEUE_STATUSES.includes(entry.status))
    .map((entry) => {
      const appointment = appointmentById.get(Number(entry.appointment_id)) || {};
      return {
        ...appointment,
        id: entry.appointment_id,
        appointment_id: entry.appointment_id,
        patient_id: entry.patient_id,
        patient_name: entry.patient_name,
        patient_phone: entry.patient_phone,
        patient_email: entry.patient_email,
        patient_gender: entry.patient_gender,
        date_of_birth: entry.date_of_birth,
        date: entry.appointment_date || appointment.date,
        time: entry.appointment_time || appointment.time,
        type: entry.appointment_type || appointment.type,
        status: entry.appointment_status || appointment.status,
        chief_complaint: entry.chief_complaint || appointment.chief_complaint,
        notes: entry.appointment_notes || appointment.notes,
        doctor_id: entry.doctor_id,
        doctor_name: entry.doctor_name || appointment.doctor_name,
        specialty_id: entry.specialty_id || appointment.specialty_id,
        specialty_name: entry.specialty_name || appointment.specialty_name,
        specialty_slug: entry.specialty_slug || appointment.specialty_slug,
        queueEntry: entry,
      };
    })
    .sort((a, b) => {
      const statusRank = { IN_PROGRESS: 1, CALLED: 2, WAITING: 3 };
      const rankDiff = (statusRank[a.queueEntry.status] || 9) - (statusRank[b.queueEntry.status] || 9);
      if (rankDiff !== 0) return rankDiff;
      return Number(a.queueEntry.queue_number || 0) - Number(b.queueEntry.queue_number || 0);
    });
}

export default function DoctorDashboard() {
  const doctorId = getCurrentUserId();

  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [vitals, setVitals] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const today = todayISO();
      const [appointmentRes, specialtyRes] = await Promise.all([
        authFetch(`/appointments?date=${today}&limit=100`),
        authFetch(`/queue/specialties?date=${today}`),
      ]);

      const appointmentPayload = await appointmentRes.json();
      const specialtyPayload = await specialtyRes.json();

      if (!appointmentRes.ok) throw new Error(appointmentPayload.message || "Failed to load appointments.");
      if (!specialtyRes.ok) throw new Error(specialtyPayload.message || "Failed to load queue specialties.");

      const specialties = getRows(specialtyPayload, "specialties");
      const queuePayloads = await Promise.all(
        specialties.map(async (specialty) => {
          const response = await authFetch(`/queue/specialty/${specialty.specialty_id}?date=${today}`);
          const payload = await response.json();
          return response.ok ? getRows(payload, "queue") : [];
        })
      );

      const appointmentRows = getRows(appointmentPayload, "appointments");
      const queueRows = queuePayloads.flat();
      const assignedRows = buildDoctorQueueRows(queueRows, appointmentRows, doctorId);

      setPatients(assignedRows);
      setSelected((current) => {
        if (!current) return assignedRows[0] || null;
        return assignedRows.find((row) => Number(row.id) === Number(current.id)) || assignedRows[0] || null;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setVitals([]);
      setHistory([]);
      return;
    }

    async function loadDetails() {
      setDetailLoading(true);
      setError("");

      try {
        const [vitalRes, historyRes] = await Promise.all([
          authFetch(`/vitals/appointment/${selected.id}`),
          authFetch(`/medical-records/patient/${selected.patient_id}`),
        ]);

        const vitalPayload = await vitalRes.json();
        const historyPayload = await historyRes.json();

        if (!vitalRes.ok) throw new Error(vitalPayload.message || "Failed to load vitals.");
        if (!historyRes.ok) throw new Error(historyPayload.message || "Failed to load patient history.");

        setVitals(getRows(vitalPayload, "vitals"));
        setHistory(getRows(historyPayload, "records"));
      } catch (err) {
        setError(err.message);
      } finally {
        setDetailLoading(false);
      }
    }

    loadDetails();
  }, [selected]);

  const latestVital = vitals[0] || null;

  async function updateQueueStatus(status, successMessage) {
    if (!selected?.queueEntry?.queue_id) {
      setError("No active queue entry is linked to this patient.");
      return;
    }

    setActionLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await authFetch(`/queue/${selected.queueEntry.queue_id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          notes: status === "DONE" ? "Consultation completed by doctor." : "Consultation started by doctor.",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to update queue.");

      setMessage(successMessage);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  const selectedQueueStatus = selected?.queueEntry?.status || "";
  const canStart = selectedQueueStatus === "WAITING" || selectedQueueStatus === "CALLED";
  const canComplete = selectedQueueStatus === "IN_PROGRESS";

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
    <MainLayout pageTitle="Doctor Dashboard" pageSubtitle="Assigned live queue, vitals, history, and consultation records">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />
        {message && (
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>
            {message}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, .85fr) minmax(0, 1.15fr)", gap: 14, alignItems: "start" }}>
          <Panel style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 900, color: "#162235" }}>Today's Consultation Queue</div>
                <div style={{ color: "#6b778c", fontSize: 12 }}>{formatDate(todayISO())}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ActionButton tone="danger" onClick={callEmergency}>Emergency 911</ActionButton>
                <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
              </div>
            </div>

            {loading ? (
              <LoadingState label="Loading assigned queue..." />
            ) : patients.length === 0 ? (
              <EmptyState title="No active consultation queue" detail="Approved same-day patients appear here after frontdesk confirmation and nurse queue processing." />
            ) : (
              <div style={{ display: "grid" }}>
                {patients.map((appointment) => (
                  <button
                    key={`${appointment.id}-${appointment.queueEntry.queue_id}`}
                    type="button"
                    onClick={() => setSelected(appointment)}
                    style={{
                      border: "none",
                      borderTop: "1px solid #eef3f9",
                      background: selected?.queueEntry?.queue_id === appointment.queueEntry.queue_id ? "#f2f7ff" : "#fff",
                      padding: 14,
                      cursor: "pointer",
                      textAlign: "left",
                      display: "grid",
                      gap: 7,
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <strong style={{ color: "#162235" }}>{appointment.patient_name}</strong>
                      <StatusBadge status={appointment.queueEntry.status} />
                    </div>
                    <div style={{ color: "#6b778c", fontSize: 12 }}>
                      Queue #{appointment.queueEntry.queue_number} - {formatTime(appointment.time)} - {appointment.specialty_name || "No specialty"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel style={{ padding: 16 }}>
            {!selected ? (
              <EmptyState title="Select a patient" detail="Vitals and patient history will load here." />
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#162235" }}>{selected.patient_name}</div>
                    <div style={{ color: "#6b778c", fontSize: 13 }}>
                      Appointment #{selected.id} - {formatDate(selected.date)} {formatTime(selected.time)}
                    </div>
                    {selected.chief_complaint && (
                      <div style={{ color: "#42526a", fontSize: 13, marginTop: 4 }}>Chief complaint: {selected.chief_complaint}</div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge status={selectedQueueStatus} />
                    {canStart && (
                      <ActionButton disabled={actionLoading} onClick={() => updateQueueStatus("IN_PROGRESS", "Consultation started.")}>
                        {actionLoading ? "Updating..." : "Start Consultation"}
                      </ActionButton>
                    )}
                    {canComplete && (
                      <ActionButton tone="success" disabled={actionLoading} onClick={() => updateQueueStatus("DONE", "Visit completed.")}>
                        {actionLoading ? "Completing..." : "Complete Visit"}
                      </ActionButton>
                    )}
                  </div>
                </div>

                {detailLoading ? (
                  <LoadingState label="Loading clinical details..." />
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <ClinicalBlock title="Latest Vitals" rows={[
                      ["Blood pressure", latestVital?.blood_pressure],
                      ["Heart rate", latestVital?.heart_rate || latestVital?.pulse_rate],
                      ["Temperature", latestVital?.temperature],
                      ["Oxygen sat", latestVital?.oxygen_sat || latestVital?.oxygen_saturation || latestVital?.o2_saturation],
                      ["Chief complaint", latestVital?.chief_complaint],
                      ["Nurse notes", latestVital?.nurse_notes],
                    ]} />
                    <ClinicalBlock title="Patient History" rows={[
                      ["Previous records", history.length],
                      ["Last diagnosis", history[0]?.diagnosis],
                      ["Last visit", history[0]?.visit_date ? formatDate(history[0].visit_date) : ""],
                      ["Last prescription", history[0]?.prescriptions || history[0]?.prescription],
                    ]} />
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {selected && (
          <MedicalRecords
            appointment={selected}
            latestVital={latestVital}
            onCreated={() => updateQueueStatus("DONE", "Medical record saved and visit completed.")}
          />
        )}
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

function ClinicalBlock({ title, rows }) {
  return (
    <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 900, color: "#162235", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 13 }}>
            <span style={{ color: "#6b778c", fontWeight: 800 }}>{label}</span>
            <span style={{ color: "#162235", whiteSpace: "pre-wrap" }}>{value || "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
