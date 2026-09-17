import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import { API_URL, authFetch, getUserRole, logout } from "../../../utils/auth";

const EMPTY_PROFILE = {
  first_name: "",
  last_name: "",
  middle_name: "",
  suffix: "",
  email: "",
  phone: "",
  alternate_phone: "",
  gender: "",
  date_of_birth: "",
  region_code: "",
  province_code: "",
  municipality_code: "",
  barangay_code: "",
  address_line: "",
};

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
];

const GENDERS = ["Male", "Female", "Other"];

function fullName(user) {
  const value = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return value || user?.username || "User";
}

function initials(name) {
  return String(name || "U").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeImageUrl(url, version) {
  if (!url) return "";
  const value = String(url).trim();
  if (!value) return "";
  const absolute = value.startsWith("http") ? value : `${API_URL}${value.startsWith("/") ? "" : "/"}${value}`;
  const separator = absolute.includes("?") ? "&" : "?";
  return `${absolute}${separator}v=${version}`;
}

function mapProfileToForm(profile) {
  return {
    first_name: profile?.first_name || "",
    last_name: profile?.last_name || "",
    middle_name: profile?.middle_name || "",
    suffix: profile?.suffix || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
    alternate_phone: profile?.alternate_phone || "",
    gender: profile?.gender || "",
    date_of_birth: profile?.date_of_birth || "",
    region_code: profile?.region_code || "",
    province_code: profile?.province_code || "",
    municipality_code: profile?.municipality_code || "",
    barangay_code: profile?.barangay_code || "",
    address_line: profile?.address_line || "",
  };
}

function syncStoredUser(profile) {
  try {
    const stored = JSON.parse(localStorage.getItem("user") || "{}");
    localStorage.setItem(
      "user",
      JSON.stringify({ ...stored,
        user_id: profile.user_id,
        username: profile.username,
        role: profile.role,
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        profile_picture: profile.profile_picture || null,
      })
    );
    window.dispatchEvent(new Event("qelcare:user-updated"));
  } catch {
    localStorage.setItem(
      "user",
      JSON.stringify({
        user_id: profile.user_id,
        username: profile.username,
        role: profile.role,
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        profile_picture: profile.profile_picture || null,
      })
    );
  }
}

function Avatar({ user, imageVersion, size = 96 }) {
  const [failed, setFailed] = useState(false);
  const name = fullName(user);
  const src = failed ? "" : normalizeImageUrl(user?.profile_picture, imageVersion);

  useEffect(() => {
    setFailed(false);
  }, [user?.profile_picture, imageVersion]);

  return (
    <div className="ps-avatar" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={`${name} profile`} onError={() => setFailed(true)} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

// App-wide phone rule (matches the backend + registration): PH mobile
// 09XXXXXXXXX, +639XXXXXXXXX, or international +<10-14 digits>. Optional field ->
// empty is valid. Returns an inline error string, or "" when valid.
function validatePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 20) return "Phone must be 20 characters or less.";
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (!/^(09\d{9}|\+639\d{9}|\+\d{10,14})$/.test(cleaned)) {
    return "Enter a valid phone, e.g. 09XXXXXXXXX or +639XXXXXXXXX.";
  }
  return "";
}

function Field({ label, name, value, onChange, type = "text", placeholder = "", disabled = false, error = "", required = false, wide = false }) {
  return (
    <label className={`ps-field${error ? " err" : ""}${wide ? " ps-col-2" : ""}`}>
      <span className="lbl">
        {label}
        {required && <span className="req">*</span>}
      </span>
      <div className="ps-control">
        <input
          type={type}
          name={name}
          value={value || ""}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
        />
      </div>
      {error && (
        <span className="ps-err">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </span>
      )}
    </label>
  );
}

function ReadOnly({ label, value, mono = false }) {
  return (
    <div className="ps-stat">
      <div className="ps-stat-k">{label}</div>
      <div className={`ps-stat-v${mono ? " mono" : ""}`}>{value || "Not recorded"}</div>
    </div>
  );
}

function PasswordInput({ label, name, value, onChange }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="ps-field has-eye">
      <span className="lbl">{label}</span>
      <div className="ps-control">
        <input
          type={visible ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          autoComplete="new-password"
        />
        <button type="button" className="ps-eye" onClick={() => setVisible((current) => !current)}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

const SECTION_ICONS = {
  identity: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" />
    </svg>
  ),
  contact: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
  address: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
};

const TAB_ICONS = {
  profile: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  security: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
};

function SectionHead({ icon, title }) {
  return (
    <div className="ps-section-head">
      <span className="ps-sdot">{SECTION_ICONS[icon]}</span>
      <h4>{title}</h4>
    </div>
  );
}

function passwordChecks(password) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&#]/.test(password),
  };
}

