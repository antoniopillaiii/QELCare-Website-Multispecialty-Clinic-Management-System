import React, { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../utils/auth";
import MainLayout from "../Layout/MainLayout";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  formatDate,
} from "../Workflow/ClinicUi";
import ReasonModal from "../common/ReasonModal";

export default function MedicationApprovals() {
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [declineTarget, setDeclineTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = query ? `?search=${encodeURIComponent(query)}` : "";
      const res = await authFetch(`/medications/pending-review${params}`);
      const payload = await res.json();
      if (!res.ok || payload.success === false) throw new Error(payload.message || "Failed to load pending medications.");
      setMeds(payload.medications || payload.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const approve = async (med) => {
    setBusyId(med.medication_id);
    setError("");
    setMsg("");
    try {
      const res = await authFetch(`/medications/${med.medication_id}/approve`, { method: "PATCH", body: JSON.stringify({}) });
      const payload = await res.json();
      if (!res.ok || payload.success === false) throw new Error(payload.message || "Failed to approve.");
      setMsg(`Validated ${med.drug_name} for ${med.patient_name}. The reminder is now active for the patient.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const decline = (med) => {
    setError("");
    setMsg("");
    setDeclineTarget(med);
  };

  const confirmDecline = async (reason) => {
    const med = declineTarget;
    setDeclineTarget(null);
    setBusyId(med.medication_id);
    setError("");
    setMsg("");
    try {
      const res = await authFetch(`/medications/${med.medication_id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) });
      const payload = await res.json();
      if (!res.ok || payload.success === false) throw new Error(payload.message || "Failed to decline.");
      setMsg(`Declined ${med.drug_name} for ${med.patient_name}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const runSearch = () => setQuery(search.trim());

  return (
    <MainLayout pageTitle="Patient Medication Review" pageSubtitle="Validate medications patients submitted before they become active reminders">
      <div style={{ display: "grid", gap: 14 }}>
        <Panel style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, color: "#162235" }}>{meds.length} medication(s) pending review</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                placeholder="Search patient or drug..."
                style={{ height: 38, border: "1px solid #d7e2ef", borderRadius: 8, padding: "0 12px", fontFamily: "inherit", fontSize: 13, minWidth: 200 }}
              />
              <ActionButton tone="secondary" onClick={runSearch}>Search</ActionButton>
              <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
            </div>
          </div>
        </Panel>

        <ErrorState message={error} />
        {msg && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{msg}</div>}

        {loading ? (
          <LoadingState label="Loading pending medications..." />
        ) : meds.length === 0 ? (
          <EmptyState title="Nothing to review" detail="There are no medications waiting for approval right now." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {meds.map((med) => (
              <Panel key={med.medication_id} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#162235" }}>
                      {med.drug_name} {med.dosage && <span style={{ color: "#6b778c", fontWeight: 700 }}>- {med.dosage}</span>}
                    </div>
                    <div style={{ color: "#42526a", fontSize: 13, marginTop: 3 }}>
                      Patient: <strong>{med.patient_name}</strong>{med.patient_phone ? ` - ${med.patient_phone}` : ""}
                    </div>
                    <div style={{ color: "#6b778c", fontSize: 13, marginTop: 3 }}>
                      {(med.frequency_per_day || 1)}x/day at {(Array.isArray(med.times_of_day) ? med.times_of_day : []).join(", ") || "-"}
                      {med.duration_days ? ` - ${med.duration_days} day(s)` : ""}
                      {med.form ? ` - ${med.form}` : ""}
                    </div>
                    {med.instructions && <div style={{ color: "#42526a", fontSize: 13, marginTop: 3 }}>Instructions: {med.instructions}</div>}
                    <div style={{ color: "#94a2b6", fontSize: 12, marginTop: 4 }}>
                      Submitted {formatDate(med.created_at)} - {med.source === "ocr" ? "via AI scan" : "added manually"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <ActionButton onClick={() => approve(med)} disabled={busyId === med.medication_id}>Validate</ActionButton>
                    <ActionButton tone="danger" onClick={() => decline(med)} disabled={busyId === med.medication_id}>Decline</ActionButton>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>

      {declineTarget && (
        <ReasonModal
          title="Decline Medication"
          subtitle={`${declineTarget.drug_name}${declineTarget.patient_name ? ` · ${declineTarget.patient_name}` : ""}`}
          label="Reason for declining (the patient will see this)"
          placeholder="Explain why this medication cannot be validated..."
          confirmText="Decline Medication"
          onClose={() => setDeclineTarget(null)}
          onConfirm={confirmDecline}
        />
      )}
    </MainLayout>
  );
}
