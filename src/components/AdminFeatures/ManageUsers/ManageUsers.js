import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import { API_URL, authFetch, getToken } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { C } from "../../../utils/adminTheme";
import ConfirmModal from "../../common/ConfirmModal";
import { X } from "lucide-react";

const EXPORT_COLUMNS = [
  { header: "Username", value: (user) => user.username || "" },
  { header: "Email", value: (user) => user.email || "" },
  { header: "Full Name", value: (user) => getFullName(user) },
  { header: "Role", value: (user) => user.role || "Unassigned" },
  { header: "Specialty", value: (user) => user.specialty_name || "" },
  { header: "Status", value: (user) => statusLabel(user.status).label },
  { header: "Phone", value: (user) => user.phone || "" },
  { header: "Gender", value: (user) => user.gender || "" },
  { header: "Joined", value: (user) => formatDate(user.created_at, true) },
  { header: "Last Login", value: (user) => formatDate(user.last_login, true) },
];

const STATUS_OPTIONS = [
  { value: "verified", label: "Active" },
  { value: "unverified", label: "Unverified" },
  { value: "locked", label: "Locked" },
  { value: "deactivated", label: "Deactivated" },
];

function statusLabel(status) {
  return {
    verified: { label: "Active", bg: "#dff5e7", color: "#1f8a5b" },
    unverified: { label: "Unverified", bg: "#fff4de", color: "#a56a00" },
    locked: { label: "Locked", bg: "#ffe5e8", color: "#b63342" },
    deactivated: { label: "Deactivated", bg: "#f2f2f2", color: "#666" },
  }[status] || { label: status || "Unknown", bg: "#eee", color: "#333" };
}

function formatDate(value, withTime = false) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function getFullName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "User";
}

function getProfilePicUrl(user) {
  if (!user?.profile_picture) return null;
  if (user.profile_picture.startsWith("http")) return user.profile_picture;
  return `${API_URL}${user.profile_picture}`;
}

function decodeUserIdFromToken() {
  try {
    const token = getToken();
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.user_id || payload.user?.user_id || null;
  } catch {
    return null;
  }
}

function getCurrentUserId() {
  try {
    const stored = JSON.parse(localStorage.getItem("user") || "{}");
    return stored.user_id || decodeUserIdFromToken();
  } catch {
    return decodeUserIdFromToken();
  }
}

function getRoleNameById(roles, roleId) {
  return roles.find((role) => String(role.role_id) === String(roleId))?.role_name || "";
}

