import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { C } from "../../../utils/adminTheme";
import ConfirmModal from "../../common/ConfirmModal";
import { X } from "lucide-react";

const EXPORT_COLUMNS = [
  { header: "Patient ID", value: (patient) => `#${patient.id}` },
  { header: "Name", value: (patient) => getPatientName(patient) },
  { header: "Gender", value: (patient) => patient.gender || "" },
  { header: "Age", value: (patient) => { const age = calculateAge(patient); return age !== null ? `${age}` : ""; } },
  { header: "Date of Birth", value: (patient) => formatDate(patient.date_of_birth) },
  { header: "Phone", value: (patient) => patient.phone || "" },
  { header: "Email", value: (patient) => patient.email || "" },
  { header: "Emergency Contact", value: (patient) => patient.emergency_contact_name || "" },
  { header: "Emergency Phone", value: (patient) => patient.emergency_contact_phone || "" },
  { header: "Status", value: (patient) => (patient.is_active ? "Active" : "Inactive") },
  { header: "Profile", value: (patient) => (isIncomplete(patient) ? "Incomplete" : "Complete") },
];

const BLOOD_TYPES = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS = ["", "Male", "Female", "Other"];
const ROWS_OPTIONS = [10, 25, 50];

function parseApi(responsePromise) {
  return responsePromise.then(async (response) => {
    if (!response) throw new Error("Request was not completed.");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || payload.error || "Request failed.");
    }
    return payload;
  });
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Today's date (Asia/Manila) as YYYY-MM-DD — the max allowed date of birth.
function todayInput() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function calculateAge(patient) {
  if (patient.age) return Number(patient.age);
  if (!patient.date_of_birth) return null;
  const dob = new Date(patient.date_of_birth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function getPatientName(patient) {
  return patient.display_name || patient.name || [patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Unnamed Patient";
}

function getInitials(patient) {
  const name = getPatientName(patient);
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function normalizePatient(patient) {
  return {
    ...patient,
    first_name: patient.first_name || "",
    last_name: patient.last_name || "",
    middle_name: patient.middle_name || "",
    suffix: patient.suffix || "",
    date_of_birth: patient.date_of_birth || "",
    gender: patient.gender || "",
    blood_type: patient.blood_type || "",
    phone: patient.phone || patient.contact || "",
    email: patient.email || patient.user_email || "",
    address: patient.address || "",
    emergency_contact_name: patient.emergency_contact_name || "",
    emergency_contact_phone: patient.emergency_contact_phone || "",
    emergency_contact_relation: patient.emergency_contact_relation || "",
    philhealth_no: patient.philhealth_no || "",
    senior_pwd_id: patient.senior_pwd_id || "",
    is_active: patient.is_active !== false,
  };
}

function isIncomplete(patient) {
  return !patient.phone || !patient.date_of_birth || !patient.gender || !patient.emergency_contact_phone;
}

function Avatar({ patient, size = 42 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg,#163a6b,#1f7a6f)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.34),
        fontWeight: 900,
        flexShrink: 0,
        border: "2px solid #fff",
        boxShadow: "0 2px 8px rgba(15,23,42,.12)",
      }}
    >
      {getInitials(patient)}
    </div>
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

function Badge({ children, color = C.blue, bg = "#eef3fb" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 10px", borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
      {children}
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
        background: danger ? C.danger : primary ? C.blue : "#fff",
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

function ReadOnly({ label, value }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 13 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>{label}</div>
      <div style={{ color: C.navy, fontWeight: 800, fontSize: 14 }}>{value || "Not set"}</div>
    </div>
  );
}

function PatientModal({ mode, patient, saving, onClose, onSave }) {
  const isView = mode === "view";
  const isEdit = mode === "edit";
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => {
    const p = normalizePatient(patient || {});
    return {
      first_name: p.first_name,
      last_name: p.last_name,
      middle_name: p.middle_name,
      suffix: p.suffix,
      date_of_birth: toDateInput(p.date_of_birth),
      gender: p.gender,
      blood_type: p.blood_type,
      phone: p.phone,
      email: p.email,
      address: p.address,
      emergency_contact_name: p.emergency_contact_name,
      emergency_contact_phone: p.emergency_contact_phone,
      emergency_contact_relation: p.emergency_contact_relation,
      philhealth_no: p.philhealth_no,
      senior_pwd_id: p.senior_pwd_id,
    };
  });

  const set = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("First name and last name are required.");
      return;
    }
    if (form.date_of_birth && form.date_of_birth > todayInput()) {
      setError("Date of birth cannot be in the future.");
      return;
    }
    onSave({
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      middle_name: form.middle_name.trim() || null,
      suffix: form.suffix.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      emergency_contact_relation: form.emergency_contact_relation.trim() || null,
      philhealth_no: form.philhealth_no.trim() || null,
      senior_pwd_id: form.senior_pwd_id.trim() || null,
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      blood_type: form.blood_type || null,
    });
  };

  return (
    <div
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(10,20,35,.58)", display: "grid", placeItems: "center", padding: 22 }}
    >
      <div style={{ width: "min(860px,100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
        <div style={{ flexShrink: 0, padding: "18px 22px", background: C.blue, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{isView ? "Patient Details" : isEdit ? "Edit Patient" : "Add Patient"}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{patient ? `Patient ID #${patient.id}` : "Create a clinical patient record"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, border: "none", borderRadius: 8, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        {isView ? (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24, background: "#fafbfd" }}>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                  <Avatar patient={patient} size={72} />
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>{getPatientName(patient)}</div>
                    <div style={{ color: C.text, marginTop: 4 }}>{patient.email || "No email"} / {patient.phone || "No phone"}</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
                  <ReadOnly label="Gender" value={patient.gender} />
                  <ReadOnly label="Age" value={calculateAge(patient) !== null ? `${calculateAge(patient)} yrs` : "Not set"} />
                  <ReadOnly label="Date of Birth" value={formatDate(patient.date_of_birth)} />
                  <ReadOnly label="Blood Type" value={patient.blood_type} />
                  <ReadOnly label="Emergency Contact" value={patient.emergency_contact_name} />
                  <ReadOnly label="Emergency Phone" value={patient.emergency_contact_phone} />
                  <ReadOnly label="PhilHealth No." value={patient.philhealth_no} />
                  <ReadOnly label="Senior/PWD ID" value={patient.senior_pwd_id} />
                  <ReadOnly label="Portal Account" value={patient.username || "Not linked"} />
                  <ReadOnly label="Status" value={patient.is_active ? "Active" : "Inactive"} />
                </div>
                <ReadOnly label="Address" value={patient.address} />
              </div>
            </div>
            <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", padding: "14px 24px", background: "#fff", borderTop: `1px solid ${C.border}` }}>
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24, background: "#fafbfd", display: "grid", gap: 16, alignContent: "start" }}>
              {error && <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fff2f4", color: C.danger, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 800 }}>{error}</div>}

              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
                <Field label="First Name *"><input name="first_name" value={form.first_name} onChange={set} style={inputStyle} /></Field>
                <Field label="Last Name *"><input name="last_name" value={form.last_name} onChange={set} style={inputStyle} /></Field>
                <Field label="Middle Name"><input name="middle_name" value={form.middle_name} onChange={set} style={inputStyle} /></Field>
                <Field label="Suffix"><input name="suffix" value={form.suffix} onChange={set} style={inputStyle} /></Field>
                <Field label="Date of Birth"><input type="date" name="date_of_birth" value={form.date_of_birth} onChange={set} max={todayInput()} min="1900-01-01" style={inputStyle} /></Field>
                <Field label="Gender">
                  <select name="gender" value={form.gender} onChange={set} style={inputStyle}>
                    {GENDERS.map((value) => <option key={value || "blank"} value={value}>{value || "Not set"}</option>)}
                  </select>
                </Field>
                <Field label="Blood Type">
                  <select name="blood_type" value={form.blood_type} onChange={set} style={inputStyle}>
                    {BLOOD_TYPES.map((value) => <option key={value || "blank"} value={value}>{value || "Not set"}</option>)}
                  </select>
                </Field>
                <Field label="Phone"><input name="phone" value={form.phone} onChange={set} style={inputStyle} /></Field>
                <Field label="Email"><input type="email" name="email" value={form.email} onChange={set} style={inputStyle} /></Field>
                <Field label="Emergency Contact"><input name="emergency_contact_name" value={form.emergency_contact_name} onChange={set} style={inputStyle} /></Field>
                <Field label="Emergency Phone"><input name="emergency_contact_phone" value={form.emergency_contact_phone} onChange={set} style={inputStyle} /></Field>
                <Field label="Emergency Relation"><input name="emergency_contact_relation" value={form.emergency_contact_relation} onChange={set} style={inputStyle} /></Field>
                <Field label="PhilHealth No."><input name="philhealth_no" value={form.philhealth_no} onChange={set} style={inputStyle} /></Field>
                <Field label="Senior/PWD ID"><input name="senior_pwd_id" value={form.senior_pwd_id} onChange={set} style={inputStyle} /></Field>
              </div>

              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <Field label="Address">
                  <textarea name="address" value={form.address} onChange={set} rows={3} style={{ ...inputStyle, height: "auto", padding: 12, resize: "vertical" }} />
                </Field>
              </div>
            </div>

            <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", background: "#fff", borderTop: `1px solid ${C.border}` }}>
              <Button onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Patient"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PatientRow({ patient, onView, onEdit, onToggleActive }) {
  const age = calculateAge(patient);
  const incomplete = isIncomplete(patient);

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
      <td data-label="Patient" className="qc-td-block" style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar patient={patient} />
          <div>
            <div style={{ color: C.navy, fontWeight: 900 }}>{getPatientName(patient)}</div>
            <div style={{ color: C.muted, fontSize: 12 }}>ID #{patient.id}{patient.username ? ` / ${patient.username}` : ""}</div>
          </div>
        </div>
      </td>
      <td data-label="Gender" style={tdStyle}>{patient.gender || "Not set"}</td>
      <td data-label="Age" style={tdStyle}>{age !== null ? `${age} yrs` : "Not set"}</td>
      <td data-label="Phone" style={tdStyle}>{patient.phone || "Not set"}</td>
      <td data-label="Emergency" style={tdStyle}>{patient.emergency_contact_phone || "Not set"}</td>
      <td data-label="Status" style={tdStyle}>
        {patient.is_active ? <Badge color={C.teal} bg="#eaf8f4">Active</Badge> : <Badge color="#666" bg="#f1f1f1">Inactive</Badge>}
      </td>
      <td data-label="Profile" style={tdStyle}>{incomplete ? <Badge color={C.amber} bg="#fff4de">Incomplete</Badge> : <Badge color={C.teal} bg="#eaf8f4">Complete</Badge>}</td>
      <td data-label="Actions" className="qc-td-block" style={{ ...tdStyle, textAlign: "right" }}>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <Button onClick={() => onView(patient)}>View</Button>
          <Button onClick={() => onEdit(patient)}>Edit</Button>
          <Button variant={patient.is_active ? "danger" : "secondary"} onClick={() => onToggleActive(patient)}>
            {patient.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

const thStyle = { textAlign: "left", padding: "12px 14px", color: C.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", whiteSpace: "nowrap" };
const tdStyle = { padding: "13px 14px", color: C.text, fontSize: 13, verticalAlign: "middle" };

export default function AdminPatients() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [completionFilter, setCompletionFilter] = useState("all");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.setTimeout(() => setAlert(null), 4200);
  }, []);

  const loadPatients = useCallback(async (query = "") => {
    setLoading(true);
    try {
      const payload = await parseApi(authFetch(`/patients?search=${encodeURIComponent(query)}`));
      const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.patients) ? payload.patients : [];
      setPatients(list.map(normalizePatient));
    } catch (error) {
      console.error("Patient load error:", error);
      showAlert("err", error.message || "Failed to load patients");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadPatients("");
  }, [loadPatients]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setPage(1);
      loadPatients(search);
    }, 350);
    return () => window.clearTimeout(id);
  }, [search, loadPatients]);

  const stats = useMemo(() => {
    const now = new Date();
    const addedThisMonth = patients.filter((patient) => {
      const created = new Date(patient.created_at);
      return !Number.isNaN(created.getTime()) && created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
    }).length;

    return {
      total: patients.length,
      active: patients.filter((patient) => patient.is_active).length,
      addedThisMonth,
      incomplete: patients.filter(isIncomplete).length,
    };
  }, [patients]);

  const filtered = useMemo(() => {
    return patients.filter((patient) => {
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "active" && patient.is_active) ||
        (statusFilter === "inactive" && !patient.is_active);
      const completionMatches =
        completionFilter === "all" ||
        (completionFilter === "complete" && !isIncomplete(patient)) ||
        (completionFilter === "incomplete" && isIncomplete(patient));
      return statusMatches && completionMatches;
    });
  }, [patients, statusFilter, completionFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pagePatients = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  const savePatient = async (payload) => {
    setSaving(true);
    try {
      const isEdit = modal?.mode === "edit";
      const response = await parseApi(authFetch(isEdit ? `/patients/${modal.patient.id}` : "/patients", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }));
      const saved = normalizePatient(response.data || response.patient);
      setPatients((prev) => {
        const index = prev.findIndex((patient) => patient.id === saved.id);
        if (index < 0) return [saved, ...prev];
        const next = [...prev];
        next[index] = saved;
        return next;
      });
      setModal(null);
      showAlert("ok", isEdit ? "Patient updated successfully" : "Patient created successfully");
    } catch (error) {
      console.error("Patient save error:", error);
      showAlert("err", error.message || "Failed to save patient");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (patient) => {
    const nextActive = !patient.is_active;
    const verb = nextActive ? "activate" : "deactivate";
    setConfirm({
      title: `${nextActive ? "Activate" : "Deactivate"} Patient`,
      message: `Are you sure you want to ${verb} ${getPatientName(patient)}?`,
      confirmText: nextActive ? "Activate" : "Deactivate",
      tone: nextActive ? "primary" : "danger",
      onConfirm: () => doToggleActive(patient, nextActive),
    });
  };

  const doToggleActive = async (patient, nextActive) => {
    try {
      const response = await parseApi(authFetch(`/patients/${patient.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextActive }),
      }));
      const saved = normalizePatient(response.data || response.patient);
      setPatients((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      showAlert("ok", `Patient ${nextActive ? "activated" : "deactivated"} successfully`);
    } catch (error) {
      console.error("Patient active toggle error:", error);
      showAlert("err", error.message || "Failed to update patient status");
    }
  };

  return (
    <MainLayout pageTitle="Patients" pageSubtitle="Clinical patient records and profile completeness">
      {alert && (
        <div style={{
          position: "fixed",
          top: 22,
          right: 22,
          zIndex: 700,
          padding: "12px 16px",
          borderRadius: 12,
          background: alert.type === "ok" ? "#eaf8f0" : "#fff2f4",
          color: alert.type === "ok" ? C.teal : C.danger,
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
          <div style={{ color: C.text, fontSize: 13 }}>Manage clinical patient records separately from login accounts.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ExportMenu
            filename="qelcare-patients"
            title="QELCare Patient Records"
            subtitle={`${filtered.length} patient${filtered.length === 1 ? "" : "s"} matching the current filters`}
            sheetTitle="Patients"
            columns={EXPORT_COLUMNS}
            rows={filtered}
            disabled={loading}
          />
          <Button onClick={() => loadPatients(search)} disabled={loading}>Refresh</Button>
          <Button variant="primary" onClick={() => setModal({ mode: "create", patient: null })}>Add Patient</Button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard label="Total Patients" value={loading ? "-" : stats.total} sub="All clinical records" color={C.blue} />
        <StatCard label="Active Patients" value={loading ? "-" : stats.active} sub="Available for clinic workflows" color={C.teal} />
        <StatCard label="Added This Month" value={loading ? "-" : stats.addedThisMonth} sub="New records this month" color={C.amber} />
        <StatCard label="Incomplete Profiles" value={loading ? "-" : stats.incomplete} sub="Missing key patient details" color={C.danger} />
      </section>

      <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.border}`, background: "linear-gradient(to right,#f8fafd,#fff)", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1.5fr) repeat(3,minmax(150px,1fr)) auto", gap: 10, alignItems: "center" }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, email..."
              style={inputStyle}
            />
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} style={inputStyle}>
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={completionFilter} onChange={(event) => { setCompletionFilter(event.target.value); setPage(1); }} style={inputStyle}>
              <option value="all">All Profiles</option>
              <option value="complete">Complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
            <select value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(1); }} style={inputStyle}>
              {ROWS_OPTIONS.map((value) => <option key={value} value={value}>{value} per page</option>)}
            </select>
            <div style={{ color: C.text, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
              {filtered.length} matched
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr style={{ background: C.soft }}>
                <th style={thStyle}>Patient</th>
                <th style={thStyle}>Gender</th>
                <th style={thStyle}>Age</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Emergency</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Profile</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>Loading patient records...</td>
                </tr>
              ) : pagePatients.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 42, textAlign: "center" }}>
                    <div style={{ color: C.navy, fontSize: 16, fontWeight: 900 }}>No patient records found</div>
                    <div style={{ color: C.text, fontSize: 13, marginTop: 5 }}>
                      {search ? "Try a different search term." : "Create the first clinical patient record when ready."}
                    </div>
                  </td>
                </tr>
              ) : (
                pagePatients.map((patient) => (
                  <PatientRow
                    key={patient.id}
                    patient={patient}
                    onView={(selected) => setModal({ mode: "view", patient: selected })}
                    onEdit={(selected) => setModal({ mode: "edit", patient: selected })}
                    onToggleActive={toggleActive}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && (
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={rowsPerPage}
            onPageChange={setPage}
            label="patients"
          />
        )}
      </section>

      {modal && (
        <PatientModal
          mode={modal.mode}
          patient={modal.patient}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={savePatient}
        />
      )}

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
