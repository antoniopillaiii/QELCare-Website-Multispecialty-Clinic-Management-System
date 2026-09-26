// FILE: src/components/AdminFeatures/CreateUserAcc/AdminDashboard.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../../Layout/MainLayout";
import Pagination, { usePagination } from "../../common/Pagination";
import { authFetch } from "../../../utils/auth";
import { C } from "../../../utils/adminTheme";

// --- Appointment status config -------------------------------------------------
const STATUS_CFG = {
  PENDING:     { label: "Pending",     bg: "#f5f5f5",  color: "#666"       },
  CONFIRMED:   { label: "Confirmed",   bg: C.blueL,    color: C.blue       },
  RESCHEDULED: { label: "Rescheduled", bg: C.purpleL,  color: C.purple     },
  IN_QUEUE:    { label: "In Queue",    bg: C.amberL,   color: C.amber      },
  FOR_BILLING: { label: "For Billing", bg: C.greenL,   color: C.green      },
  COMPLETED:   { label: "Completed",   bg: C.tealL,    color: C.teal       },
  NO_SHOW:     { label: "No Show",     bg: "#f1f5f9",  color: "#64748b"    },
  CANCELLED:   { label: "Cancelled",   bg: "#fff2f4",  color: "#b63342"    },
};
// Display order for the filter tabs and the "Today by Status" breakdown.
const STATUS_ORDER = Object.keys(STATUS_CFG);
// Lost visits. "Appointments Today" counts every status except these (same rule
// as the backend), so card = list total minus these.
const LOST_STATUSES = ["CANCELLED", "NO_SHOW"];

// --- Dept colors (cycle) ------------------------------------------------------
const DEPT_COLORS = [C.blue, C.green, C.amber, C.purple, C.teal, "#6b1616", "#1a536b", "#6b6b16"];

// --- Icons --------------------------------------------------------------------
const IC = {
  users:    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  patients: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  appt:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  queue:    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  done:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  refresh:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
};

