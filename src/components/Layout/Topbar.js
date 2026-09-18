import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout, getUserRole, authFetch } from "../../utils/auth";

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);
const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ProfileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0.33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const BellIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const PAGE_TITLES = {
  "/admin/dashboard": { title: "Administrator Dashboard", sub: "Overview & quick actions" },
  "/admin/users": { title: "Manage Users", sub: "View and control all accounts" },
  "/admin/patients": { title: "Patient Management", sub: "Patient records and info" },
  "/admin/appointments": { title: "Appointment Management", sub: "Schedule and manage visits" },
  "/admin/queue": { title: "Queue Management", sub: "Monitor active queues" },
  "/admin/records": { title: "Medical Records", sub: "Patient documents and history" },
  "/admin/reports": { title: "Reports & Analytics", sub: "System analytics and reports" },
  "/admin/logs": { title: "Activity Logs", sub: "Recent administrative activity" },
  "/admin/profile": { title: "Profile Settings", sub: "Your account preferences" },
  "/nurse-station": { title: "Nurse Dashboard", sub: "Patient vitals and queue" },
  "/doctor/dashboard": { title: "Doctor Dashboard", sub: "Queued patients and consultation records" },
  "/frontdesk/dashboard": { title: "Frontdesk Dashboard", sub: "Confirm appointments and check-ins" },
  "/frontdesk/appointments": { title: "Frontdesk Appointments", sub: "Confirm, reschedule, and cancel active visits" },
  "/dashboard": { title: "Patient Dashboard", sub: "Your health overview" },
  "/patient/appointments": { title: "Appointments", sub: "Upcoming visits, history, and booking" },
};

const PROFILE_PATH = {
  Admin: "/admin/profile",
  Doctor: "/doctor/profile",
  Frontdesk: "/frontdesk/profile",
  Nurse: "/nurse/profile",
  Cashier: "/cashier/profile",
  Patient: "/patient/profile",
};

