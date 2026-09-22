import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { logout, getUserRole } from "../../utils/auth";

const Icons = {
  dashboard: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  patients: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  appointments: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  queue: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
  records: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
  reports: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  logs: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  profile: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  logout: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  clinic: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
  nurseQueue: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
  myRecords: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
  medicalResults: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /><path d="M8 9h2" /></svg>,
  billing: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>,
  inquiries: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
};

const NAV_BY_ROLE = {
  Admin: [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard, path: "/admin/dashboard" },
    { id: "users", label: "Users", icon: Icons.users, path: "/admin/users" },
    { id: "patients", label: "Patients", icon: Icons.patients, path: "/admin/patients" },
    { id: "appointments", label: "Appointments", icon: Icons.appointments, path: "/admin/appointments" },
    { id: "inquiries", label: "Inquiries", icon: Icons.inquiries, path: "/admin/inquiries" },
    { id: "queue", label: "Queue", icon: Icons.queue, path: "/admin/queue" },
    { id: "records", label: "Medical Records", icon: Icons.records, path: "/admin/records" },
    { id: "billing", label: "Billing", icon: Icons.billing, path: "/admin/billing" },
    { id: "reports", label: "AI Reports & Analytics", icon: Icons.reports, path: "/admin/reports" },
    { id: "logs", label: "Activity Logs", icon: Icons.logs, path: "/admin/logs" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/admin/profile" },
  ],
  Doctor: [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard, path: "/doctor/dashboard" },
    { id: "appointments", label: "Appointments", icon: Icons.appointments, path: "/doctor/appointments" },
    { id: "medapprovals", label: "Medication Review", icon: Icons.medicalResults, path: "/doctor/medication-approvals" },
    { id: "records", label: "Consultation Records", icon: Icons.records, path: "/doctor/records" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/doctor/profile" },
  ],
  Frontdesk: [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard, path: "/frontdesk/dashboard" },
    { id: "patients", label: "Patients", icon: Icons.patients, path: "/frontdesk/patients" },
    { id: "appointments", label: "Appointments", icon: Icons.appointments, path: "/frontdesk/appointments" },
    { id: "inquiries", label: "Inquiries", icon: Icons.inquiries, path: "/frontdesk/inquiries" },
    { id: "queue", label: "Queue Display", icon: Icons.queue, path: "/lobby/live-queue-display" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/frontdesk/profile" },
  ],
  Nurse: [
    { id: "station", label: "Nurse Dashboard", icon: Icons.nurseQueue, path: "/nurse-station" },
    { id: "appointments", label: "Appointments", icon: Icons.appointments, path: "/nurse/appointments" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/nurse/profile" },
  ],
  Cashier: [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard, path: "/cashier/dashboard" },
    { id: "billing", label: "Billing", icon: Icons.billing, path: "/cashier/billing" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/cashier/profile" },
  ],
  Patient: [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard, path: "/dashboard" },
    { id: "appointments", label: "Appointments", icon: Icons.appointments, path: "/patient/appointments" },
    { id: "myRecords", label: "Consultation Records", icon: Icons.myRecords, path: "/patient/records" },
    { id: "health", label: "Health Records", icon: Icons.medicalResults, path: "/patient/health" },
    { id: "profile", label: "Profile Settings", icon: Icons.profile, path: "/patient/profile" },
  ],
};

const ROLE_LABEL = {
  Admin: "Admin Portal",
  Doctor: "Doctor Portal",
  Frontdesk: "Frontdesk Portal",
  Nurse: "Nurse Portal",
  Cashier: "Cashier Portal",
  Patient: "Patient Portal",
};

export default function Sidebar({ open = true, onNavigate }) {
  const navigate = useNavigate();
  const location = useLocation();
  const role = getUserRole() || "Admin";
  const navItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.Admin;

  const isActive = (path) => {
    if (path === "/patient/appointments") return location.pathname.startsWith("/patient/appointments");
    return location.pathname === path;
  };

  return (
    <aside className={`qc-sidebar${open ? " qc-sidebar--open" : ""}`} style={{
      width: open ? 248 : 68,
      flexShrink: 0,
      background: "linear-gradient(180deg, #0f2744 0%, #163a6b 60%, #1a4580 100%)",
      display: "flex",
      flexDirection: "column",
      transition: "width .22s cubic-bezier(.4,0,.2,1)",
      overflow: "hidden",
      boxShadow: "4px 0 24px rgba(10,20,40,.16)",
      zIndex: 40,
      position: "sticky",
      top: 0,
      height: "100vh",
    }}>
      <div style={{
        padding: open ? "22px 18px 18px" : "22px 14px 18px",
        borderBottom: "1px solid rgba(255,255,255,.08)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
      }}>
        <div style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: "rgba(255,255,255,.12)",
          border: "1px solid rgba(255,255,255,.15)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          color: "#fff",
        }}>
          {Icons.clinic}
        </div>
        {open && (
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>QELCare</div>
            <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, fontWeight: 600, marginTop: 2 }}>
              {ROLE_LABEL[role]}
            </div>
          </div>
        )}
      </div>

      <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
        {open && (
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.35)", letterSpacing: ".08em", padding: "8px 10px 6px", textTransform: "uppercase" }}>
            Navigation
          </div>
        )}
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { navigate(item.path); onNavigate && onNavigate(); }}
              title={!open ? item.label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: open ? "10px 12px" : "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: active
                  ? "linear-gradient(90deg, rgba(255,255,255,.18), rgba(255,255,255,.10))"
                  : "transparent",
                color: active ? "#fff" : "rgba(255,255,255,.62)",
                fontWeight: active ? 700 : 500,
                fontSize: 13.5,
                transition: ".15s ease",
                textAlign: "left",
                width: "100%",
                borderLeft: active ? "3px solid rgba(255,255,255,.7)" : "3px solid transparent",
              }}
              onMouseEnter={(event) => {
                if (!active) event.currentTarget.style.background = "rgba(255,255,255,.08)";
              }}
              onMouseLeave={(event) => {
                if (!active) event.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ flexShrink: 0, display: "flex" }}>{item.icon}</span>
              {open && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: "10px 10px 16px", borderTop: "1px solid rgba(255,255,255,.08)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={logout}
          title={!open ? "Sign Out" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: open ? "10px 12px" : "10px 14px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            background: "rgba(220,60,60,.12)",
            color: "#ff8a8a",
            fontWeight: 600,
            fontSize: 13.5,
            width: "100%",
            transition: ".15s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(220,60,60,.22)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "rgba(220,60,60,.12)";
          }}
        >
          <span style={{ flexShrink: 0, display: "flex" }}>{Icons.logout}</span>
          {open && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}