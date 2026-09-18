import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import { authFetch } from "../../../utils/auth";
import { C as COLORS } from "../../../utils/adminTheme";

const STATUS_META = {
  WAITING: {
    label: "Waiting",
    color: COLORS.blue,
    bg: COLORS.blueSoft,
  },
  CALLED: {
    label: "Called",
    color: COLORS.amber,
    bg: COLORS.amberSoft,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: COLORS.amber,
    bg: COLORS.amberSoft,
  },
  SKIPPED: {
    label: "Skipped",
    color: COLORS.gray,
    bg: COLORS.graySoft,
  },
  DONE: {
    label: "Done",
    color: COLORS.green,
    bg: COLORS.greenSoft,
  },
  NO_SHOW: {
    label: "No Show",
    color: COLORS.red,
    bg: COLORS.redSoft,
  },
  CANCELLED: {
    label: "Cancelled",
    color: COLORS.red,
    bg: COLORS.redSoft,
  },
};

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value) {
  if (!value) return "-";
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "-";
  const [hRaw, mRaw] = String(value).split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function Badge({ status }) {
  const meta = STATUS_META[status] || { label: status || "-", color: COLORS.gray, bg: COLORS.graySoft };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        borderRadius: 999,
        color: meta.color,
        background: meta.bg,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.color }} />
      {meta.label}
    </span>
  );
}

function Icon({ type, color = "currentColor", size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const paths = {
    refresh: (
      <>
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    play: <polygon points="7 4 20 12 7 20 7 4" fill={color} stroke="none" />,
    check: <polyline points="20 6 9 17 4 12" />,
    skip: (
      <>
        <polyline points="5 4 14 12 5 20" />
        <line x1="19" y1="5" x2="19" y2="19" />
      </>
    ),
    undo: (
      <>
        <polyline points="9 14 4 9 9 4" />
        <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  };

  return <svg {...common}>{paths[type]}</svg>;
}

function ActionButton({ label, icon, tone = "blue", disabled, onClick }) {
  const palette = {
    blue: [COLORS.blue, COLORS.blueSoft],
    green: [COLORS.green, COLORS.greenSoft],
    amber: [COLORS.amber, COLORS.amberSoft],
    gray: [COLORS.gray, COLORS.graySoft],
  }[tone] || [COLORS.blue, COLORS.blueSoft];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 34,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "0 12px",
        border: `1px solid ${disabled ? COLORS.border : palette[0]}`,
        borderRadius: 8,
        background: disabled ? "#f8fafc" : palette[1],
        color: disabled ? "#a6b1bf" : palette[0],
        fontSize: 12,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      <Icon type={icon} size={14} color="currentColor" />
      {label}
    </button>
  );
}

function MetricCard({ label, value, color }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: 16,
        minHeight: 88,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.muted }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: COLORS.ink, marginTop: 10 }}>{value}</div>
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div style={{ padding: "48px 20px", textAlign: "center", color: COLORS.muted }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: COLORS.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{body}</div>
    </div>
  );
}