export default function ProfileSettings() {
  const [activeTab, setActiveTab] = useState("profile");
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [alert, setAlert] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [imageVersion, setImageVersion] = useState(Date.now());
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    window.clearTimeout(showAlert.timer);
    showAlert.timer = window.setTimeout(() => setAlert(null), 3500);
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/users/me");
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to load profile.");
      }

      const nextProfile = data.data || null;
      setProfile(nextProfile);
      setForm(mapProfileToForm(nextProfile));
      setImageVersion(Date.now());
      if (nextProfile) syncStoredUser(nextProfile);
    } catch (error) {
      showAlert("error", error.message || "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const displayName = useMemo(() => fullName(profile), [profile]);
  const currentRole = profile?.role || getUserRole() || "User";
  const profileSubtitle = `Manage your ${currentRole.toLowerCase()} account details`;
  const checks = useMemo(() => passwordChecks(passwordForm.newPassword), [passwordForm.newPassword]);
  const passwordValid = Object.values(checks).every(Boolean);
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const meterPct = passwordForm.newPassword ? Math.round((passedChecks / 5) * 100) : 0;
  const meterColor = passedChecks <= 2 ? "#e0574f" : passedChecks <= 4 ? "#e8a13a" : "#25a463";
  const statusValue = profile?.status || "unknown";
  const statusOk = String(statusValue).toLowerCase() === "active";

  function handleFormChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
  }

  function handlePasswordChange(event) {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  }

  async function saveProfile() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      showAlert("error", "First name and last name are required.");
      return;
    }

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      showAlert("error", "Enter a valid email address.");
      return;
    }

    const phoneErr = validatePhone(form.phone);
    const altErr = validatePhone(form.alternate_phone);
    if (phoneErr || altErr) {
      setFieldErrors({ phone: phoneErr, alternate_phone: altErr });
      showAlert("error", phoneErr || altErr);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const res = await authFetch("/users/me", {
        method: "PUT",
        body: JSON.stringify({ ...form,
          email: form.email.trim().toLowerCase(),
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to save profile.");
      }

      const updated = data.data;
      setProfile(updated);
      setForm(mapProfileToForm(updated));
      syncStoredUser(updated);
      setEditing(false);
      showAlert("success", "Profile updated.");
    } catch (error) {
      showAlert("error", error.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadProfilePicture(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      showAlert("error", "Only JPG, PNG, and WEBP images are allowed.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showAlert("error", "Profile image must be 5MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("profilePicture", file);

      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/users/profile-picture`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Upload failed.");
      }

      const nextProfile = { ...profile,
        profile_picture: data.url || data.data?.profile_picture,
      };
      setProfile(nextProfile);
      setImageVersion(Date.now());
      syncStoredUser(nextProfile);
      await loadProfile();
      showAlert("success", "Profile picture updated.");
    } catch (error) {
      showAlert("error", error.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function changePassword() {
    if (!passwordForm.currentPassword) {
      showAlert("error", "Current password is required.");
      return;
    }
    if (!passwordValid) {
      showAlert("error", "New password does not meet the requirements.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showAlert("error", "New password and confirmation do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await authFetch("/auth/password/change", {
        method: "POST",
        // Don't let a business 401 (e.g. wrong current password) trigger the global
        // auth-expiry redirect — we want to show the error and keep the user here.
        noAuthRedirect: true,
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Password change failed.");
      }

      // Only reached when the current password verified AND the new hash was saved.
      showAlert("success", "Password changed. Please sign in again.");
      window.setTimeout(() => logout(), 1200);
    } catch (error) {
      showAlert("error", error.message || "Password change failed.");
    } finally {
      setPasswordSaving(false);
    }
  }

  function cancelEdit() {
    setForm(mapProfileToForm(profile));
    setEditing(false);
  }

  return (
    <MainLayout pageTitle="Profile Settings" pageSubtitle={profileSubtitle}>
      <div className="ps-page">
        {alert && (
          <div className={`ps-toast ${alert.type}`}>
            <span className="ps-toast-dot" />
            {alert.message}
          </div>
        )}

        {/* Hero */}
        <section className="ps-card ps-hero">
          <div className="ps-hero-cover" />
          <div className="ps-hero-body">
            <div className="ps-id">
              <div className="ps-avatar-wrap">
                <Avatar user={profile} imageVersion={imageVersion} />
                <label className={`ps-camera ${uploading ? "disabled" : ""}`} title="Upload profile photo">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProfilePicture} disabled={uploading} />
                </label>
              </div>
              <div className="ps-idtext">
                <h2>{loading ? "Loading..." : displayName}</h2>
                <div className="ps-email">{profile?.email || "No email recorded"}</div>
                <div className="ps-chips">
                  <span className="role">{profile?.role || "User"}</span>
                  <span className={`status ${statusOk ? "ok" : "warn"}`}>{statusValue}</span>
                  {profile?.specialty_name && <span className="extra">{profile.specialty_name}</span>}
                </div>
              </div>
            </div>
            <div className="ps-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {TAB_ICONS[tab.id]}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {activeTab === "profile" && (
          <section className="ps-card ps-panel">
            <div className="ps-panel-head">
              <div className="ps-htitle">
                <span className="ps-hicon">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <div>
                  <h3>Personal Information</h3>
                  <p>Synced with your account record and admin user list.</p>
                </div>
              </div>
              {!editing ? (
                <div className="ps-actions">
                  <button type="button" className="ps-btn primary" onClick={() => setEditing(true)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit Profile
                  </button>
                </div>
              ) : (
                <div className="ps-actions">
                  <button type="button" className="ps-btn ghost" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className="ps-btn primary" onClick={saveProfile} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </div>

            <div className="ps-body">
              <div className="ps-section">
                <SectionHead icon="identity" title="Identity" />
                <div className="ps-grid">
                  <Field label="First Name" name="first_name" value={form.first_name} onChange={handleFormChange} disabled={!editing} required />
                  <Field label="Last Name" name="last_name" value={form.last_name} onChange={handleFormChange} disabled={!editing} required />
                  <Field label="Middle Name" name="middle_name" value={form.middle_name} onChange={handleFormChange} disabled={!editing} />
                  <Field label="Suffix" name="suffix" value={form.suffix} onChange={handleFormChange} disabled={!editing} placeholder="Jr., Sr., III" />
                  <label className="ps-field">
                    <span className="lbl">Gender</span>
                    <div className="ps-control">
                      <select name="gender" value={form.gender || ""} onChange={handleFormChange} disabled={!editing}>
                        <option value="">Not set</option>
                        {GENDERS.map((gender) => (
                          <option key={gender} value={gender}>
                            {gender}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <Field label="Date of Birth" name="date_of_birth" value={form.date_of_birth} onChange={handleFormChange} disabled={!editing} type="date" />
                </div>
              </div>

              <div className="ps-section">
                <SectionHead icon="contact" title="Contact" />
                <div className="ps-grid">
                  <Field label="Email" name="email" value={form.email} onChange={handleFormChange} disabled={!editing} type="email" wide />
                  <Field label="Phone" name="phone" value={form.phone} onChange={handleFormChange} disabled={!editing} error={fieldErrors.phone} placeholder="09XXXXXXXXX" />
                  <Field label="Alternate Phone" name="alternate_phone" value={form.alternate_phone} onChange={handleFormChange} disabled={!editing} error={fieldErrors.alternate_phone} placeholder="Optional" />
                </div>
              </div>

              <div className="ps-section">
                <SectionHead icon="address" title="Address" />
                <div className="ps-grid">
                  <Field label="Address Line" name="address_line" value={form.address_line} onChange={handleFormChange} disabled={!editing} wide />
                  <Field label="Region Code" name="region_code" value={form.region_code} onChange={handleFormChange} disabled={!editing} />
                  <Field label="Province Code" name="province_code" value={form.province_code} onChange={handleFormChange} disabled={!editing} />
                  <Field label="Municipality Code" name="municipality_code" value={form.municipality_code} onChange={handleFormChange} disabled={!editing} />
                  <Field label="Barangay Code" name="barangay_code" value={form.barangay_code} onChange={handleFormChange} disabled={!editing} />
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "security" && (
          <div className="ps-security">
            <section className="ps-card ps-panel">
              <div className="ps-panel-head">
                <div className="ps-htitle">
                  <span className="ps-hicon">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </span>
                  <div>
                    <h3>Account Status</h3>
                    <p>Live account security fields from the backend.</p>
                  </div>
                </div>
              </div>
              <div className="ps-status-grid">
                <ReadOnly label="Username" value={profile?.username} />
                <ReadOnly label="Role" value={profile?.role} />
                <ReadOnly label="Status" value={profile?.status} />
                <ReadOnly label="User ID" value={profile?.user_id ? `#${profile.user_id}` : ""} mono />
                <ReadOnly label="Last Login" value={formatDateTime(profile?.last_login)} mono />
                <ReadOnly label="Password Changed" value={formatDateTime(profile?.password_changed_at)} mono />
                <ReadOnly label="Email Changed" value={formatDateTime(profile?.email_changed_at)} mono />
                <ReadOnly label="Failed Login Attempts" value={String(profile?.failed_login_attempts || 0)} mono />
                <ReadOnly label="Lockout Until" value={formatDateTime(profile?.lockout_until)} mono />
                <ReadOnly label="Created" value={formatDateTime(profile?.created_at)} mono />
              </div>
            </section>

            <section className="ps-card ps-panel">
              <div className="ps-panel-head">
                <div className="ps-htitle">
                  <span className="ps-hicon">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <div>
                    <h3>Change Password</h3>
                    <p>You will be logged out after a successful password change.</p>
                  </div>
                </div>
              </div>
              <div className="ps-pass-form">
                <PasswordInput label="Current Password" name="currentPassword" value={passwordForm.currentPassword} onChange={handlePasswordChange} />
                <PasswordInput label="New Password" name="newPassword" value={passwordForm.newPassword} onChange={handlePasswordChange} />
                <div className="ps-meter" aria-hidden="true">
                  <i style={{ width: `${meterPct}%`, background: meterColor }} />
                </div>
                <div className="ps-checks">
                  {[
                    ["length", "8+ characters"],
                    ["uppercase", "Uppercase"],
                    ["lowercase", "Lowercase"],
                    ["number", "Number"],
                    ["special", "Special character"],
                  ].map(([key, label]) => (
                    <span key={key} className={checks[key] ? "ok" : ""}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {label}
                    </span>
                  ))}
                </div>
                <PasswordInput label="Confirm New Password" name="confirmPassword" value={passwordForm.confirmPassword} onChange={handlePasswordChange} />
                <button type="button" className="ps-btn primary wide" onClick={changePassword} disabled={passwordSaving}>
                  {passwordSaving ? "Updating..." : "Update Password"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      <style>{`
.ps-page {
  --nv: #153a6b;
  --nv-deep: #0f2744;
  --teal: #1f7a6f;
  --ink: #14243b;
  --muted: #5c6c81;
  --line: #e5edf6;
  --field-line: #dbe4ef;
  --bg-soft: #f5f8fc;
  --danger: #b4323f;
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: var(--ink);
}

.ps-toast {
  position: sticky;
  top: 8px;
  z-index: 20;
  align-self: flex-end;
  max-width: 440px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13.5px;
  font-weight: 700;
  border: 1px solid;
  box-shadow: 0 14px 34px -14px rgba(15, 39, 68, 0.45);
}
.ps-toast.success { background: #effaf3; border-color: #bfe6cd; color: #137a4b; }
.ps-toast.error { background: #fef1f1; border-color: #f6ced0; color: #b4323f; }
.ps-toast-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }

.ps-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 1px 2px rgba(16, 40, 68, 0.04), 0 14px 34px -22px rgba(16, 40, 68, 0.28);
}

.ps-hero { overflow: hidden; position: relative; }
.ps-hero-cover {
  height: 104px;
  background:
    radial-gradient(120% 180% at 12% -30%, rgba(31, 122, 111, 0.85), transparent 55%),
    linear-gradient(115deg, #0f2744 0%, #163a6b 52%, #1f6f76 100%);
}
.ps-hero-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 0 26px 22px;
  margin-top: -46px;
  flex-wrap: wrap;
}
.ps-id { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; min-width: 0; flex: 1 1 auto; }
.ps-avatar-wrap { position: relative; flex: 0 0 auto; }
.ps-avatar {
  border-radius: 24px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(140deg, #153a6b, #1f7a6f);
  color: #fff;
  font-weight: 800;
  font-size: 30px;
  letter-spacing: 0.5px;
  border: 4px solid #fff;
  box-shadow: 0 10px 24px -10px rgba(15, 39, 68, 0.55);
}
.ps-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-camera {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: #153a6b;
  color: #fff;
  border: 3px solid #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 4px 12px -4px rgba(15, 39, 68, 0.6);
}
.ps-camera:hover { background: #1f4f8f; }
.ps-camera.disabled { opacity: 0.55; cursor: not-allowed; }
.ps-camera input { display: none; }
.ps-idtext { min-width: 0; max-width: 100%; }
.ps-idtext h2 {
  margin: 0;
  font-size: 23px;
  font-weight: 800;
  letter-spacing: -0.2px;
  color: var(--nv-deep);
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.ps-email { margin: 3px 0 10px; font-size: 13.5px; color: var(--muted); overflow-wrap: anywhere; }
.ps-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.ps-chips span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
}
.ps-chips .role { background: #e9eefb; color: #26417a; }
.ps-chips .status { background: #eef3f8; color: #566579; }
.ps-chips .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ps-chips .status.ok { background: #e7f7ee; color: #137a4b; }
.ps-chips .status.ok::before { background: #25a463; }
.ps-chips .status.warn { background: #fdf0e6; color: #a2621f; }
.ps-chips .status.warn::before { background: #d9832b; }
.ps-chips .extra { background: #eef3f8; color: #3d5168; }

.ps-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 5px;
  border-radius: 13px;
  background: #eef2f8;
  border: 1px solid #e3eaf4;
  flex: 0 0 auto;
}
.ps-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  padding: 0 18px;
  cursor: pointer;
}
.ps-tabs button:hover { color: var(--nv); }
.ps-tabs button.active { background: #fff; color: var(--nv-deep); box-shadow: 0 2px 8px -3px rgba(15, 39, 68, 0.25); }

.ps-panel { overflow: hidden; }
.ps-panel-head {
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.ps-htitle { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ps-hicon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: #eaf0fb;
  color: #26417a;
}
.ps-panel-head h3 { margin: 0; font-size: 16.5px; font-weight: 800; color: var(--nv-deep); }
.ps-panel-head p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.ps-actions { display: flex; gap: 10px; flex: 0 0 auto; }

.ps-btn {
  height: 40px;
  border-radius: 11px;
  padding: 0 18px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ps-btn.primary {
  border: 1px solid var(--nv);
  background: linear-gradient(180deg, #1c4a86, #153a6b);
  color: #fff;
  box-shadow: 0 8px 18px -10px rgba(21, 58, 107, 0.9);
}
.ps-btn.ghost { border: 1px solid var(--field-line); background: #fff; color: var(--nv); }
.ps-btn.ghost:hover { background: #f6f9fd; }
.ps-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ps-btn.wide { width: 100%; height: 46px; justify-content: center; font-size: 14px; }

.ps-body { padding: 8px 24px 24px; display: flex; flex-direction: column; }
.ps-section { padding: 20px 0; border-bottom: 1px dashed var(--line); }
.ps-section:last-child { border-bottom: 0; padding-bottom: 6px; }
.ps-section-head { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; }
.ps-sdot {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #e7f4f1;
  color: #1f7a6f;
  flex: 0 0 auto;
}
.ps-section-head h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #42566d;
}

.ps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(232px, 1fr)); gap: 18px; }
.ps-col-2 { grid-column: span 2; }

.ps-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.ps-field > .lbl { font-size: 12.5px; font-weight: 700; color: #48596e; display: flex; align-items: center; gap: 5px; }
.ps-field > .lbl .req { color: #d0433f; font-weight: 800; }
.ps-control { position: relative; }
.ps-field input,
.ps-field select {
  width: 100%;
  height: 46px;
  border: 1.5px solid var(--field-line);
  border-radius: 12px;
  background: #fff;
  color: #16283f;
  font-family: inherit;
  font-size: 14px;
  padding: 0 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.ps-field select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 38px;
  cursor: pointer;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235c6c81' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 13px center;
}
.ps-field input::placeholder { color: #9aa8ba; }
.ps-field input:focus,
.ps-field select:focus { border-color: var(--nv); box-shadow: 0 0 0 4px rgba(21, 58, 107, 0.12); }
.ps-field input:disabled,
.ps-field select:disabled { background: var(--bg-soft); border-color: #e8eef6; color: #3f5168; cursor: default; }
.ps-field.err input { border-color: #e6a4a0; background: #fdf6f6; }
.ps-err { font-size: 12px; font-weight: 700; color: var(--danger); display: flex; align-items: center; gap: 5px; }

.ps-security { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr); gap: 20px; align-items: start; }

.ps-status-grid { padding: 20px 24px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.ps-stat {
  border: 1px solid var(--line);
  background: linear-gradient(180deg, #fbfdff, #f6f9fd);
  border-radius: 13px;
  padding: 13px 15px;
  min-width: 0;
}
.ps-stat-k { font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #8493a6; margin-bottom: 6px; }
.ps-stat-v { font-size: 13.5px; font-weight: 700; color: var(--nv-deep); overflow-wrap: anywhere; }
.ps-stat-v.mono { font-variant-numeric: tabular-nums; }

.ps-pass-form { padding: 22px 24px 24px; display: flex; flex-direction: column; gap: 16px; }
.ps-eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--nv);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.ps-eye:hover { background: #eef3fb; }
.ps-field.has-eye input { padding-right: 66px; }
.ps-meter { height: 7px; border-radius: 999px; background: #eaeef4; overflow: hidden; }
.ps-meter i { display: block; height: 100%; width: 0; border-radius: 999px; transition: width 0.25s ease, background 0.25s ease; }
.ps-checks { display: flex; gap: 8px; flex-wrap: wrap; }
.ps-checks span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 11px;
  background: #f1f4f8;
  color: #7c8a9a;
  font-size: 12px;
  font-weight: 700;
}
.ps-checks span svg { opacity: 0.4; }
.ps-checks span.ok { background: #e7f7ee; color: #137a4b; }
.ps-checks span.ok svg { opacity: 1; }

@media (max-width: 920px) {
  .ps-security { grid-template-columns: 1fr; }
  .ps-hero-body { margin-top: -40px; }
}
@media (max-width: 620px) {
  .ps-hero-body { flex-direction: column; align-items: stretch; }
  .ps-tabs { display: flex; }
  .ps-tabs button { flex: 1; justify-content: center; }
  .ps-actions { width: 100%; }
  .ps-actions .ps-btn { flex: 1; justify-content: center; }
  .ps-col-2 { grid-column: auto; }
}
      `}</style>
    </MainLayout>
  );
}