function Avatar({ name, size = 36, fontSize = 13 }) {
  const initials = name
    ? name.split(" ").map((word) => word[0]).join("").toUpperCase().slice(0, 2)
    : "U";
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "linear-gradient(135deg, #25549a, #0f2744)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function getRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.notifications)) return payload.notifications;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

async function safeJson(response) {
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Always render notification times in the clinic's timezone (Asia/Manila) so a
// device with a different/incorrect timezone can't skew what staff see. The API
// now returns correct absolute instants, so this just anchors the display.
function formatStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Appointment notifications are delivered to whoever booked the visit — which
// may be the patient or the staff member who booked for them. Route the click
// to an appointments page the CURRENT user can actually open, so it never hits
// the patient-only route and shows "Access Denied".
const APPT_ROUTE_BY_ROLE = {
  Admin: "/admin/appointments",
  Frontdesk: "/frontdesk/appointments",
  Doctor: "/doctor/appointments",
  Nurse: "/nurse/appointments",
  Cashier: "/cashier/dashboard",
  Patient: "/patient/appointments",
};

function resolveNotificationLink(item, role) {
  const link = item?.link || "";
  const isAppointment = Boolean(item?.appointment_id) || /\/appointments(\/|\?|$)/.test(link);
  if (isAppointment) {
    return APPT_ROUTE_BY_ROLE[role] || link || "/redirect";
  }
  return link;
}

function NotificationItem({ item, onOpen }) {
  const unread = !item.is_read;
  const tone = unread
    ? { color: "#163a6b", bg: "#eef3fb", dot: "#163a6b" }
    : { color: "#66778a", bg: "#f5f7fa", dot: "#aab6c4" };

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={{
        width: "100%",
        border: "none",
        background: "transparent",
        padding: "10px 12px",
        display: "grid",
        gridTemplateColumns: "10px 1fr",
        gap: 10,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 10,
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = "#f6f9ff"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: tone.dot, marginTop: 5 }} />
      <span>
        <span style={{ display: "block", color: "#0f2744", fontSize: 13, fontWeight: unread ? 900 : 700 }}>{item.title}</span>
        <span style={{ display: "block", color: "#66778a", fontSize: 12, lineHeight: 1.4, marginTop: 3 }}>{item.message}</span>
        <span style={{ display: "inline-flex", marginTop: 7, padding: "3px 7px", borderRadius: 999, color: tone.color, background: tone.bg, fontSize: 10.5, fontWeight: 900 }}>
          {unread ? "Unread" : "Read"} {formatStamp(unread ? item.created_at : (item.read_at || item.created_at))}
        </span>
      </span>
    </button>
  );
}

export default function Topbar({ sideOpen, onToggle, pageTitle, pageSubtitle }) {
  const navigate = useNavigate();
  const [dropOpen, setDropOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [user, setUser] = useState(null);
  const dropRef = useRef(null);
  const notifRef = useRef(null);
  const role = getUserRole() || "Admin";

  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    setNotifError("");
    try {
      const response = await authFetch("/notifications/me?limit=30");
      const payload = await safeJson(response);
      if (!response?.ok) throw new Error(payload?.message || "Notifications unavailable.");
      setNotifications(getRows(payload));
      setUnreadCount(Number(payload?.unread_count || 0));
    } catch (err) {
      setNotifError(err.message || "Notifications unavailable.");
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) setUser(JSON.parse(stored));
    const handleClick = (event) => {
      if (dropRef.current && !dropRef.current.contains(event.target)) setDropOpen(false);
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 60000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  async function openNotification(item) {
    if (!item?.id) return;
    if (!item.is_read) {
      try {
        const response = await authFetch(`/notifications/${item.id}/read`, { method: "PATCH" });
        const payload = await safeJson(response);
        if (response?.ok) {
          setUnreadCount(Number(payload?.unread_count || Math.max(unreadCount - 1, 0)));
          setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
        }
      } catch {
        setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
        setUnreadCount((count) => Math.max(count - 1, 0));
      }
    }
    const target = resolveNotificationLink(item, role);
    if (target) {
      setNotifOpen(false);
      navigate(target);
    }
  }

  async function markAllRead() {
    try {
      const response = await authFetch("/notifications/read-all", { method: "PATCH" });
      if (response?.ok) {
        setUnreadCount(0);
        setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      }
    } catch {
      setNotifError("Unable to mark all notifications read.");
    }
  }

  const fullName = user ? `${user.first_name} ${user.last_name}` : role;
  const location = window.location.pathname;
  const page = PAGE_TITLES[location] || { title: pageTitle || "Dashboard", sub: pageSubtitle || today };
  const topNotification = useMemo(() => notifications.find((item) => !item.is_read), [notifications]);
  // The bell shows only unread notifications: once an item is read — by opening
  // it or via "Read all" — it leaves the panel, matching the unread badge. The
  // row is retained in the DB (never hard-deleted), so a dedicated history view
  // could surface it later if needed.
  const visibleNotifications = useMemo(
    () => notifications.filter((item) => !item.is_read),
    [notifications]
  );

  return (
    <header className="qc-topbar" style={{
      height: 64,
      background: "#fff",
      borderBottom: "1px solid #e8eef6",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      gap: 16,
      position: "sticky",
      top: 0,
      zIndex: 30,
      boxShadow: "0 1px 8px rgba(15,23,42,.05)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={onToggle}
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            border: "1px solid #e8eef6",
            background: "#f8fafd",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            color: "#163a6b",
            flexShrink: 0,
            transition: ".15s",
          }}
        >
          <MenuIcon />
        </button>

        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f2744", lineHeight: 1.2 }}>
            {page.title}
          </div>
          <div style={{ fontSize: 11.5, color: "#8a97a8", marginTop: 1 }}>{page.sub || today}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {topNotification && (
          <button
            type="button"
            className="qc-hide-sm"
            onClick={() => openNotification(topNotification)}
            style={{
              border: "1px solid #d8e5f8",
              background: "#eef3fb",
              color: "#163a6b",
              borderRadius: 999,
              height: 32,
              padding: "0 11px",
              maxWidth: 260,
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={topNotification.message}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#163a6b", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{topNotification.title}</span>
          </button>
        )}

        <div style={{ position: "relative" }} ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((value) => !value)}
            title="Notifications"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid #e8eef6",
              background: notifOpen ? "#eef3fb" : "#fff",
              color: "#163a6b",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              position: "relative",
            }}
          >
            <BellIcon />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 17,
                height: 17,
                borderRadius: 999,
                background: "#163a6b",
                color: "#fff",
                fontSize: 10,
                fontWeight: 900,
                display: "grid",
                placeItems: "center",
                border: "2px solid #fff",
                padding: "0 4px",
              }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: 360,
              maxWidth: "calc(100vw - 30px)",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e8eef6",
              boxShadow: "0 16px 40px rgba(15,23,42,.12)",
              padding: 8,
              zIndex: 120,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px 10px", borderBottom: "1px solid #f0f4f9", marginBottom: 4 }}>
                <div>
                  <div style={{ color: "#0f2744", fontWeight: 900, fontSize: 14 }}>Notifications</div>
                  <div style={{ color: "#8a97a8", fontSize: 11, marginTop: 2 }}>{unreadCount} unread</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={markAllRead}
                    disabled={unreadCount === 0}
                    style={{
                      height: 31,
                      borderRadius: 9,
                      border: "1px solid #e8eef6",
                      background: "#fff",
                      color: "#163a6b",
                      padding: "0 9px",
                      cursor: unreadCount ? "pointer" : "not-allowed",
                      fontSize: 11,
                      fontWeight: 900,
                      opacity: unreadCount ? 1 : 0.5,
                    }}
                  >
                    Read all
                  </button>
                  <button
                    type="button"
                    onClick={loadNotifications}
                    disabled={notifLoading}
                    title="Refresh notifications"
                    style={{
                      width: 31,
                      height: 31,
                      borderRadius: 9,
                      border: "1px solid #e8eef6",
                      background: "#fff",
                      color: "#163a6b",
                      display: "grid",
                      placeItems: "center",
                      cursor: notifLoading ? "not-allowed" : "pointer",
                      opacity: notifLoading ? 0.6 : 1,
                    }}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>
              {notifError && (
                <div style={{ margin: "8px 10px", padding: "8px 10px", borderRadius: 8, background: "#fff6e5", color: "#8a5a12", fontSize: 12, fontWeight: 700 }}>
                  {notifError}
                </div>
              )}
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {notifLoading && notifications.length === 0 ? (
                  <div style={{ padding: 16, color: "#66778a", fontSize: 13 }}>Loading notifications...</div>
                ) : visibleNotifications.length === 0 ? (
                  <div style={{ padding: 16, color: "#66778a", fontSize: 13 }}>You&apos;re all caught up.</div>
                ) : (
                  visibleNotifications.map((item) => (
                    <NotificationItem key={item.id} item={item} onOpen={openNotification} />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }} ref={dropRef}>
          <div className="qc-hide-sm" style={{
            padding: "5px 12px",
            borderRadius: 99,
            background: "#eef3fb",
            border: "1px solid #d8e5f8",
            fontSize: 11.5,
            fontWeight: 700,
            color: "#163a6b",
          }}>
            {role}
          </div>

          <button
            onClick={() => setDropOpen((value) => !value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "5px 10px 5px 5px",
              borderRadius: 99,
              border: "1px solid #e8eef6",
              background: dropOpen ? "#f2f6fc" : "#fff",
              cursor: "pointer",
              transition: ".15s",
            }}
          >
            <Avatar name={fullName} size={32} fontSize={12} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f2744", lineHeight: 1.2 }}>{fullName}</div>
              <div className="qc-topbar-sub" style={{ fontSize: 11, color: "#8a97a8" }}>{user?.email || ""}</div>
            </div>
            <span style={{ color: "#8a97a8", marginLeft: 2, display: "flex", transform: dropOpen ? "rotate(180deg)" : "none", transition: ".2s" }}>
              <ChevronIcon />
            </span>
          </button>

          {dropOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 24,
              width: 230,
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e8eef6",
              boxShadow: "0 16px 40px rgba(15,23,42,.12)",
              padding: 8,
              zIndex: 100,
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 10px 12px",
                borderBottom: "1px solid #f0f4f9",
                marginBottom: 6,
              }}>
                <Avatar name={fullName} size={38} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f2744" }}>{fullName}</div>
                  <div style={{ fontSize: 11, color: "#8a97a8" }}>{user?.email || ""}</div>
                </div>
              </div>

              {[
                { icon: <ProfileIcon />, label: "My Profile", action: () => { navigate(PROFILE_PATH[role] || "/"); setDropOpen(false); } },
                { icon: <SettingsIcon />, label: "Account Settings", action: () => { navigate(PROFILE_PATH[role] || "/"); setDropOpen(false); } },
              ].map((item) => (
                <button key={item.label} onClick={item.action} style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 9,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#182433",
                  textAlign: "left",
                  transition: ".13s",
                }}>
                  <span style={{ color: "#5a7a9e", display: "flex" }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}

              <div style={{ height: 1, background: "#f0f4f9", margin: "6px 0" }} />

              <button onClick={logout} style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 9,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#c94b5a",
                textAlign: "left",
                transition: ".13s",
              }}>
                <span style={{ display: "flex" }}><LogoutIcon /></span>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
