import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../../utils/auth";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Panel,
  inputStyle,
  todayISO,
} from "../Workflow/ClinicUi";

const APPOINTMENT_TYPES = [
  { value: "consultation", label: "Consultation" },
  { value: "follow_up", label: "Follow-up" },
  { value: "walk_in", label: "Walk-in" },
  { value: "emergency", label: "Emergency" },
];

// Common chief complaints offered as a dropdown; "Other" reveals a free-text box.
const COMPLAINTS = [
  "Fever",
  "Cough or colds",
  "Sore throat",
  "Headache",
  "Stomach ache",
  "Body pain / muscle pain",
  "Skin problem or rashes",
  "High blood pressure check",
  "Diabetes / blood sugar check",
  "Follow-up check-up",
  "Vaccination / immunization",
  "Other",
];

const GENDERS = ["", "Male", "Female", "Other"];

function manilaNowParts() {
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
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function normalizeTime(value) {
  return String(value || "").slice(0, 5);
}

function isPastManila(date, time) {
  if (!date || !time) return false;
  const now = manilaNowParts();
  return `${date}T${normalizeTime(time)}` <= `${now.date}T${now.time}`;
}

// Clinic operating hours: 8:00 AM to 8:00 PM (Asia/Manila).
const CLINIC_OPEN = "08:00";
const CLINIC_CLOSE = "20:00";

function minTimeFor(date) {
  const now = manilaNowParts();
  // For today, the earliest pickable time is "now" but never before opening.
  if (date === now.date) return now.time > CLINIC_OPEN ? now.time : CLINIC_OPEN;
  return CLINIC_OPEN;
}

function outsideClinicHours(time) {
  const t = normalizeTime(time);
  if (!t) return false;
  return t < CLINIC_OPEN || t > CLINIC_CLOSE;
}

const segmentedButton = (active) => ({
  minHeight: 38,
  borderRadius: 8,
  border: `1px solid ${active ? "#163a6b" : "#d7e2ef"}`,
  background: active ? "#163a6b" : "#fff",
  color: active ? "#fff" : "#163a6b",
  cursor: "pointer",
  fontWeight: 900,
  fontFamily: "inherit",
});

export default function UserBooking({ onViewAppointments, onBooked }) {
  const [doctors, setDoctors] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [complaintChoice, setComplaintChoice] = useState("");
  const [relatives, setRelatives] = useState([]);
  const [selectedRelativeId, setSelectedRelativeId] = useState("");
  const [saveRelative, setSaveRelative] = useState(true);
  const [form, setForm] = useState({
    booked_for: "self",
    doctor_id: "",
    specialty_id: "",
    date: todayISO(),
    time: "09:00",
    type: "consultation",
    chief_complaint: "",
    notes: "",
    relative: {
      first_name: "",
      last_name: "",
      relationship: "",
      date_of_birth: "",
      age: "",
      gender: "",
      phone: "",
      email: "",
    },
  });

  const loadDoctors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authFetch("/users/doctors");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to load doctors.");
      setDoctors(payload.doctors || payload.data || []);
      setSpecialties(payload.specialties || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRelatives = useCallback(async () => {
    try {
      const res = await authFetch("/relatives");
      const payload = await res.json();
      if (res.ok) setRelatives(payload.relatives || payload.data || []);
    } catch {
      /* saved relatives are optional */
    }
  }, []);

  useEffect(() => {
    loadDoctors();
  }, [loadDoctors]);

  useEffect(() => {
    loadRelatives();
  }, [loadRelatives]);

  function pickRelative(id) {
    setSelectedRelativeId(id);
    if (!id) {
      setForm((c) => ({ ...c, relative: { first_name: "", last_name: "", relationship: "", date_of_birth: "", age: "", gender: "", phone: "", email: "" } }));
      return;
    }
    const r = relatives.find((x) => String(x.relative_id) === String(id));
    if (!r) return;
    setForm((c) => ({
      ...c,
      relative: {
        first_name: r.first_name || "",
        last_name: r.last_name || "",
        relationship: r.relationship || "",
        date_of_birth: r.date_of_birth ? String(r.date_of_birth).slice(0, 10) : "",
        age: r.age ?? "",
        gender: r.gender || "",
        phone: r.phone || "",
        email: r.email || "",
      },
    }));
  }

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => String(doctor.user_id) === String(form.doctor_id)),
    [doctors, form.doctor_id]
  );

  const doctorsBySpecialty = useMemo(() => {
    return doctors.reduce((groups, doctor) => {
      const name = doctor.specialty_name || "Specialty not assigned";
      if (!groups[name]) groups[name] = [];
      groups[name].push(doctor);
      return groups;
    }, {});
  }, [doctors]);

  const specialtyCards = useMemo(() => {
    if (specialties.length) {
      return specialties.map((specialty) => ({
        ...specialty,
        doctor_count: Number(specialty.doctor_count || 0),
      }));
    }

    return Object.entries(doctorsBySpecialty).map(([specialty_name, group], index) => ({
      specialty_id: specialty_name,
      specialty_name,
      display_order: index + 1,
      doctor_count: group.length,
    }));
  }, [doctorsBySpecialty, specialties]);

  // Bookable departments = specialties that actually have at least one doctor.
  const departments = useMemo(() => {
    const map = new Map();
    doctors.forEach((d) => {
      const key = String(d.specialty_id || "");
      if (key && !map.has(key)) map.set(key, { specialty_id: d.specialty_id, specialty_name: d.specialty_name || "Specialty" });
    });
    return Array.from(map.values()).sort((a, b) => String(a.specialty_name).localeCompare(String(b.specialty_name)));
  }, [doctors]);

  // Doctors filtered to the chosen department.
  const departmentDoctors = useMemo(() => {
    if (!form.specialty_id) return [];
    return doctors.filter((d) => String(d.specialty_id) === String(form.specialty_id));
  }, [doctors, form.specialty_id]);

  function updateField(name, value) {
    if (name === "doctor_id") {
      const doctor = doctors.find((item) => String(item.user_id) === String(value));
      setForm((current) => ({
        ...current,
        doctor_id: value,
        specialty_id: doctor?.specialty_id || "",
      }));
      return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateRelative(name, value) {
    // Auto-capitalize and block invalid characters in the relative's name fields,
    // matching registration and Add User.
    let v = value;
    if (name === "first_name" || name === "last_name") {
      v = value
        .replace(/[^A-Za-zÀ-ÿ.'\- ]/g, "")
        .toLowerCase()
        .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
    }
    setForm((current) => ({
      ...current,
      relative: {
        ...current.relative,
        [name]: v,
      },
    }));
  }

  // Picking a department resets the doctor choice so only that department's
  // doctors can be selected next.
  function selectDepartment(value) {
    setForm((current) => ({ ...current, specialty_id: value, doctor_id: "" }));
  }

  function selectComplaint(value) {
    setComplaintChoice(value);
    updateField("chief_complaint", value === "Other" ? "" : value);
  }

  function validate() {
    if (doctors.length === 0) return "No bookable doctors are available. Please contact the clinic.";
    if (!form.specialty_id) return "Please select a department.";
    if (!form.doctor_id || !form.date || !form.time) return "Department, doctor, date, and time are required.";
    if (isPastManila(form.date, form.time)) return "Choose a future date and time using Asia/Manila time.";
    if (outsideClinicHours(form.time)) return "Clinic hours are 8:00 AM to 8:00 PM. Please choose a time within clinic hours.";
    if (!String(form.chief_complaint).trim()) return "Please select or describe your chief complaint.";
    if (form.booked_for === "other") {
      if (!form.relative.first_name.trim() || !form.relative.last_name.trim() || !form.relative.relationship.trim()) {
        return "Relative first name, last name, and relationship are required.";
      }
      if (form.relative.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.relative.email)) {
        return "Relative email is invalid.";
      }
    }
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch("/appointments/book", {
        method: "POST",
        body: JSON.stringify({
          booked_for: form.booked_for,
          relative: form.booked_for === "other" ? form.relative : undefined,
          doctor_id: Number(form.doctor_id),
          specialty_id: form.specialty_id ? Number(form.specialty_id) : selectedDoctor?.specialty_id || null,
          date: form.date,
          time: form.time,
          type: form.type,
          chief_complaint: form.chief_complaint,
          notes: form.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to book appointment.");

      // Save a newly-typed relative to the patient's address book for next time.
      if (form.booked_for === "other" && !selectedRelativeId && saveRelative) {
        try {
          await authFetch("/relatives", { method: "POST", body: JSON.stringify(form.relative) });
          loadRelatives();
        } catch {
          /* saving the relative is best-effort */
        }
      }

      setMessage("Appointment booked. It will stay pending until Frontdesk confirms it.");
      setSelectedRelativeId("");
      setForm((current) => ({
        ...current,
        chief_complaint: "",
        notes: "",
        relative: current.booked_for === "other"
          ? { first_name: "", last_name: "", relationship: "", date_of_birth: "", age: "", gender: "", phone: "", email: "" }
          : current.relative,
      }));
      if (onBooked) onBooked(payload.appointment || payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(280px, .9fr)", gap: 16, alignItems: "start" }}>
      <Panel style={{ padding: 18 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#162235" }}>Book Appointment</div>
            <div style={{ fontSize: 13, color: "#6b778c", marginTop: 3 }}>Choose a doctor, schedule, patient, and reason for visit.</div>
          </div>

          <ErrorState message={error} />
          {message && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{message}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" style={segmentedButton(form.booked_for === "self")} onClick={() => updateField("booked_for", "self")}>Myself</button>
            <button type="button" style={segmentedButton(form.booked_for === "other")} onClick={() => updateField("booked_for", "other")}>Someone else</button>
          </div>

          {form.booked_for === "other" && (
            <Panel style={{ padding: 14, background: "#f8fbff" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ color: "#162235", fontSize: 13, fontWeight: 900 }}>Relative information</div>
                  {relatives.length > 0 && (
                    <select style={{ ...inputStyle, maxWidth: 240 }} value={selectedRelativeId} onChange={(e) => pickRelative(e.target.value)}>
                      <option value="">+ Add a new person</option>
                      {relatives.map((r) => (
                        <option key={r.relative_id} value={r.relative_id}>{r.first_name} {r.last_name} ({r.relationship})</option>
                      ))}
                    </select>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="First name">
                    <input style={inputStyle} value={form.relative.first_name} onChange={(e) => updateRelative("first_name", e.target.value)} />
                  </Field>
                  <Field label="Last name">
                    <input style={inputStyle} value={form.relative.last_name} onChange={(e) => updateRelative("last_name", e.target.value)} />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px", gap: 10 }}>
                  <Field label="Relationship">
                    <input style={inputStyle} value={form.relative.relationship} onChange={(e) => updateRelative("relationship", e.target.value)} placeholder="Parent, child, spouse" />
                  </Field>
                  <Field label="Birth date">
                    <input style={inputStyle} type="date" value={form.relative.date_of_birth} onChange={(e) => updateRelative("date_of_birth", e.target.value)} />
                  </Field>
                  <Field label="Age">
                    <input style={inputStyle} type="number" min="0" max="130" value={form.relative.age} onChange={(e) => updateRelative("age", e.target.value)} />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr", gap: 10 }}>
                  <Field label="Gender">
                    <select style={inputStyle} value={form.relative.gender} onChange={(e) => updateRelative("gender", e.target.value)}>
                      {GENDERS.map((gender) => <option key={gender || "blank"} value={gender}>{gender || "Select"}</option>)}
                    </select>
                  </Field>
                  <Field label="Phone">
                    <input style={inputStyle} value={form.relative.phone} onChange={(e) => updateRelative("phone", e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <input style={inputStyle} type="email" value={form.relative.email} onChange={(e) => updateRelative("email", e.target.value)} />
                  </Field>
                </div>
                {!selectedRelativeId && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#42526a", cursor: "pointer" }}>
                    <input type="checkbox" checked={saveRelative} onChange={(e) => setSaveRelative(e.target.checked)} />
                    Save this person to my relatives for next time
                  </label>
                )}
              </div>
            </Panel>
          )}

          {loading ? (
            <LoadingState label="Loading available doctors..." />
          ) : doctors.length === 0 ? (
            <EmptyState title="No bookable doctors" detail="Admin must create or update a verified Doctor account with a specialty assignment." />
          ) : (
            <>
              <Field label="Department">
                <select style={inputStyle} value={form.specialty_id} onChange={(e) => selectDepartment(e.target.value)}>
                  <option value="">Select a department</option>
                  {departments.map((dep) => (
                    <option key={dep.specialty_id} value={dep.specialty_id}>{dep.specialty_name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Doctor">
                <select style={inputStyle} value={form.doctor_id} onChange={(e) => updateField("doctor_id", e.target.value)} disabled={!form.specialty_id}>
                  <option value="">{form.specialty_id ? "Select doctor" : "Select a department first"}</option>
                  {departmentDoctors.map((doctor) => (
                    <option key={doctor.user_id} value={doctor.user_id}>
                      {doctor.doctor_name || `${doctor.first_name} ${doctor.last_name}`}
                    </option>
                  ))}
                </select>
                {form.specialty_id && departmentDoctors.length === 0 && (
                  <div style={{ fontSize: 11, color: "#9a6500", marginTop: 4 }}>No available doctor in this department yet.</div>
                )}
              </Field>

              {selectedDoctor && (
                <div style={{ padding: 12, borderRadius: 8, background: "#f7fafd", border: "1px solid #e3ebf5", color: "#42526a", fontSize: 13 }}>
                  <strong style={{ color: "#162235" }}>{selectedDoctor.doctor_name || `${selectedDoctor.first_name} ${selectedDoctor.last_name}`}</strong>
                  <div>{selectedDoctor.specialty_name}</div>
                </div>
              )}
            </>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 160px", gap: 10 }}>
            <Field label="Date">
              <input style={inputStyle} type="date" min={todayISO()} value={form.date} onChange={(e) => updateField("date", e.target.value)} />
            </Field>
            <Field label="Time">
              <input style={inputStyle} type="time" min={minTimeFor(form.date)} max={CLINIC_CLOSE} value={form.time} onChange={(e) => updateField("time", e.target.value)} />
              <div style={{ fontSize: 11, color: "#8a97a8", marginTop: 4 }}>Clinic hours: 8:00 AM – 8:00 PM</div>
            </Field>
            <Field label="Type">
              <select style={inputStyle} value={form.type} onChange={(e) => updateField("type", e.target.value)}>
                {APPOINTMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Chief complaint">
            <select style={inputStyle} value={complaintChoice} onChange={(e) => selectComplaint(e.target.value)}>
              <option value="">Select your main concern</option>
              {COMPLAINTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {complaintChoice === "Other" && (
            <Field label="Please specify your concern">
              <input
                style={inputStyle}
                value={form.chief_complaint}
                onChange={(e) => updateField("chief_complaint", e.target.value)}
                placeholder="Describe your concern"
              />
            </Field>
          )}

          <Field label="Notes">
            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Optional details"
            />
          </Field>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton type="submit" disabled={loading || submitting || doctors.length === 0}>{submitting ? "Booking..." : "Book Appointment"}</ActionButton>
            <ActionButton tone="secondary" onClick={onViewAppointments || (() => { window.location.href = "/patient/appointments"; })}>
              View Appointments
            </ActionButton>
          </div>
        </form>
      </Panel>

      <Panel style={{ padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>Clinic Specialty Coverage</div>
        <div style={{ fontSize: 12, color: "#6b778c", marginTop: 2, marginBottom: 12 }}>Departments become bookable when a verified doctor is assigned by admin.</div>
        {loading ? (
          <LoadingState />
        ) : specialtyCards.length === 0 ? (
          <EmptyState title="No active specialties" detail="Admin must set active specialties before patients can book." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {specialtyCards.map((specialty) => {
              const hasDoctors = Number(specialty.doctor_count || 0) > 0;
              return (
                <div key={specialty.specialty_id || specialty.specialty_name} style={{ border: `1px solid ${hasDoctors ? "#e3ebf5" : "#f0d7c2"}`, borderRadius: 8, padding: 12, background: hasDoctors ? "#fff" : "#fff8f3" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900, color: "#162235" }}>{specialty.specialty_name}</div>
                    <span style={{ borderRadius: 999, padding: "3px 8px", fontSize: 11, fontWeight: 900, color: hasDoctors ? "#0f6b3c" : "#9a6500", background: hasDoctors ? "#eaf7ef" : "#fff0d5" }}>
                      {hasDoctors ? "Bookable" : "Needs doctor"}
                    </span>
                  </div>
                  <div style={{ color: "#6b778c", fontSize: 12, marginTop: 4 }}>
                    {Number(specialty.doctor_count || 0)} verified doctor(s)
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
