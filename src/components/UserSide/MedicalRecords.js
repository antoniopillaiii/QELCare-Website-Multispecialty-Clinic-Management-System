import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch, getUserFromToken, getUserRole } from "../../utils/auth";
import { fetchAllPages } from "../../utils/paginatedFetch";
import { manilaDateOf } from "../../utils/manilaDate";
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
  statusLabel,
  todayISO,
} from "../Workflow/ClinicUi";
import Pagination, { usePagination } from "../common/Pagination";

const blankRecord = {
  patient_id: "",
  appointment_id: "",
  vital_id: "",
  visit_date: todayISO(),
  chief_complaint: "",
  history_of_illness: "",
  physical_exam: "",
  diagnosis: "",
  treatment_plan: "",
  prescriptions: "",
  lab_requests: "",
  doctor_notes: "",
  follow_up_date: "",
  follow_up_notes: "",
};

// Common diagnostic tests / exams a doctor can order with one click, so the
// requested workup is specific (CBC, Fecalysis, Eyesight, etc.) instead of free text.
const COMMON_TESTS = [
  "CBC", "Urinalysis", "Fecalysis", "Blood Chemistry", "FBS (Blood Sugar)",
  "Lipid Profile", "Chest X-ray", "ECG", "Visual Acuity (Eyesight)",
  "Urine Culture", "Pregnancy Test", "COVID-19 Test",
];

function buildFormFromAppointment(appointment, latestVital) {
  return {
    ...blankRecord,
    patient_id: appointment?.patient_id || "",
    appointment_id: appointment?.id || appointment?.appointment_id || "",
    vital_id: latestVital?.id || latestVital?.vital_id || "",
    chief_complaint: appointment?.chief_complaint || latestVital?.chief_complaint || "",
  };
}

// What the doctor types during a consultation (everything not filled in from
// the appointment or its vitals).
const TYPED_FIELDS = [
  "history_of_illness", "physical_exam", "diagnosis", "treatment_plan", "prescriptions",
  "lab_requests", "doctor_notes", "follow_up_date", "follow_up_notes",
];

function typedFields(source) {
  return Object.fromEntries(TYPED_FIELDS.map((key) => [key, source[key]]));
}

// Appointment statuses that are an actual visit and so can have a consultation
// record (the server enforces the same list).
const RECORD_ELIGIBLE_STATUSES = ["IN_QUEUE", "FOR_BILLING", "COMPLETED"];

// What a doctor can correct on a record they own. The patient, the linked
// appointment and the vitals stay as they were saved.
const EDIT_FIELDS = ["visit_date", "chief_complaint", ...TYPED_FIELDS];

// Once the visit is paid (Completed) the record can only be amended: these
// fields are locked and a reason is required (the server enforces both).
const FROZEN_AFTER_PAYMENT = ["visit_date", "lab_requests"];

function isPaidVisit(record) {
  return record?.appointment_id != null && record.appointment_status === "COMPLETED";
}

function editFormFromRecord(record) {
  return {
    ...Object.fromEntries(EDIT_FIELDS.map((key) => [
      key,
      key === "follow_up_date" ? record.follow_up_date_text || "" : record[key] || "",
    ])),
    amendment_reason: "",
  };
}

function visitIdOf(appointment) {
  return appointment ? Number(appointment.id || appointment.appointment_id) || null : null;
}

// "MR-00061": the reference the server uses for a record.
function recordRef(id) {
  return `MR-${String(id).padStart(5, "0")}`;
}