async function parseApiResponse(response) {
  if (!response) throw new Error("Request was not completed");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

// fetch() only throws a TypeError ("Failed to fetch") when the server can't be
// reached; say that plainly instead of showing the browser's wording.
function friendlyError(error, fallback) {
  if (error instanceof TypeError) return "Could not reach the server. Check the connection and try again.";
  return error?.message || fallback;
}

// Same rules the server applies to admin-created accounts (authValidator.js),
// checked here first so the admin gets the message without a round trip.
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{2,49}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-zÀ-ÿ.'\- ]{2,50}$/;
const PHONE_RE = /^(09\d{9}|\+639\d{9}|\+\d{10,14})$/;
const PASSWORD_HINT = "At least 8 characters with uppercase and lowercase letters, a number, and a special character (@$!%*?&#).";

function newUserError(form) {
  if (!USERNAME_RE.test(form.username.trim())) return "Username must start with a letter and be 3-50 characters using letters, numbers, dot, underscore, or hyphen.";
  if (!EMAIL_RE.test(form.email.trim())) return "Enter a valid email address.";
  if (!NAME_RE.test(form.first_name.trim())) return "First name must be at least 2 characters using letters, spaces, hyphens, apostrophes, or periods.";
  if (!NAME_RE.test(form.last_name.trim())) return "Last name must be at least 2 characters using letters, spaces, hyphens, apostrophes, or periods.";
  const phone = form.phone.trim().replace(/[\s\-()]/g, "");
  if (phone && !PHONE_RE.test(phone)) return "Phone is invalid. Use 09XXXXXXXXX or +639XXXXXXXXX.";
  const pw = form.password;
  if (pw.length < 8 || pw.length > 128 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[@$!%*?&#]/.test(pw)) {
    return `Password doesn't meet the requirements: ${PASSWORD_HINT.charAt(0).toLowerCase()}${PASSWORD_HINT.slice(1)}`;
  }
  return null;
}

async function uploadProfilePhoto(userId, file) {
  const form = new FormData();
  form.append("profilePicture", file);

  const token = getToken();
  const response = await fetch(`${API_URL}/users/${userId}/profile-picture`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Profile photo upload failed");
  }
  return data;
}

function UserAvatar({ user, size = 56 }) {
  const [imgError, setImgError] = useState(false);
  const profileUrl = getProfilePicUrl(user);
  const initials = (() => {
    if (user?.first_name && user?.last_name) return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
    if (user?.username) return user.username.slice(0, 2).toUpperCase();
    return "U";
  })();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "linear-gradient(135deg,#163a6b,#1f4e8c)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.34),
        fontWeight: 800,
        border: "3px solid #fff",
        boxShadow: "0 2px 8px rgba(15,23,42,.14)",
        flexShrink: 0,
      }}
    >
      {profileUrl && !imgError ? (
        <img
          src={profileUrl}
          alt={user?.username || "User"}
          onError={() => setImgError(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function Badge({ children, bg, color }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Button({ children, variant = "secondary", disabled, onClick, type = "button" }) {
  const primary = variant === "primary";
  const danger = variant === "danger";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
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

function UserCard({ user, currentUserId, onView, onEdit, onRemove }) {
  const st = statusLabel(user.status);
  const isCurrentUser = Number(user.user_id) === Number(currentUserId);

  return (
    <article
      style={{
        background: "#fff",
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 2px 10px rgba(15,23,42,.06)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <UserAvatar user={user} size={64} />
        <Badge bg={st.bg} color={st.color}>{st.label}</Badge>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.username || "No username"}
          </div>
          {isCurrentUser && <Badge bg={C.blue} color="#fff">You</Badge>}
        </div>
        <div style={{ fontSize: 13, color: C.text, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user.email || "No email"}
        </div>
      </div>

      <div style={{ marginTop: 14, padding: "12px 0", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, display: "grid", gap: 8 }}>
        <InfoRow label="Name" value={getFullName(user)} />
        <InfoRow label="Role" value={user.role || "Unassigned"} />
        <InfoRow label="Phone" value={user.phone || "Not set"} />
        <InfoRow label="Gender" value={user.gender || "Not set"} />
        <InfoRow label="Joined" value={formatDate(user.created_at)} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Button onClick={() => onView(user)}>View</Button>
        <Button onClick={() => onEdit(user)} disabled={isCurrentUser}>Edit</Button>
        <Button variant="danger" onClick={() => onRemove(user)} disabled={isCurrentUser || user.status === "deactivated"}>
          Deactivate
        </Button>
      </div>
    </article>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
      <span style={{ color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
      <span style={{ color: C.navy, fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 800, color: C.navy }}>
      {label}
      {children}
    </label>
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

function UserModal({ user, roles, specialties, mode, onClose, onSave, saving }) {
  const isEdit = !!user && mode === "edit";
  const isView = !!user && mode === "view";
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    username: user?.username || "",
    email: user?.email || "",
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    phone: user?.phone || "",
    gender: user?.gender || "",
    role_id: user?.role_id || "",
    specialty_id: user?.specialty_id || "",
    status: user?.status || "verified",
    password: "",
  }));

  const selectedRoleName = getRoleNameById(roles, form.role_id);
  const isDoctorRole = selectedRoleName === "Doctor";

  const handleChange = (event) => {
    const { name, value } = event.target;
    // Name fields: block invalid characters and auto-capitalize each word live
    // ("kelly celocia" -> "Kelly Celocia"), matching the backend.
    let v = value;
    if (name === "first_name" || name === "last_name" || name === "middle_name") {
      v = value
        .replace(/[^A-Za-zÀ-ÿ.'\- ]/g, "")
        .toLowerCase()
        .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
    }
    setForm((prev) => {
      const next = { ...prev, [name]: v };
      if (name === "role_id" && getRoleNameById(roles, value) !== "Doctor") {
        next.specialty_id = "";
      }
      return next;
    });
    // An error describes the form as it was submitted; editing it clears it.
    setError("");
  };

  const submit = (event) => {
    event.preventDefault();
    setError("");

    if (isEdit) {
      const updates = {};
      if (String(form.role_id) !== String(user.role_id || "")) updates.role_id = Number(form.role_id);
      if (String(form.specialty_id || "") !== String(user.specialty_id || "")) {
        updates.specialty_id = form.specialty_id ? Number(form.specialty_id) : null;
      }
      if (form.status !== user.status) updates.status = form.status;

      if (isDoctorRole && !form.specialty_id) {
        setError("Doctor accounts require a specialty so patients can book correctly.");
        return;
      }

      if (!Object.keys(updates).length) {
        setError("No role, specialty, or status changes detected.");
        return;
      }
      onSave(updates, null);
      return;
    }

    if (!form.username || !form.email || !form.first_name || !form.last_name || !form.role_id || !form.password) {
      setError("Username, email, first name, last name, role, and password are required.");
      return;
    }

    if (isDoctorRole && !form.specialty_id) {
      setError("Doctor accounts require a specialty so patients can book correctly.");
      return;
    }

    const ruleError = newUserError(form);
    if (ruleError) {
      setError(ruleError);
      return;
    }

    onSave(
      {
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || null,
        gender: form.gender || null,
        role_id: Number(form.role_id),
        specialty_id: isDoctorRole && form.specialty_id ? Number(form.specialty_id) : null,
        password: form.password,
      },
      file
    );
  };

  return (
    <div
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(10,20,35,.58)",
        display: "grid",
        placeItems: "center",
        padding: 22,
      }}
    >
      <div style={{ width: "min(720px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
        <div style={{ padding: "18px 22px", background: C.blue, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{isView ? "View User" : isEdit ? "Edit User" : "Add User"}</div>
            <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{user?.email || "Create a backend-synced account"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 8, border: "none", background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "24px 24px 0", background: "#fafbfd", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {error && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "#fff2f4", color: C.danger, border: "1px solid #f7c5cb", fontSize: 13, fontWeight: 700 }}>
              {error}
            </div>
          )}

          {isView ? (
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <UserAvatar user={user} size={76} />
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>{getFullName(user)}</div>
                  <div style={{ color: C.text, marginTop: 4 }}>{user.username} / {user.email}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
                <ReadOnly label="Role" value={user.role || "Unassigned"} />
                <ReadOnly label="Specialty" value={user.specialty_name || (user.role === "Doctor" ? "Not assigned" : "Not applicable")} />
                <ReadOnly label="Status" value={statusLabel(user.status).label} />
                <ReadOnly label="Phone" value={user.phone || "Not set"} />
                <ReadOnly label="Gender" value={user.gender || "Not set"} />
                <ReadOnly label="Joined" value={formatDate(user.created_at, true)} />
                <ReadOnly label="Last Login" value={formatDate(user.last_login, true)} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, position: "sticky", bottom: 0, margin: "0 -24px 0", padding: "16px 24px", background: "#fafbfd", borderTop: `1px solid ${C.border}` }}>
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
              {!isEdit && (
                <div style={{ background: "#fff", border: `1px dashed ${C.border}`, borderRadius: 14, padding: 16 }}>
                  <Field label="Profile Photo Optional">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => setFile(event.target.files?.[0] || null)}
                      style={{ ...inputStyle, height: "auto", padding: 10 }}
                    />
                  </Field>
                  {file && <div style={{ fontSize: 12, color: C.text, marginTop: 8 }}>{file.name}</div>}
                </div>
              )}

              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                {!isEdit && (
                  <Field label="Username">
                    <input name="username" value={form.username} onChange={handleChange} style={inputStyle} />
                  </Field>
                )}
                <Field label="First Name">
                  <input name="first_name" value={form.first_name} onChange={handleChange} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.7 : 1 }} />
                </Field>
                <Field label="Last Name">
                  <input name="last_name" value={form.last_name} onChange={handleChange} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.7 : 1 }} />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" value={form.email} onChange={handleChange} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.7 : 1 }} />
                </Field>
                <Field label="Phone">
                  <input name="phone" value={form.phone} onChange={handleChange} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.7 : 1 }} />
                </Field>
                <Field label="Gender">
                  <select name="gender" value={form.gender} onChange={handleChange} disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.7 : 1 }}>
                    <option value="">Not set</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Role">
                  <select name="role_id" value={form.role_id} onChange={handleChange} style={inputStyle}>
                    <option value="">Select role</option>
                    {roles.map((role) => (
                      <option key={role.role_id} value={role.role_id}>{role.role_name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Specialty">
                  <select
                    name="specialty_id"
                    value={form.specialty_id}
                    onChange={handleChange}
                    disabled={!isDoctorRole}
                    style={{ ...inputStyle, opacity: isDoctorRole ? 1 : 0.7 }}
                  >
                    <option value="">{isDoctorRole ? "Select specialty" : "Doctors only"}</option>
                    {specialties.map((specialty) => (
                      <option key={specialty.specialty_id} value={specialty.specialty_id}>
                        {specialty.specialty_name}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: isDoctorRole ? C.warn : C.muted, fontWeight: 700 }}>
                    {isDoctorRole ? "Required for Doctor accounts and patient booking." : "Only Doctor accounts need a specialty."}
                  </div>
                </Field>
                {isEdit && (
                  <Field label="Status">
                    <select name="status" value={form.status} onChange={handleChange} style={inputStyle}>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status.value} value={status.value}>{status.label}</option>
                      ))}
                    </select>
                  </Field>
                )}
                {!isEdit && (
                  <Field label="Initial Password">
                    <input name="password" type="password" value={form.password} onChange={handleChange} style={inputStyle} />
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{PASSWORD_HINT}</div>
                  </Field>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, position: "sticky", bottom: 0, margin: "0 -24px 0", padding: "16px 24px", background: "#fafbfd", borderTop: `1px solid ${C.border}` }}>
                <Button onClick={onClose} disabled={saving}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add User"}</Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnly({ label, value }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>{value}</div>
    </div>
  );
}

function ListTable({ users, currentUserId, onView, onEdit, onRemove }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
        <thead>
          <tr style={{ background: C.soft, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
            <th style={thStyle}>User</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Last Login</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const st = statusLabel(user.status);
            const isCurrentUser = Number(user.user_id) === Number(currentUserId);
            return (
              <tr key={user.user_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td data-label="User" className="qc-td-block" style={tdStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <UserAvatar user={user} size={44} />
                    <div>
                      <div style={{ fontWeight: 900, color: C.navy }}>{user.username || "No username"}</div>
                      <div style={{ fontSize: 12, color: C.text }}>{user.email || "No email"}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Role" style={tdStyle}>{user.role || "Unassigned"}</td>
                <td data-label="Status" style={tdStyle}><Badge bg={st.bg} color={st.color}>{st.label}</Badge></td>
                <td data-label="Phone" style={tdStyle}>{user.phone || "Not set"}</td>
                <td data-label="Last Login" style={tdStyle}>{formatDate(user.last_login, true)}</td>
                <td data-label="Actions" className="qc-td-block" style={{ ...tdStyle, textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <Button onClick={() => onView(user)}>View</Button>
                    <Button onClick={() => onEdit(user)} disabled={isCurrentUser}>Edit</Button>
                    <Button variant="danger" onClick={() => onRemove(user)} disabled={isCurrentUser || user.status === "deactivated"}>Deactivate</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "12px 14px", fontWeight: 900 };
const tdStyle = { padding: "13px 14px", color: C.text, fontSize: 13, verticalAlign: "middle" };

export default function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not look like an empty directory: keep the error, and
  // remember whether any data has loaded so stats/list can say "unknown".
  const [loadError, setLoadError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("recent-desc");
  const [viewMode, setViewMode] = useState("grid");
  const [modal, setModal] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const itemsPerPage = 8;

  // Each toast replaces the previous one, and its timer with it — otherwise an
  // older toast's timer hides a newer toast (e.g. a warning) seconds early.
  const alertTimer = useRef(null);
  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.clearTimeout(alertTimer.current);
    alertTimer.current = window.setTimeout(() => setAlert(null), type === "warn" ? 9000 : 4200);
  }, []);
  useEffect(() => () => window.clearTimeout(alertTimer.current), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersResponse, rolesResponse, specialtiesResponse] = await Promise.all([
        authFetch("/users"),
        authFetch("/users/roles"),
        authFetch("/queue/specialties"),
      ]);
      const usersData = await parseApiResponse(usersResponse);
      const rolesData = await parseApiResponse(rolesResponse);
      const specialtiesData = await parseApiResponse(specialtiesResponse);
      setUsers(Array.isArray(usersData.data) ? usersData.data : []);
      setRoles(Array.isArray(rolesData.data) ? rolesData.data : []);
      setSpecialties(Array.isArray(specialtiesData.data) ? specialtiesData.data : specialtiesData.specialties || []);
      setHasLoaded(true);
      setLoadError("");
    } catch (error) {
      console.error("Manage users load error:", error);
      setLoadError(friendlyError(error, "Failed to load users."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentUserId(getCurrentUserId());
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const byRole = roles.reduce((acc, role) => {
      acc[role.role_name] = users.filter((user) => user.role === role.role_name).length;
      return acc;
    }, {});
    return {
      total: users.length,
      active: users.filter((user) => user.status === "verified").length,
      locked: users.filter((user) => user.status === "locked").length,
      deactivated: users.filter((user) => user.status === "deactivated").length,
      medical: (byRole.Doctor || 0) + (byRole.Nurse || 0),
    };
  }, [users, roles]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users
      .filter((user) => {
        const roleMatches = roleFilter === "All" || user.role === roleFilter;
        const statusMatches = statusFilter === "all" || user.status === statusFilter;
        const searchMatches = !query || [
          user.username,
          user.email,
          user.first_name,
          user.last_name,
          user.phone,
          user.gender,
          user.role,
        ].some((value) => String(value || "").toLowerCase().includes(query));
        return roleMatches && statusMatches && searchMatches;
      })
      .sort((a, b) => {
        if (sortBy === "name-asc") return getFullName(a).localeCompare(getFullName(b));
        if (sortBy === "name-desc") return getFullName(b).localeCompare(getFullName(a));
        if (sortBy === "role-asc") return String(a.role || "").localeCompare(String(b.role || ""));
        if (sortBy === "recent-asc") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  }, [users, roleFilter, statusFilter, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / itemsPerPage));
  const page = Math.min(currentPage, totalPages);
  const pageUsers = filteredUsers.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const resetPage = () => setCurrentPage(1);

  const handleSave = async (payload, profileFile) => {
    setSaving(true);
    try {
      if (modal?.user) {
        const hasRoleUpdate = Object.prototype.hasOwnProperty.call(payload, "role_id");
        const hasSpecialtyUpdate = Object.prototype.hasOwnProperty.call(payload, "specialty_id");
        const nextRoleName = hasRoleUpdate ? getRoleNameById(roles, payload.role_id) : modal.user.role;

        const updateRole = async () => {
          if (!hasRoleUpdate) return;
          await parseApiResponse(await authFetch(`/users/${modal.user.user_id}/role`, {
            method: "PATCH",
            body: JSON.stringify({ role_id: payload.role_id }),
          }));
        };

        const updateSpecialty = async () => {
          if (!hasSpecialtyUpdate) return;
          await parseApiResponse(await authFetch(`/users/${modal.user.user_id}/details`, {
            method: "PATCH",
            body: JSON.stringify({ specialty_id: payload.specialty_id }),
          }));
        };

        if (hasRoleUpdate && nextRoleName !== "Doctor") {
          await updateRole();
          await updateSpecialty();
        } else {
          await updateSpecialty();
          await updateRole();
        }

        if (payload.status) {
          await parseApiResponse(await authFetch(`/users/${modal.user.user_id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: payload.status }),
          }));
        }
        showAlert("ok", "User updated successfully");
      } else {
        const created = await parseApiResponse(await authFetch("/users", {
          method: "POST",
          body: JSON.stringify(payload),
        }));
        const createdUserId = created.data?.user_id;
        // The account exists from here on. A failed photo upload is a partial
        // success: close the form and list the new user, and say only the photo
        // failed — reporting it as a failed save made admins create the account
        // again under another username.
        let photoError = null;
        if (profileFile && createdUserId) {
          try {
            await uploadProfilePhoto(createdUserId, profileFile);
          } catch (uploadError) {
            photoError = friendlyError(uploadError, "Upload failed");
          }
        }
        if (photoError) {
          showAlert("warn", `User created, but the profile photo couldn't be uploaded (${photoError}). The user can add a photo later from Profile Settings.`);
        } else {
          showAlert("ok", profileFile ? "User and profile photo created successfully" : "User created successfully");
        }
      }

      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Manage users save error:", error);
      showAlert("err", friendlyError(error, "Failed to save user"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (user) => {
    setConfirm({
      title: "Deactivate User",
      message: `Deactivate "${user.username}"? This keeps the audit trail and blocks access.`,
      confirmText: "Deactivate",
      tone: "danger",
      onConfirm: () => doRemove(user),
    });
  };

  const doRemove = async (user) => {
    try {
      await parseApiResponse(await authFetch(`/users/${user.user_id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "deactivated" }),
      }));
      showAlert("ok", "User deactivated successfully");
      await loadData();
    } catch (error) {
      console.error("Manage users remove error:", error);
      showAlert("err", friendlyError(error, "Failed to deactivate user"));
    }
  };

  return (
    <MainLayout>
      {alert && (
        <div style={{
          position: "fixed",
          top: 22,
          right: 22,
          zIndex: 700,
          padding: "12px 16px",
          borderRadius: 12,
          maxWidth: "min(440px, calc(100vw - 44px))",
          background: alert.type === "ok" ? "#eaf8f0" : alert.type === "warn" ? C.amberL : "#fff2f4",
          color: alert.type === "ok" ? C.ok : alert.type === "warn" ? C.amber : C.danger,
          border: `1px solid ${alert.type === "ok" ? "#b8e5cc" : alert.type === "warn" ? "#f2d9a8" : "#f7c5cb"}`,
          boxShadow: "0 8px 24px rgba(15,23,42,.16)",
          fontSize: 13,
          fontWeight: 800,
        }} role={alert.type === "ok" ? "status" : "alert"}>
          {alert.message}
        </div>
      )}

      {/* Load failure: persistent, with Retry — distinct from an empty directory. */}
      {loadError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16, padding: "11px 14px", background: C.amberL, border: "1px solid #f2d9a8", borderRadius: 12, color: C.amber, fontSize: 13, fontWeight: 700 }}>
          <span>{hasLoaded ? `Could not refresh users. ${loadError} The list below may be out of date.` : `Could not load users. ${loadError}`}</span>
          <button onClick={loadData} disabled={loading} style={{ background: "#fff", border: "1px solid #f2d9a8", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 800, color: C.amber, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, fontFamily: "inherit" }}>
            {loading ? "Retrying..." : "Retry"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: C.text, fontSize: 13 }}>Backend-synced account directory, roles, statuses, and profile photos.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ExportMenu
            filename="qelcare-users"
            title="QELCare User Directory"
            subtitle={`${filteredUsers.length} user${filteredUsers.length === 1 ? "" : "s"} matching the current filters`}
            sheetTitle="Users"
            columns={EXPORT_COLUMNS}
            rows={filteredUsers}
            disabled={loading || !hasLoaded}
          />
          <Button onClick={loadData} disabled={loading}>Refresh</Button>
          <Button variant="primary" onClick={() => setModal({ mode: "create", user: null })}>Add User</Button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginBottom: 18 }}>
        {[
          { label: "Total Users", value: stats.total, sub: hasLoaded ? `${stats.active} active` : "Not loaded", color: C.blue },
          { label: "Medical Staff", value: stats.medical, sub: "Doctors and nurses", color: C.blue2 },
          { label: "Locked", value: stats.locked, sub: "Needs admin review", color: C.danger },
          { label: "Deactivated", value: stats.deactivated, sub: "Access blocked", color: "#666" },
        ].map((item) => (
          <div key={item.label} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 2px 10px rgba(15,23,42,.05)" }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em" }}>{item.label}</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: item.color, marginTop: 8 }}>{loading || !hasLoaded ? "-" : item.value}</div>
            <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{item.sub}</div>
          </div>
        ))}
      </section>

      <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.border}`, background: "linear-gradient(to right,#f8fafd,#fff)", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) repeat(3,minmax(150px,1fr)) auto", gap: 10, alignItems: "center" }}>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); resetPage(); }}
              placeholder="Search users, email, phone, role..."
              style={inputStyle}
            />
            <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); resetPage(); }} style={inputStyle}>
              <option value="All">All Roles</option>
              {roles.map((role) => <option key={role.role_id} value={role.role_name}>{role.role_name}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); resetPage(); }} style={inputStyle}>
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={inputStyle}>
              <option value="recent-desc">Newest First</option>
              <option value="recent-asc">Oldest First</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="role-asc">Role A-Z</option>
            </select>
            <div style={{ display: "flex", gap: 6, background: C.soft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
              <Button variant={viewMode === "grid" ? "primary" : "secondary"} onClick={() => setViewMode("grid")}>Grid</Button>
              <Button variant={viewMode === "list" ? "primary" : "secondary"} onClick={() => setViewMode("list")}>List</Button>
            </div>
          </div>
          {hasLoaded && (
            <div style={{ color: C.text, fontSize: 12, fontWeight: 700 }}>
              Showing {pageUsers.length} of {filteredUsers.length} matched user{filteredUsers.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div style={{ padding: 18 }}>
          {loading ? (
            <div style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>Loading users...</div>
          ) : !hasLoaded ? (
            <div style={{ padding: 36, textAlign: "center" }}>
              <div style={{ color: C.navy, fontSize: 16, fontWeight: 900 }}>Users couldn't be loaded</div>
              <div style={{ color: C.text, fontSize: 13, marginTop: 5 }}>This is a connection or server problem, not an empty directory. Use Retry above.</div>
            </div>
          ) : pageUsers.length === 0 ? (
            <div style={{ padding: 36, textAlign: "center", color: C.text, fontWeight: 800 }}>No users match the current filters.</div>
          ) : viewMode === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
              {pageUsers.map((user) => (
                <UserCard
                  key={user.user_id}
                  user={user}
                  currentUserId={currentUserId}
                  onView={(selected) => setModal({ mode: "view", user: selected })}
                  onEdit={(selected) => setModal({ mode: "edit", user: selected })}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          ) : (
            <ListTable
              users={pageUsers}
              currentUserId={currentUserId}
              onView={(selected) => setModal({ mode: "view", user: selected })}
              onEdit={(selected) => setModal({ mode: "edit", user: selected })}
              onRemove={handleRemove}
            />
          )}
        </div>

        {!loading && hasLoaded && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredUsers.length}
            pageSize={itemsPerPage}
            onPageChange={setCurrentPage}
            label="users"
          />
        )}
      </section>

      {modal && (
        <UserModal
          user={modal.user}
          mode={modal.mode}
          roles={roles}
          specialties={specialties}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={handleSave}
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
