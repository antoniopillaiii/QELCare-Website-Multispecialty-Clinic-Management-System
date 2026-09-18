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
} from "../Workflow/ClinicUi";

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_QUEUE", "RESCHEDULED"];

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

function isUpcoming(item) {
  if (item.is_history === true) return false;
  return ACTIVE_STATUSES.includes(item.status) && scheduleKey(item) > manilaNowKey();
}

export default function UserScreen() {
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [records, setRecords] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [patientRes, appointmentsRes, recordsRes, vitalsRes] = await Promise.all([
        authFetch("/patients/me"),
        authFetch("/appointments/me?limit=50"),
        authFetch("/medical-records/me"),
        authFetch("/vitals/me"),
      ]);

      const patientPayload = await patientRes.json();
      const appointmentsPayload = await appointmentsRes.json();
      const recordsPayload = await recordsRes.json();
      const vitalsPayload = await vitalsRes.json();

      if (!patientRes.ok) throw new Error(patientPayload.message || "Failed to load patient profile.");
      if (!appointmentsRes.ok) throw new Error(appointmentsPayload.message || "Failed to load appointments.");
      if (!recordsRes.ok) throw new Error(recordsPayload.message || "Failed to load medical records.");
      if (!vitalsRes.ok) throw new Error(vitalsPayload.message || "Failed to load vitals.");

      setPatient(patientPayload.patient || patientPayload.data);
      setAppointments(getRows(appointmentsPayload, "appointments"));
      setRecords(getRows(recordsPayload, "records"));
      setVitals(getRows(vitalsPayload, "vitals"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upcomingAppointments = useMemo(
    () => appointments.filter(isUpcoming).sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b))),
    [appointments]
  );

  const nextAppointment = upcomingAppointments[0];
  const latestRecord = records[0];
  const latestVitals = vitals[0];
  const prescriptions = records.filter((record) => String(record.prescriptions || record.prescription || "").trim()).length;

  const notices = useMemo(() => {
    const rows = [];
    if (nextAppointment?.status === "PENDING") rows.push("Your appointment request is waiting for clinic confirmation.");
    if (nextAppointment?.status === "CONFIRMED") rows.push("Your appointment is confirmed. Please arrive on time for queue processing.");
    if (nextAppointment?.status === "IN_QUEUE") rows.push("You are currently in the clinic queue.");
    if (latestRecord) rows.push("A doctor medical record is available in Consultation Records.");
    if (prescriptions > 0) rows.push("Prescription details are available in Medications & Documents.");
    return rows.slice(0, 4);
  }, [latestRecord, nextAppointment, prescriptions]);

  return (
    <MainLayout pageTitle="Patient Dashboard" pageSubtitle="Appointments, records, prescriptions, and latest vitals">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />

        {loading ? (
          <LoadingState label="Loading your dashboard..." />
        ) : (
          <>
            <Panel style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#6b778c", fontSize: 12, fontWeight: 900, letterSpacing: ".04em", textTransform: "uppercase" }}>Welcome back</div>
                  <div style={{ color: "#162235", fontSize: 24, fontWeight: 900 }}>
                    {patient?.display_name || patient?.name || [patient?.first_name, patient?.last_name].filter(Boolean).join(" ") || "Patient"}
                  </div>
                  <div style={{ color: "#6b778c", fontSize: 13 }}>
                    {patient?.phone || "No phone on file"} - {patient?.email || "No email on file"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <ActionButton onClick={() => navigate("/patient/appointments?tab=book")}>Book Appointment</ActionButton>
                  <ActionButton tone="secondary" onClick={() => navigate("/patient/appointments")}>Appointments</ActionButton>
                  <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
                </div>
              </div>
            </Panel>

            <Panel style={{ overflow: "hidden" }}>
              <SectionHeader title="Notifications" action="Refresh" onClick={load} />
              {notices.length === 0 ? (
                <EmptyState title="No dashboard notices" detail="Clinic updates also appear under the bell icon." />
              ) : (
                <div style={{ display: "grid" }}>
                  {notices.map((notice) => (
                    <div key={notice} style={{ padding: "12px 16px", borderTop: "1px solid #eef3f9", color: "#162235", fontSize: 13, fontWeight: 800 }}>
                      {notice}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
              <Panel style={{ overflow: "hidden" }}>
                <SectionHeader title="Next Appointment" action="View All" onClick={() => navigate("/patient/appointments")} />
                {!nextAppointment ? (
                  <EmptyState title="No upcoming appointment" detail="Book a consultation to start the clinic flow." />
                ) : (
                  <div style={{ padding: 16, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ color: "#162235", fontWeight: 900 }}>{nextAppointment.specialty_name || "Consultation"}</div>
                        <div style={{ color: "#6b778c", fontSize: 13 }}>{nextAppointment.doctor_name || "Doctor"}</div>
                      </div>
                      <StatusBadge status={nextAppointment.status} />
                    </div>
                    <div style={{ color: "#42526a", fontSize: 13 }}>
                      {formatDate(nextAppointment.date)} at {formatTime(nextAppointment.time)}
                    </div>
                    {nextAppointment.booked_for === "other" && (
                      <div style={{ color: "#6b778c", fontSize: 12, fontWeight: 800 }}>
                        For {nextAppointment.patient_name} ({nextAppointment.booked_for_relationship || "relative"})
                      </div>
                    )}
                    {nextAppointment.chief_complaint && (
                      <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 10, color: "#162235", fontSize: 13 }}>
                        {nextAppointment.chief_complaint}
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              <Panel style={{ overflow: "hidden" }}>
                <SectionHeader title="Latest Vitals" action="Refresh" onClick={load} />
                {!latestVitals ? (
                  <EmptyState title="No vitals recorded" detail="Nurse-recorded vitals appear after check-in." />
                ) : (
                  <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Vital label="Blood pressure" value={latestVitals.blood_pressure} />
                    <Vital label="Heart rate" value={latestVitals.heart_rate || latestVitals.pulse_rate} />
                    <Vital label="Temperature" value={latestVitals.temperature} />
                    <Vital label="Oxygen sat" value={latestVitals.oxygen_sat || latestVitals.oxygen_saturation} />
                    <Vital label="Weight" value={latestVitals.weight || latestVitals.weight_kg} />
                    <Vital label="Recorded" value={formatDate(latestVitals.recorded_at)} />
                  </div>
                )}
              </Panel>
            </div>

            <Panel style={{ overflow: "hidden" }}>
              <SectionHeader title="Latest Medical Record" action="View Records" onClick={() => navigate("/patient/records")} />
              {!latestRecord ? (
                <EmptyState title="No completed records yet" detail="Doctor-created records appear after consultation." />
              ) : (
                <div style={{ padding: 16, display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ color: "#162235", fontWeight: 900 }}>{latestRecord.diagnosis || "Consultation record"}</div>
                    <div style={{ color: "#6b778c", fontSize: 13 }}>
                      {latestRecord.doctor_name || "Doctor"} - {formatDate(latestRecord.visit_date || latestRecord.appointment_date)}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <InfoBlock label="Treatment" value={latestRecord.treatment_plan} />
                    <InfoBlock label="Prescription" value={latestRecord.prescriptions || latestRecord.prescription} />
                  </div>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </MainLayout>
  );
}

function SectionHeader({ title, action, onClick }) {
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ color: "#162235", fontWeight: 900 }}>{title}</div>
      {action && <ActionButton tone="secondary" onClick={onClick}>{action}</ActionButton>}
    </div>
  );
}

function Vital({ label, value }) {
  return (
    <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 10 }}>
      <div style={{ color: "#6b778c", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#162235", fontWeight: 900, marginTop: 4 }}>{value || "-"}</div>
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 12, minWidth: 0 }}>
      <div style={{ color: "#6b778c", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#162235", fontSize: 13, whiteSpace: "pre-wrap", marginTop: 5 }}>{value || "-"}</div>
    </div>
  );
}