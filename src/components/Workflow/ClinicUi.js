import React from "react";

export const STATUS_META = {
  PENDING: { label: "Pending", bg: "#fff7df", color: "#9a6500" },
  CONFIRMED: { label: "Confirmed", bg: "#e7f5ee", color: "#176b45" },
  IN_QUEUE: { label: "In Queue", bg: "#eaf1ff", color: "#1b4d9b" },
  FOR_BILLING: { label: "For Billing", bg: "#fff4e5", color: "#b45309" },
  COMPLETED: { label: "Completed", bg: "#edf8f1", color: "#0f6b3c" },
  CANCELLED: { label: "Cancelled", bg: "#fff0f0", color: "#ad3131" },
  RESCHEDULED: { label: "Rescheduled", bg: "#f3edff", color: "#6240a0" },
  NO_SHOW: { label: "No Show", bg: "#f3f4f6", color: "#5b6472" },
  WAITING: { label: "Waiting", bg: "#fff7df", color: "#9a6500" },
  CALLED: { label: "Called", bg: "#eaf1ff", color: "#1b4d9b" },
  IN_PROGRESS: { label: "In Progress", bg: "#eaf1ff", color: "#1b4d9b" },
  DONE: { label: "Done", bg: "#edf8f1", color: "#0f6b3c" },
  SKIPPED: { label: "Skipped", bg: "#fff0f0", color: "#ad3131" },
  PAID: { label: "Paid", bg: "#edf8f1", color: "#0f6b3c" },
  VOIDED: { label: "Voided", bg: "#fff0f0", color: "#ad3131" },
};

export function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDate(value) {
  if (!value) return "-";
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split("-").map(Number);
  if (!year || !month || !day) return text;
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(value) {
  if (!value) return "-";
  const [hour, minute] = String(value).split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return String(value);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

export function money(value) {
  const amount = Number(value || 0);
  return `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function statusLabel(status) {
  return STATUS_META[status]?.label || status || "-";
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || "-", bg: "#eef2f7", color: "#455469" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.color,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {meta.label}
    </span>
  );
}

export function Panel({ children, style }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e3ebf5",
        borderRadius: 8,
        boxShadow: "0 2px 10px rgba(15,23,42,.04)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function ActionButton({ children, tone = "primary", style, type = "button", ...props }) {
  const tones = {
    primary: { background: "#163a6b", color: "#fff", border: "#163a6b" },
    secondary: { background: "#fff", color: "#163a6b", border: "#cddbeb" },
    success: { background: "#176b45", color: "#fff", border: "#176b45" },
    warning: { background: "#fff7df", color: "#9a6500", border: "#f0d58f" },
    danger: { background: "#fff0f0", color: "#ad3131", border: "#f1b7b7" },
  };
  const t = tones[tone] || tones.primary;

  return (
    <button
      type={type}
      {...props}
      style={{
        minHeight: 38,
        padding: "0 14px",
        borderRadius: 10,
        border: `1px solid ${t.border}`,
        background: t.background,
        color: t.color,
        cursor: props.disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: 800,
        fontFamily: "inherit",
        opacity: props.disabled ? 0.62 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#42526a" }}>
      {label}
      {children}
    </label>
  );
}

export const inputStyle = {
  width: "100%",
  minHeight: 40,
  border: "1px solid #d7e2ef",
  borderRadius: 8,
  padding: "9px 11px",
  fontSize: 13,
  color: "#162235",
  background: "#fff",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export function EmptyState({ title, detail }) {
  return (
    <div style={{ padding: 28, textAlign: "center", color: "#6b778c" }}>
      <div style={{ fontWeight: 900, color: "#162235", marginBottom: 4 }}>{title}</div>
      {detail && <div style={{ fontSize: 13 }}>{detail}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }) {
  return <div style={{ padding: 24, textAlign: "center", color: "#6b778c", fontWeight: 700 }}>{label}</div>;
}

export function ErrorState({ message }) {
  if (!message) return null;
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fff0f0", color: "#ad3131", fontSize: 13, fontWeight: 800 }}>
      {message}
    </div>
  );
}

export function getRows(payload, primary, fallback = "data") {
  return payload?.[primary] || payload?.[fallback] || [];
}