export default function AdminQueue() {
  const [date, setDate] = useState(todayISO());
  const [specialties, setSpecialties] = useState([]);
  const [activeSpecialtyId, setActiveSpecialtyId] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loadingSpecialties, setLoadingSpecialties] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const refreshTimer = useRef(null);

  const activeSpecialty = useMemo(
    () => specialties.find((s) => String(s.specialty_id) === String(activeSpecialtyId)) || null,
    [specialties, activeSpecialtyId]
  );

  const stats = useMemo(() => {
    return {
      waiting: queue.filter((q) => q.status === "WAITING").length,
      called: queue.filter((q) => q.status === "CALLED").length,
      inProgress: queue.filter((q) => q.status === "IN_PROGRESS").length,
      skipped: queue.filter((q) => q.status === "SKIPPED").length,
      done: queue.filter((q) => q.status === "DONE").length,
      noShow: queue.filter((q) => q.status === "NO_SHOW").length,
    };
  }, [queue]);

  const nowServing = useMemo(
    () => queue.find((q) => q.status === "IN_PROGRESS") || null,
    [queue]
  );

  const nextWaiting = useMemo(
    () => queue.find((q) => q.status === "WAITING") || null,
    [queue]
  );

  const showNotice = useCallback((message, type = "success") => {
    setNotice({ message, type });
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadSpecialties = useCallback(async () => {
    setLoadingSpecialties(true);
    try {
      const res = await authFetch(`/queue/specialties?date=${encodeURIComponent(date)}`);
      const data = await readJson(res);
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to load queue specialties.");
      }

      const next = data.data || data.specialties || [];
      setSpecialties(next);
      setActiveSpecialtyId((current) => {
        if (current && next.some((s) => String(s.specialty_id) === String(current))) return current;
        return next[0]?.specialty_id || null;
      });
    } catch (err) {
      showNotice(err.message, "error");
      setSpecialties([]);
      setActiveSpecialtyId(null);
    } finally {
      setLoadingSpecialties(false);
    }
  }, [date, showNotice]);

  const loadQueue = useCallback(
    async (specialtyId = activeSpecialtyId) => {
      if (!specialtyId) {
        setQueue([]);
        return;
      }

      setLoadingQueue(true);
      try {
        const res = await authFetch(
          `/queue/specialty/${specialtyId}?date=${encodeURIComponent(date)}`
        );
        const data = await readJson(res);
        if (!res.ok || data.success === false) {
          throw new Error(data.message || "Failed to load queue.");
        }

        setQueue(data.data || data.queue || []);
        setLastRefresh(new Date());
      } catch (err) {
        showNotice(err.message, "error");
        setQueue([]);
      } finally {
        setLoadingQueue(false);
      }
    },
    [activeSpecialtyId, date, showNotice]
  );

  const refreshAll = useCallback(async () => {
    await loadSpecialties();
    await loadQueue();
  }, [loadSpecialties, loadQueue]);

  useEffect(() => {
    loadSpecialties();
  }, [loadSpecialties]);

  useEffect(() => {
    loadQueue(activeSpecialtyId);
  }, [activeSpecialtyId, date, loadQueue]);

  useEffect(() => {
    window.clearInterval(refreshTimer.current);
    refreshTimer.current = window.setInterval(() => {
      loadSpecialties();
      loadQueue(activeSpecialtyId);
    }, 30000);

    return () => window.clearInterval(refreshTimer.current);
  }, [activeSpecialtyId, loadQueue, loadSpecialties]);

  async function updateQueueStatus(queueId, status) {
    setWorkingId(queueId);
    try {
      const res = await authFetch(`/queue/${queueId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await readJson(res);
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to update queue status.");
      }

      const updated = data.data || data.queue_entry;
      if (updated?.queue_id) {
        setQueue((prev) => prev.map((q) => (q.queue_id === updated.queue_id ? updated : q)));
      }

      showNotice(`Queue updated to ${STATUS_META[status]?.label || status}.`);
      await loadSpecialties();
      await loadQueue(activeSpecialtyId);
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setWorkingId(null);
    }
  }

  const isToday = date === todayISO();

  return (
    <MainLayout
      pageTitle="Queue Management"
      pageSubtitle="Live clinic queue by specialty"
    >
      <style>
        {`
          @keyframes qelSpin { to { transform: rotate(360deg); } }
          .queue-row:hover { background: #f8fbff; }
          @media (max-width: 900px) {
            .queue-toolbar { align-items: stretch !important; }
            .queue-toolbar-actions { width: 100%; justify-content: flex-start !important; }
            .queue-specialty-grid { grid-template-columns: 1fr !important; }
            .queue-top-grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>

      {notice && (
        <div
          style={{
            position: "fixed",
            top: 22,
            right: 22,
            zIndex: 1000,
            maxWidth: 360,
            padding: "12px 14px",
            borderRadius: 8,
            border: `1px solid ${notice.type === "error" ? "#f5b8b8" : "#b8e2c8"}`,
            background: notice.type === "error" ? COLORS.redSoft : COLORS.greenSoft,
            color: notice.type === "error" ? COLORS.red : COLORS.green,
            fontWeight: 800,
            fontSize: 13,
            boxShadow: "0 16px 40px rgba(15, 39, 68, 0.14)",
          }}
        >
          {notice.message}
        </div>
      )}

      <div
        className="queue-toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 14,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label
            style={{
              height: 40,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              background: COLORS.panel,
              color: COLORS.ink,
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            <Icon type="calendar" size={16} color={COLORS.blue} />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              style={{
                border: "none",
                outline: "none",
                color: COLORS.ink,
                font: "inherit",
                background: "transparent",
              }}
            />
          </label>

          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(todayISO())}
              style={{
                height: 40,
                padding: "0 13px",
                border: `1px solid ${COLORS.blue}`,
                borderRadius: 8,
                background: COLORS.blueSoft,
                color: COLORS.blue,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Today
            </button>
          )}
        </div>

        <div
          className="queue-toolbar-actions"
          style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}
        >
          <div
            style={{
              height: 34,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 12px",
              border: `1px solid ${COLORS.green}`,
              borderRadius: 8,
              background: COLORS.greenSoft,
              color: COLORS.green,
              fontSize: 12,
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            <Icon type="check" size={14} color="currentColor" />
            Queue is created after same-day approval
          </div>
          <ActionButton
            label="Refresh"
            icon="refresh"
            tone="blue"
            disabled={loadingQueue || loadingSpecialties}
            onClick={refreshAll}
          />
        </div>
      </div>

      <div
        className="queue-specialty-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {loadingSpecialties && [1, 2, 3].map((n) => (
          <div
            key={n}
            style={{
              height: 88,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              background: COLORS.panel,
              display: "grid",
              placeItems: "center",
              color: COLORS.muted,
              fontWeight: 800,
            }}
          >
            Loading...
          </div>
        ))}

        {!loadingSpecialties && specialties.map((specialty) => {
          const active = String(specialty.specialty_id) === String(activeSpecialtyId);
          return (
            <button
              type="button"
              key={specialty.specialty_id}
              onClick={() => setActiveSpecialtyId(specialty.specialty_id)}
              style={{
                minHeight: 88,
                textAlign: "left",
                border: `1.5px solid ${active ? COLORS.blue : COLORS.border}`,
                borderRadius: 8,
                background: active ? COLORS.blueSoft : COLORS.panel,
                padding: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  color: active ? COLORS.blue : COLORS.ink,
                  marginBottom: 10,
                }}
              >
                {specialty.specialty_name}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, fontWeight: 900 }}>
                <span style={{ color: COLORS.blue }}>{specialty.waiting || 0} waiting</span>
                <span style={{ color: COLORS.amber }}>{specialty.in_progress || 0} active</span>
                <span style={{ color: COLORS.gray }}>{specialty.skipped || 0} skipped</span>
                <span style={{ color: COLORS.green }}>{specialty.done || 0} done</span>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <MetricCard label="Waiting" value={stats.waiting} color={COLORS.blue} />
        <MetricCard label="Called" value={stats.called} color={COLORS.amber} />
        <MetricCard label="In Progress" value={stats.inProgress} color={COLORS.amber} />
        <MetricCard label="Skipped" value={stats.skipped} color={COLORS.gray} />
        <MetricCard label="Done" value={stats.done} color={COLORS.green} />
        <MetricCard label="No Show" value={stats.noShow} color={COLORS.red} />
      </div>

      <div
        className="queue-top-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, marginBottom: 8 }}>
            Now Serving
          </div>
          {nowServing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  background: COLORS.amberSoft,
                  color: COLORS.amber,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 22,
                  fontWeight: 900,
                }}
              >
                {nowServing.queue_number}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.ink }}>
                  {nowServing.patient_name || "Unnamed patient"}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 3 }}>
                  {nowServing.doctor_name || "No doctor"} | Started {formatDateTime(nowServing.started_at)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 13 }}>No patient is currently in progress.</div>
          )}
        </div>

        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, marginBottom: 8 }}>
            Next Waiting
          </div>
          {nextWaiting ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  background: COLORS.blueSoft,
                  color: COLORS.blue,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 22,
                  fontWeight: 900,
                }}
              >
                {nextWaiting.queue_number}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.ink }}>
                  {nextWaiting.patient_name || "Unnamed patient"}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 3 }}>
                  {formatTime(nextWaiting.appointment_time)} | {nextWaiting.appointment_type || "consultation"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 13 }}>No waiting patient for this specialty.</div>
          )}
        </div>
      </div>

      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "15px 18px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: COLORS.ink }}>
              {activeSpecialty?.specialty_name || "Queue"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 3 }}>
              {formatDate(date)}
              {lastRefresh ? ` | Last refreshed ${formatDateTime(lastRefresh)}` : ""}
            </div>
          </div>
          <Badge status={nowServing ? "IN_PROGRESS" : "WAITING"} />
        </div>

        {loadingQueue ? (
          <div style={{ padding: 48, display: "grid", placeItems: "center" }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: `3px solid ${COLORS.blueSoft}`,
                borderTopColor: COLORS.blue,
                animation: "qelSpin 0.8s linear infinite",
              }}
            />
          </div>
        ) : !activeSpecialtyId ? (
          <EmptyState
            title="No active specialties"
            body="Add or activate specialties before using Queue Management."
          />
        ) : queue.length === 0 ? (
          <EmptyState
            title="No queue entries"
            body="Queue entries appear here after Frontdesk/Admin approves same-day appointments."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ background: "#f8fbff" }}>
                  {["Queue", "Patient", "Doctor", "Appointment", "Status", "Timing", "Actions"].map((head) => (
                    <th
                      key={head}
                      style={{
                        padding: "11px 14px",
                        textAlign: "left",
                        borderBottom: `1px solid ${COLORS.border}`,
                        color: COLORS.muted,
                        fontSize: 11,
                        letterSpacing: 0,
                        textTransform: "uppercase",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => {
                  const disabled = workingId === entry.queue_id || !isToday;
                  return (
                    <tr
                      className="queue-row"
                      key={entry.queue_id}
                      style={{ borderBottom: `1px solid ${COLORS.border}` }}
                    >
                      <td data-label="Queue" style={{ padding: "13px 14px" }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 8,
                            background: COLORS.blueSoft,
                            color: COLORS.blue,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 18,
                            fontWeight: 900,
                          }}
                        >
                          {entry.queue_number}
                        </div>
                      </td>
                      <td data-label="Patient" className="qc-td-block" style={{ padding: "13px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 999,
                              background: COLORS.ink,
                              color: "#fff",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 12,
                              fontWeight: 900,
                              flex: "0 0 auto",
                            }}
                          >
                            {initials(entry.patient_name)}
                          </div>
                          <div>
                            <div style={{ color: COLORS.ink, fontSize: 13, fontWeight: 900 }}>
                              {entry.patient_name || "Unnamed patient"}
                            </div>
                            <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                              {entry.patient_phone || "No phone"} | Patient #{entry.patient_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Doctor" style={{ padding: "13px 14px", color: COLORS.text, fontSize: 13, fontWeight: 800 }}>
                        {entry.doctor_name || "-"}
                      </td>
                      <td data-label="Appointment" style={{ padding: "13px 14px", color: COLORS.text, fontSize: 13 }}>
                        <div style={{ fontWeight: 800 }}>{formatTime(entry.appointment_time)}</div>
                        <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                          {entry.appointment_type || "consultation"}
                          {entry.chief_complaint ? ` | ${entry.chief_complaint}` : ""}
                        </div>
                      </td>
                      <td data-label="Status" style={{ padding: "13px 14px" }}>
                        <Badge status={entry.status} />
                      </td>
                      <td data-label="Timing" style={{ padding: "13px 14px", color: COLORS.muted, fontSize: 12, lineHeight: 1.6 }}>
                        <div>Called: {formatDateTime(entry.called_at)}</div>
                        <div>Done: {formatDateTime(entry.completed_at)}</div>
                      </td>
                      <td data-label="Actions" className="qc-td-block" style={{ padding: "13px 14px" }}>
                        <div className="qc-actions" style={{ display: "flex", gap: 7 }}>
                          {entry.status === "WAITING" && (
                            <>
                              <ActionButton
                                label="Call"
                                icon="play"
                                tone="amber"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "CALLED")}
                              />
                              <ActionButton
                                label="Skip"
                                icon="skip"
                                tone="gray"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "SKIPPED")}
                              />
                            </>
                          )}

                          {entry.status === "CALLED" && (
                            <>
                              <ActionButton
                                label="Start"
                                icon="play"
                                tone="amber"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "IN_PROGRESS")}
                              />
                              <ActionButton
                                label="Skip"
                                icon="skip"
                                tone="gray"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "SKIPPED")}
                              />
                              <ActionButton
                                label="No Show"
                                icon="skip"
                                tone="gray"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "NO_SHOW")}
                              />
                            </>
                          )}

                          {entry.status === "IN_PROGRESS" && (
                            <>
                              <ActionButton
                                label="Done"
                                icon="check"
                                tone="green"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "DONE")}
                              />
                              <ActionButton
                                label="No Show"
                                icon="skip"
                                tone="gray"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "NO_SHOW")}
                              />
                            </>
                          )}

                          {entry.status === "SKIPPED" && (
                            <>
                              <ActionButton
                                label="Recall"
                                icon="undo"
                                tone="blue"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "WAITING")}
                              />
                              <ActionButton
                                label="No Show"
                                icon="skip"
                                tone="gray"
                                disabled={disabled}
                                onClick={() => updateQueueStatus(entry.queue_id, "NO_SHOW")}
                              />
                            </>
                          )}

                          {entry.status === "DONE" && (
                            <span style={{ color: COLORS.green, fontSize: 12, fontWeight: 900 }}>
                              Completed
                            </span>
                          )}

                          {entry.status === "NO_SHOW" && (
                            <span style={{ color: COLORS.red, fontSize: 12, fontWeight: 900 }}>
                              Marked no show
                            </span>
                          )}

                          {entry.status === "CANCELLED" && (
                            <span style={{ color: COLORS.red, fontSize: 12, fontWeight: 900 }}>
                              Cancelled
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isToday && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            background: COLORS.graySoft,
            color: COLORS.gray,
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Historical queue dates are read-only. Switch back to today to update queue status.
        </div>
      )}
    </MainLayout>
  );
}