export default function MedicalRecords({ appointment, latestVital, onCreated }) {
  const role = getUserRole();
  const isPatient = role === "Patient";
  const canCreate = role === "Doctor";
  const isConsultationEntry = canCreate && Boolean(appointment);

  const [records, setRecords] = useState([]);
  // The staff list (no patient in context) is paged by the server so every
  // record is reachable; a patient's own history and a consultation's patient
  // history come back whole and are paged here (same behaviour as the mobile app).
  const serverPaged = !isPatient && !appointment?.patient_id;
  const clientPaging = usePagination(records, 10, "records");
  const [serverPage, setServerPage] = useState(1);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const page = serverPaged ? serverPage : clientPaging.page;
  const totalPages = serverPaged ? serverPages : clientPaging.totalPages;
  const pageItems = serverPaged ? records : clientPaging.pageItems;
  const setPage = serverPaged ? setServerPage : clientPaging.setPage;
  const pageSize = 10;
  const totalItems = serverPaged ? serverTotal : clientPaging.totalItems;
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(isConsultationEntry);
  const [form, setForm] = useState(() => buildFormFromAppointment(appointment, latestVital));
  // Correcting an existing record: which one, and its own copy of the fields
  // (kept apart from the new-record form so neither overwrites the other).
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const values = editing ? editForm : form;
  const formPanel = useRef(null);
  const currentUserId = Number(getUserFromToken()?.user_id || 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const recordEndpoint = isPatient
        ? "/medical-records/me"
        : appointment?.patient_id
          ? `/medical-records/patient/${appointment.patient_id}`
          : `/medical-records?page=${serverPage}&limit=10`;

      const recordRes = await authFetch(recordEndpoint);
      const recordPayload = await recordRes.json();
      if (!recordRes.ok) throw new Error(recordPayload.message || "Failed to load records.");
      setRecords(getRows(recordPayload, "records"));
      if (serverPaged) {
        setServerTotal(Number(recordPayload.total) || 0);
        setServerPages(Number(recordPayload.pages) || 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [appointment, isPatient, serverPage, serverPaged]);

  useEffect(() => {
    load();
  }, [load]);

  // Appointment picker of the stand-alone entry form: the doctor's visits that
  // can still get a consultation record. Same rule the server enforces: only a
  // visit that took place (in the queue, awaiting billing or completed), and
  // one record per visit. The API returns at most 100 rows per request, so all
  // pages are loaded (once per change, not on every records page change).
  const needsAppointmentPicker = canCreate && !appointment;
  const [pickerVersion, setPickerVersion] = useState(0);
  useEffect(() => {
    if (!needsAppointmentPicker) return undefined;
    let cancelled = false;
    fetchAllPages("/appointments", { status: RECORD_ELIGIBLE_STATUSES })
      .then((rows) => {
        if (cancelled) return;
        const today = todayISO();
        setAppointments(rows.filter((item) => !item.latest_record_id && String(item.date || "").slice(0, 10) <= today));
      })
      .catch(() => { /* the picker stays empty; the form asks for a visit before saving */ });
    return () => { cancelled = true; };
  }, [needsAppointmentPicker, pickerVersion]);

  // The visit the form currently belongs to, and what was typed for each visit
  // that hasn't been saved yet (kept only while this screen stays open).
  const formVisitId = useRef(visitIdOf(appointment));
  const drafts = useRef(new Map());

  useEffect(() => {
    if (!appointment) return;
    setShowForm(canCreate);
    const visitId = visitIdOf(appointment);
    const sameVisit = formVisitId.current === visitId;
    formVisitId.current = visitId;
    if (!sameVisit) {
      setError("");
      setMessage("");
      setEditing(null);
      setEditForm(null);
    }
    setForm((current) => {
      const fresh = buildFormFromAppointment(appointment, latestVital);
      // Same visit, refreshed (reload, vitals arriving): keep what was typed.
      if (sameVisit) return { ...current, ...fresh, ...typedFields(current) };
      // Another patient was selected: never carry this text over. Start from
      // that visit's own unsaved text, or a blank form.
      const draft = drafts.current.get(visitId);
      return draft ? { ...fresh, ...typedFields(draft) } : fresh;
    });
  }, [appointment, canCreate, latestVital]);

  useEffect(() => {
    if (formVisitId.current) drafts.current.set(formVisitId.current, form);
  }, [form]);

  // The record already saved for the visit being consulted, if any. One visit
  // has one record, so the entry form is replaced by a notice once it exists.
  const visitRecord = isConsultationEntry
    ? records.find((record) => Number(record.appointment_id) === visitIdOf(appointment)) || null
    : null;

  const selectedAppointment = useMemo(() => {
    if (appointment) return appointment;
    return appointments.find((item) => String(item.id) === String(form.appointment_id));
  }, [appointment, appointments, form.appointment_id]);

  // Same rule the server enforces on update: a record belongs to its doctor,
  // else to the linked appointment's doctor, else to the doctor who wrote it.
  function canEdit(record) {
    if (!canCreate || !currentUserId) return false;
    const owner = Number(record.doctor_id || record.appointment_doctor_id || 0)
      || (Number(record.created_by) === currentUserId ? currentUserId : 0);
    return owner === currentUserId;
  }

  function startEdit(record) {
    setError("");
    setMessage("");
    setEditing({
      id: record.record_id || record.id,
      patient_name: record.patient_name,
      doctor_name: record.doctor_name,
      paid: isPaidVisit(record), // paid visit: an amendment, with a reason
    });
    setEditForm(editFormFromRecord(record));
    setShowForm(true);
    formPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    setEditing(null);
    setEditForm(null);
    setError("");
    setShowForm(isConsultationEntry);
  }

  async function saveEdit() {
    if (!String(editForm.diagnosis || "").trim()) {
      setError("Diagnosis is required.");
      return;
    }
    const { amendment_reason: reason, ...fields } = editForm;
    if (editing.paid && !String(reason || "").trim()) {
      setError("Enter the reason for amending this record.");
      return;
    }
    // After payment only the amendable fields are sent, with the reason.
    const body = editing.paid
      ? {
        ...Object.fromEntries(Object.entries(fields).filter(([key]) => !FROZEN_AFTER_PAYMENT.includes(key))),
        amendment_reason: String(reason).trim(),
      }
      : fields;

    setSaving(true);
    try {
      const response = await authFetch(`/medical-records/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to update record.");

      const ref = recordRef(editing.id);
      setEditing(null);
      setEditForm(null);
      setShowForm(isConsultationEntry);
      await load();
      setMessage(payload.changed === false
        ? "No changes to save."
        : `Medical record ${ref} ${payload.amended ? "amended" : "updated"}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function updateField(name, value) {
    if (editing) {
      setEditForm((current) => ({ ...current, [name]: value }));
      return;
    }

    if (name === "appointment_id") {
      // The record takes its patient and visit date from the chosen visit.
      const selected = appointments.find((item) => String(item.id) === String(value));
      setForm((current) => ({
        ...current,
        appointment_id: value,
        patient_id: selected?.patient_id || "",
        visit_date: selected?.date ? String(selected.date).slice(0, 10) : current.visit_date,
        chief_complaint: selected?.chief_complaint || current.chief_complaint,
      }));
      return;
    }

    setForm((current) => ({ ...current, [name]: value }));
  }

  // Append a selected test to the requested-labs field (no duplicates).
  function addTest(test) {
    const setValues = editing ? setEditForm : setForm;
    setValues((current) => {
      const existing = String(current.lab_requests || "").trim();
      const items = existing ? existing.split(/,\s*/).filter(Boolean) : [];
      if (items.includes(test)) return current;
      return { ...current, lab_requests: [...items, test].join(", ") };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!canCreate) {
      setError("Only doctors can create medical records.");
      return;
    }
    if (editing) {
      await saveEdit();
      return;
    }
    if (!form.appointment_id || !form.patient_id) {
      setError("Select the visit this record is for.");
      return;
    }
    if (!form.diagnosis) {
      setError("Diagnosis is required.");
      return;
    }

    setSaving(true);
    try {
      const response = await authFetch("/medical-records", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          patient_id: Number(form.patient_id),
          appointment_id: form.appointment_id ? Number(form.appointment_id) : null,
          vital_id: form.vital_id ? Number(form.vital_id) : null,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to create record.");

      setMessage(isConsultationEntry ? "Medical record saved. Completing visit..." : "Medical record created.");
      setForm(appointment ? buildFormFromAppointment(appointment, latestVital) : { ...blankRecord });
      setShowForm(Boolean(appointment));
      setPickerVersion((version) => version + 1); // the visit just used leaves the picker
      await load();

      if (onCreated) {
        await onCreated(payload.record || payload.data);
        // The caller reports whether the visit was completed.
        if (isConsultationEntry) setMessage("");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <ErrorState message={error} />
      {message && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>
          {message}
        </div>
      )}

      {canCreate && (
        <div ref={formPanel}>
        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900, color: "#162235" }}>
                {editing ? `${editing.paid ? "Amend" : "Edit"} Consultation Record ${recordRef(editing.id)}` : isConsultationEntry ? "Consultation Record" : "Doctor Record Entry"}
              </div>
              <div style={{ color: "#6b778c", fontSize: 13 }}>
                {editing
                  ? editing.paid
                    ? "This visit is already paid, so changes are saved as an amendment. Only the record's own doctor can amend it."
                    : "Correct this record and save your changes. Only the record's own doctor can edit it."
                  : "Save diagnosis, treatment plan, prescriptions, and requested procedures after consultation."}
              </div>
            </div>
            {!isConsultationEntry && (
              <ActionButton tone={showForm ? "secondary" : "primary"} onClick={() => (editing ? cancelEdit() : setShowForm((value) => !value))}>
                {showForm ? "Close Form" : "New Record"}
              </ActionButton>
            )}
          </div>

          {visitRecord && !editing && (
            <div style={{ display: "grid", gap: 6, marginTop: 14, padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
              <div>
                <strong style={{ color: "#162235" }}>{appointment.patient_name}</strong>
                <span> - Appointment #{appointment.id} - {formatDate(appointment.date)} {formatTime(appointment.time)}</span>
              </div>
              <div>
                The consultation record for this visit is already saved ({recordRef(visitRecord.record_id || visitRecord.id)}).
                To finish the visit, use Start Consultation / Complete Visit at the top of this page.
              </div>
              {canEdit(visitRecord) && (
                <div>
                  <ActionButton tone="secondary" onClick={() => startEdit(visitRecord)}>Edit Record</ActionButton>
                </div>
              )}
            </div>
          )}

          {(editing || (showForm && !visitRecord)) && (
            <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {editing ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 10, alignItems: "end" }}>
                  <div style={{ padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
                    <strong style={{ color: "#162235" }}>{editing.patient_name || "Patient"}</strong>
                    <span> - {recordRef(editing.id)}{editing.doctor_name ? ` - ${editing.doctor_name}` : ""}</span>
                  </div>
                  <Field label={editing.paid ? "Visit date (locked)" : "Visit date"}>
                    <input style={inputStyle} type="date" max={todayISO()} value={values.visit_date} disabled={editing.paid} onChange={(e) => updateField("visit_date", e.target.value)} />
                  </Field>
                  {editing.paid && (
                    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
                      <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fff4de", color: "#9a6500", fontSize: 12.5, fontWeight: 800 }}>
                        This visit is paid. The visit date and the requested procedures are locked so the record stays consistent with the bill.
                        Other changes are recorded as an amendment, with your reason and the previous values kept in the audit history.
                      </div>
                      <Field label="Reason for amendment *">
                        <input style={inputStyle} maxLength={500} value={values.amendment_reason} onChange={(e) => updateField("amendment_reason", e.target.value)} placeholder="e.g. Corrected a typing error in the diagnosis" />
                      </Field>
                    </div>
                  )}
                </div>
              ) : isConsultationEntry ? (
                <div style={{ padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
                  <strong style={{ color: "#162235" }}>{appointment.patient_name}</strong>
                  <span> - Appointment #{appointment.id} - {formatDate(appointment.date)} {formatTime(appointment.time)}</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "2fr 170px", gap: 10 }}>
                  {/* Every record documents a visit: the patient comes from the visit chosen here. */}
                  <Field label="Visit *">
                    <select style={inputStyle} value={form.appointment_id} onChange={(e) => updateField("appointment_id", e.target.value)}>
                      <option value="">{appointments.length ? "Select the visit this record is for" : "No visits are waiting for a consultation record"}</option>
                      {appointments.map((item) => (
                        <option key={item.id} value={item.id}>
                          #{item.id} {item.patient_name} - {formatDate(item.date)} {formatTime(item.time)} - {statusLabel(item.status)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Visit date">
                    <input style={inputStyle} type="date" max={todayISO()} value={form.visit_date} onChange={(e) => updateField("visit_date", e.target.value)} />
                  </Field>
                </div>
              )}

              {selectedAppointment && !isConsultationEntry && !editing && (
                <div style={{ padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f7fafd", fontSize: 13, color: "#42526a" }}>
                  <strong style={{ color: "#162235" }}>{selectedAppointment.patient_name}</strong> with {selectedAppointment.doctor_name} ({selectedAppointment.specialty_name || "No specialty"})
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Chief complaint">
                  <textarea style={{ ...inputStyle, minHeight: 72 }} value={values.chief_complaint} onChange={(e) => updateField("chief_complaint", e.target.value)} />
                </Field>
                <Field label="History of illness">
                  <textarea style={{ ...inputStyle, minHeight: 72 }} value={values.history_of_illness} onChange={(e) => updateField("history_of_illness", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Physical exam">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={values.physical_exam} onChange={(e) => updateField("physical_exam", e.target.value)} />
                </Field>
                <Field label="Diagnosis">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={values.diagnosis} onChange={(e) => updateField("diagnosis", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Treatment plan">
                  <textarea style={{ ...inputStyle, minHeight: 86 }} value={values.treatment_plan} onChange={(e) => updateField("treatment_plan", e.target.value)} />
                </Field>
                <Field label="Prescriptions">
                  <textarea style={{ ...inputStyle, minHeight: 86 }} value={values.prescriptions} onChange={(e) => updateField("prescriptions", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label={editing?.paid ? "Requested procedures or labs (locked)" : "Requested procedures or labs"}>
                  {canCreate && !editing?.paid && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {COMMON_TESTS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => addTest(t)}
                          style={{ border: "1px solid #d7e2ef", background: "#f1f6fc", color: "#163a6b", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={values.lab_requests} disabled={Boolean(editing?.paid)} onChange={(e) => updateField("lab_requests", e.target.value)} placeholder={editing?.paid ? "" : "Click a test above to add it, or type specific labs/exams (e.g. CBC, Fecalysis, Eyesight)"} />
                </Field>
                <Field label="Doctor notes">
                  <textarea style={{ ...inputStyle, minHeight: 78 }} value={values.doctor_notes} onChange={(e) => updateField("doctor_notes", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10 }}>
                <Field label="Follow-up date">
                  <input style={inputStyle} type="date" value={values.follow_up_date} onChange={(e) => updateField("follow_up_date", e.target.value)} />
                </Field>
                <Field label="Follow-up notes">
                  <input style={inputStyle} value={values.follow_up_notes} onChange={(e) => updateField("follow_up_notes", e.target.value)} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {/* In a consultation, wait until this patient's records are loaded: that is how an already-saved record for the visit is known. */}
                <ActionButton type="submit" disabled={saving || (isConsultationEntry && loading && !editing)}>
                  {saving ? "Saving..." : editing ? (editing.paid ? "Save Amendment" : "Save Changes") : isConsultationEntry ? "Save Record and Complete Visit" : "Add Record"}
                </ActionButton>
                {(editing || !isConsultationEntry) && (
                  <ActionButton tone="secondary" disabled={saving} onClick={() => (editing ? cancelEdit() : setShowForm(false))}>Cancel</ActionButton>
                )}
              </div>
            </form>
          )}
        </Panel>
        </div>
      )}

      <Panel style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6" }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>{isPatient ? "Consultation Records" : "Medical Records"}</div>
          <div style={{ fontSize: 12, color: "#6b778c", marginTop: 2 }}>{totalItems} record(s)</div>
        </div>

        {loading ? (
          <LoadingState label="Loading records..." />
        ) : records.length === 0 ? (
          <EmptyState title="No records found" detail={isPatient ? "Completed doctor records will show here." : "Patient history will appear here after records are created."} />
        ) : (
          <div style={{ display: "grid" }}>
            {pageItems.map((record) => (
              <article key={record.record_id || record.id} style={{ padding: 16, borderTop: "1px solid #eef3f9", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900, color: "#162235" }}>{record.diagnosis || "No diagnosis entered"}</div>
                    <div style={{ color: "#6b778c", fontSize: 13 }}>
                      {record.patient_name || "Patient"} - {record.doctor_name || "Doctor"} - {formatDate(record.visit_date || record.appointment_date)}
                    </div>
                    {/* Changed after the visit was paid: everyone who can see the record is told, and when. The reason is for staff. */}
                    {record.amended_at && (
                      <div style={{ color: "#9a6500", fontSize: 12, fontWeight: 800, marginTop: 3 }}>
                        Amended on {formatDate(manilaDateOf(record.amended_at))}
                        {!isPatient && record.amended_by_name ? ` by ${record.amended_by_name}` : ""}
                        {!isPatient && record.amendment_reason ? ` - Reason: ${record.amendment_reason}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <StatusBadge status={record.appointment_status || "COMPLETED"} />
                    {record.amended_at && (
                      <span style={{ padding: "3px 9px", borderRadius: 999, background: "#fff4de", color: "#9a6500", fontSize: 11, fontWeight: 900 }}>Amended</span>
                    )}
                    {canEdit(record) && (
                      <ActionButton tone="secondary" disabled={saving} onClick={() => startEdit(record)}>{isPaidVisit(record) ? "Amend" : "Edit"}</ActionButton>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Chief complaint" value={record.chief_complaint} />
                  <RecordBlock label="Physical exam" value={record.physical_exam} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Treatment" value={record.treatment_plan} />
                  <RecordBlock label="Prescription" value={record.prescriptions || record.prescription} />
                  <RecordBlock label="Requested procedures" value={record.lab_requests} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <RecordBlock label="Follow-up" value={record.follow_up_date_text || record.follow_up_date} formatter={formatDate} />
                  <RecordBlock label="Doctor notes" value={record.doctor_notes} />
                </div>
              </article>
            ))}
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={setPage}
          label="records"
        />
      </Panel>
    </div>
  );
}

function RecordBlock({ label, value, formatter }) {
  const display = formatter && value ? formatter(value) : value;
  return (
    <div style={{ border: "1px solid #e8eef6", borderRadius: 8, padding: 10, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#6b778c", fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 4, color: "#162235", fontSize: 13, whiteSpace: "pre-wrap" }}>{display || "-"}</div>
    </div>
  );
}