// --- Bar Chart ----------------------------------------------------------------
function BarChart({ data }) {
  if (!data || data.length === 0) return (
    <div style={{ height: 160, display: "grid", placeItems: "center", color: C.muted, fontSize: 13 }}>
      No data yet
    </div>
  );
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 520, H = 130, padB = 26, padT = 14, barW = 38;
  const gap = (W - data.length * barW) / (data.length + 1);
  return (
    <svg viewBox={`0 0 ${W} ${H + padB}`} style={{ width: "100%", height: 160 }}>
      {data.map((d, i) => {
        const x  = gap + i * (barW + gap);
        const bh = Math.max(4, (d.value / max) * (H - padT));
        const y  = H - bh;
        const isMax = d.value === max;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={6}
              fill={isMax ? C.blue : "#c5d8f5"} />
            <text x={x + barW / 2} y={H + padB - 4} textAnchor="middle"
              fill={C.muted} fontSize="11" fontWeight="600">{d.label}</text>
            {d.value > 0 && (
              <text x={x + barW / 2} y={y - 5} textAnchor="middle"
                fill={C.navy} fontSize="11" fontWeight="700">{d.value}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// --- Skeleton shimmer ---------------------------------------------------------
const shimmer = {
  background: "linear-gradient(90deg,#eef3fb 25%,#dde7f5 50%,#eef3fb 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.4s infinite",
  borderRadius: 8,
};
const shimmerStyle = `@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`;

// --- Card wrapper -------------------------------------------------------------
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 14,
      border: `1px solid ${C.border}`,
      boxShadow: "0 2px 8px rgba(15,23,42,.05)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// --- Status badge -------------------------------------------------------------
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, bg: "#f0f0f0", color: "#555" };
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "3px 8px",
      borderRadius: 99, background: cfg.bg, color: cfg.color,
      whiteSpace: "nowrap", display: "inline-block",
    }}>
      {cfg.label}
    </span>
  );
}

// --- Format time from "HH:MM:SS" ----------------------------------------------
function formatTime(t) {
  if (!t) return "-";
  try {
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "PM" : "AM";
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
  } catch { return t; }
}

// --- Main Component -----------------------------------------------------------
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [users, setUsers]           = useState([]);
  const [loadingUsers, setLU]       = useState(true);
  const [dashData, setDashData]     = useState(null);
  const [loadingDash, setLD]        = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  // A failed load used to be swallowed to the console, so a dead API looked
  // exactly like a quiet day: metrics showed "-", the chart said "No data yet"
  // and the table said "No appointments scheduled today." An admin had no way
  // to tell the difference. This surfaces it instead.
  const [loadError, setLoadError] = useState("");
  const intervalRef = useRef(null);

  // -- Fetch users (for user distribution) ------------------------------------
  const fetchUsers = useCallback(async () => {
    try {
      const res  = await authFetch("/users");
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load users.");
      setUsers(data.data);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
    finally { setLU(false); }
  }, []);

  // -- Fetch dashboard analytics -----------------------------------------------
  const fetchDash = useCallback(async () => {
    try {
      const res  = await authFetch("/analytics/dashboard");
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load dashboard data.");
      setDashData(data.data);
      setLastRefresh(new Date());
      setLoadError("");
      return true;
    } catch (e) {
      console.error(e);
      // Keep whatever was last loaded on screen rather than blanking it, and
      // say plainly that the figures are stale.
      setLoadError("Could not refresh dashboard data. The figures below may be out of date.");
      return false;
    }
    finally { setLD(false); }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchDash();
    // Auto-refresh every 60 seconds
    intervalRef.current = setInterval(fetchDash, 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchUsers, fetchDash]);

  // -- Derived values ----------------------------------------------------------
  const totalUsers    = loadingUsers ? "-" : users.length;
  // Active patient RECORDS, matching the Patients module this card links to.
  // It used to count users with the Patient role, which is a different number
  // by design: a patient record can exist with no login (added by admin or
  // frontdesk) and clinic staff can themselves be patients. Counting accounts
  // here meant the card showed one figure and the page it opened showed another.
  const totalPatients = dashData?.metrics?.total_patients ?? "-";

  const appointmentsToday = dashData?.metrics?.appointments_today ?? "-";
  const activeQueue       = dashData?.metrics?.active_queue       ?? "-";
  const completedToday    = dashData?.metrics?.completed_today    ?? "-";

  const userDist = [
    { role: "Admin",   count: users.filter(u => u.role === "Admin").length,   color: C.blue   },
    { role: "Doctor",  count: users.filter(u => u.role === "Doctor").length,  color: C.green  },
    { role: "Nurse",   count: users.filter(u => u.role === "Nurse").length,   color: C.amber  },
    { role: "Cashier", count: users.filter(u => u.role === "Cashier").length, color: C.purple },
    { role: "Frontdesk", count: users.filter(u => u.role === "Frontdesk").length, color: C.red },
    { role: "Patient", count: users.filter(u => u.role === "Patient").length, color: C.teal   },
  ];

  const deptData = (dashData?.dept_today || []).map((d, i) => ({
    ...d,
    color: DEPT_COLORS[i % DEPT_COLORS.length],
  }));
  const deptMax = Math.max(...deptData.map(d => d.count), 1);

  const todayAppts = dashData?.today_appointments || [];
  const filteredAppts = statusFilter === "ALL"
    ? todayAppts
    : todayAppts.filter(a => a.status === statusFilter);
  const countedToday = todayAppts.filter(a => !LOST_STATUSES.includes(a.status)).length;
  // RESCHEDULED is a legacy status (rescheduling now resets to PENDING), so it
  // only gets a tab / breakdown row on days that actually have one.
  const shownStatuses = STATUS_ORDER.filter(s => s !== "RESCHEDULED" || todayAppts.some(a => a.status === s));

  // Paginate the today's-appointments panel; switching the status tab resets to page 1.
  const { page, totalPages, pageItems, setPage, pageSize, totalItems } = usePagination(
    filteredAppts,
    10,
    statusFilter
  );

  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  // Each card deep-links to its module. "today" is resolved to the current
  // Manila date by the Appointments page, which reads ?date / ?status.
  const METRICS = [
    { label: "Total Users",        value: totalUsers,        icon: IC.users,    color: C.blue,   bg: C.blueL,   to: "/admin/users" },
    { label: "Active Patients",    value: totalPatients,     icon: IC.patients, color: C.green,  bg: C.greenL,  to: "/admin/patients" },
    { label: "Appointments Today", value: appointmentsToday, icon: IC.appt,     color: C.amber,  bg: C.amberL,  to: "/admin/appointments?date=today" },
    { label: "Active Queue",       value: activeQueue,       icon: IC.queue,    color: C.purple, bg: C.purpleL, to: "/admin/queue" },
    { label: "Completed Today",    value: completedToday,    icon: IC.done,     color: C.teal,   bg: C.tealL,   to: "/admin/appointments?date=today&status=COMPLETED" },
  ];

  // -- Refresh handler ---------------------------------------------------------
  const handleRefresh = () => {
    setLD(true);
    setLU(true);
    fetchUsers();
    fetchDash();
  };

  return (
    <MainLayout>
      <style>{shimmerStyle}</style>

      {/* -- Page Header --------------------------------------------------------
          The Topbar already shows "Administrator Dashboard" and the signed-in
          user, so repeating both here pushed the metrics below the fold and
          showed the admin's name twice on one screen. What is left is the part
          the Topbar does NOT provide: today's date and the refresh control. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{today}</div>

        {/* Refresh button. aria-live lets a screen reader announce the refresh
            without the user having to hunt for the changed timestamp. */}
        <button
          onClick={handleRefresh}
          disabled={loadingDash}
          aria-live="polite"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#fff", border: `1px solid ${C.border}`,
            borderRadius: 10, padding: "8px 13px",
            cursor: loadingDash ? "not-allowed" : "pointer",
            fontSize: 12, fontWeight: 600, color: C.muted,
            opacity: loadingDash ? 0.6 : 1,
          }}
        >
          <span style={{ display: "grid", placeItems: "center", color: C.blue }}>{IC.refresh}</span>
          {loadingDash ? "Refreshing..." : lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}
        </button>
      </div>

      {/* Stale-data banner. role="alert" so it is announced; it sits above the
          metrics because it changes how every number below should be read. */}
      {loadError && (
        <div
          role="alert"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap",
            marginBottom: 16, padding: "11px 14px",
            background: C.amberL, border: `1px solid #f2d9a8`, borderRadius: 12,
            color: C.amber, fontSize: 13, fontWeight: 700,
          }}
        >
          <span>{loadError}</span>
          <button
            onClick={handleRefresh}
            disabled={loadingDash}
            style={{
              background: "#fff", border: `1px solid #f2d9a8`, borderRadius: 9,
              padding: "6px 12px", fontSize: 12, fontWeight: 800, color: C.amber,
              cursor: loadingDash ? "not-allowed" : "pointer",
              opacity: loadingDash ? 0.6 : 1, fontFamily: "inherit",
            }}
          >
            {loadingDash ? "Retrying..." : "Retry"}
          </button>
        </div>
      )}

      {/* -- Metric Cards (clickable — deep-link to each module) ---------------- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
        {METRICS.map(m => (
          <div
            key={m.label}
            role="button"
            tabIndex={0}
            aria-label={`${m.label}: ${m.value}. Open ${m.label}.`}
            onClick={() => navigate(m.to)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(m.to); } }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 8px 24px rgba(22,58,107,.14)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = m.color; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,.05)"; e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = C.border; }}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 3px ${m.bg}`; e.currentTarget.style.borderColor = m.color; }}
            onBlur={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,.05)"; e.currentTarget.style.borderColor = C.border; }}
            style={{ background: "#fff", borderRadius: 13, padding: "15px 16px", border: `1px solid ${C.border}`, boxShadow: "0 2px 8px rgba(15,23,42,.05)", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", transition: "box-shadow .18s, transform .18s, border-color .18s", outline: "none" }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: m.bg, display: "grid", placeItems: "center", color: m.color, flexShrink: 0 }}>{m.icon}</div>
            <div>
              {(loadingDash || loadingUsers) && m.value === "-" ? (
                <div style={{ ...shimmer, width: 40, height: 22, marginBottom: 5 }} />
              ) : (
                <div style={{ fontSize: 21, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>{m.value}</div>
              )}
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontWeight: 600 }}>{m.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* -- Analytics Row ------------------------------------------------------ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>

        {/* Bar Chart - last 7 days */}
        <Card>
          <div style={{ padding: "16px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Appointments Overview</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Last 7 days - live data</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, background: C.blueL, padding: "4px 10px", borderRadius: 99, border: `1px solid #d8e5f8` }}>This Week</span>
          </div>
          <div style={{ padding: "10px 20px 16px" }}>
            {loadingDash ? (
              <div style={{ ...shimmer, height: 140, width: "100%" }} />
            ) : (
              <BarChart data={dashData?.weekly || []} />
            )}
          </div>
        </Card>

        {/* Department Load - TODAY */}
        <Card>
          <div style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, marginBottom: 3 }}>Department Load</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 16 }}>Appointments per department today</div>
            {loadingDash ? (
              [1, 2, 3, 4].map(i => (
                <div key={i} style={{ marginBottom: 13 }}>
                  <div style={{ ...shimmer, height: 14, width: "70%", marginBottom: 6 }} />
                  <div style={{ ...shimmer, height: 7, width: "100%", borderRadius: 99 }} />
                </div>
              ))
            ) : deptData.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted, textAlign: "center", padding: "16px 0" }}>No appointments today</div>
            ) : (
              deptData.map(d => {
                const pct = Math.round((d.count / deptMax) * 100);
                return (
                  <div key={d.dept} style={{ marginBottom: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>{d.dept}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: d.color }}>{d.count}</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 99, background: "#f0f4f9" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: d.color, transition: "width .5s" }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* -- Bottom Row --------------------------------------------------------- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, marginBottom: 16 }}>

        {/* Today's Appointments */}
        <Card>
          {/* Header */}
          <div style={{ padding: "14px 18px", borderBottom: `1px solid #f0f4f9`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Today's Appointments</div>
            {/* Status filter tabs. These are toggles, so each exposes
                aria-pressed — without it a screen reader reads five identical
                buttons with no indication of which filter is active. The colour
                change alone also fails contrast-independent identification. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Filter today's appointments by status">
              {["ALL", ...shownStatuses].map(s => {
                const active = statusFilter === s;
                const cfg = s === "ALL" ? { label: "All", bg: C.blueL, color: C.blue } : STATUS_CFG[s];
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(s)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
                      border: active ? `1.5px solid ${cfg.color}` : `1px solid ${C.border}`,
                      background: active ? cfg.bg : "#fff",
                      color: active ? cfg.color : C.muted,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s === "ALL" ? "All" : STATUS_CFG[s].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr .85fr .7fr .8fr", gap: 8, padding: "9px 18px", background: "#f8fafd", borderBottom: `1px solid #f0f4f9` }}>
            {["Patient", "Doctor", "Dept", "Time", "Status"].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{h}</div>
            ))}
          </div>

          {/* Table body */}
          {/* No inner max-height/scroll: the list is paginated below, and having
              both an inner scrollbar and a pager to reach the same rows is
              needlessly fiddly. The page count controls the height instead. */}
          <div>
            {loadingDash ? (
              [1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr .85fr .7fr .8fr", gap: 8, padding: "10px 18px", borderBottom: `1px solid #f8fafd` }}>
                  {[70, 55, 45, 40, 50].map((w, j) => (
                    <div key={j} style={{ ...shimmer, height: 13, width: `${w}%` }} />
                  ))}
                </div>
              ))
            ) : filteredAppts.length === 0 ? (
              <div style={{ padding: "24px 18px", textAlign: "center", fontSize: 13, color: C.muted }}>
                {statusFilter === "ALL" ? "No appointments scheduled today." : `No ${(STATUS_CFG[statusFilter]?.label || statusFilter).toLowerCase()} appointments.`}
              </div>
            ) : (
              pageItems.map(a => (
                <div
                  key={a.id}
                  style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr .85fr .7fr .8fr", gap: 8, padding: "9px 18px", borderBottom: `1px solid #f8fafd`, alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.rowHov}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.patient_name || "-"}</div>
                  <div style={{ fontSize: 11.5, color: "#5a6a7e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.doctor_name || "-"}</div>
                  <div style={{ fontSize: 11.5, color: "#5a6a7e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.dept}</div>
                  <div style={{ fontSize: 11.5, color: "#5a6a7e", whiteSpace: "nowrap" }}>{formatTime(a.appt_time)}</div>
                  <StatusBadge status={a.status} />
                </div>
              ))
            )}
          </div>

          {/* Footer count */}
          {!loadingDash && (
            <div style={{ padding: "8px 18px", borderTop: `1px solid #f0f4f9`, fontSize: 11.5, color: C.muted }}>
              {filteredAppts.length} of {todayAppts.length} appointment{todayAppts.length !== 1 ? "s" : ""} today
              {" · "}{countedToday} excluding cancelled and no-show
            </div>
          )}

          {!loadingDash && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={setPage}
              label="appointments"
            />
          )}
        </Card>

        {/* User Distribution */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card style={{ flex: 1 }}>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, marginBottom: 4 }}>User Distribution</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 16 }}>Registered accounts by role</div>
              {userDist.map(u => (
                <div key={u.role} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: u.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: C.navy, fontWeight: 600 }}>{u.role}</span>
                  </div>
                  {loadingUsers ? (
                    <div style={{ ...shimmer, width: 28, height: 16 }} />
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 800, color: u.color }}>{u.count}</span>
                  )}
                </div>
              ))}

              {/* Appointment status breakdown */}
              {!loadingDash && dashData && (
                <>
                  <div style={{ borderTop: `1px solid #f0f4f9`, margin: "12px 0", paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10, letterSpacing: ".04em", textTransform: "uppercase" }}>Today by Status</div>
                    {shownStatuses.map(status => ({
                      ...STATUS_CFG[status],
                      count: todayAppts.filter(a => a.status === status).length,
                    })).map(s => (
                      <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.navy }}>{s.label}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 9px",
                          borderRadius: 99, background: s.bg, color: s.color,
                        }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* -- Footer ------------------------------------------------------------- */}
      <div style={{ fontSize: 11.5, color: "#b0bac8", textAlign: "center" }}>
        Copyright 2026 QELCare - Clinic Management System - Live data - Auto-refreshes every 60s
      </div>
    </MainLayout>
  );
}
