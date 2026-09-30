// Formatting shared by the billing transactions table and its details view.
import { CLINIC_TZ } from "../../../utils/manilaDate";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

// Payment times are shown on the clinic's clock (Asia/Manila).
const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const methodLabels = {
  cash: "Cash",
  gcash: "Online",
  maya: "Online",
  card: "Online",
  online: "Online",
  hmo: "HMO",
  insurance: "HMO",
  philhealth: "HMO",
};

const methodDetailLabels = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  card: "Card",
  online: "Online Payment",
  hmo: "HMO",
  insurance: "Insurance",
  philhealth: "PhilHealth",
};

const discountLabels = {
  none: "None",
  manual: "Manual",
  senior: "Senior citizen",
  pwd: "PWD",
  philhealth: "PhilHealth",
  hmo: "HMO",
  other: "Other",
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMethod(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value) {
  return pesoFormatter.format(toNumber(value));
}

export function getPaymentSource(method) {
  return methodLabels[normalizeMethod(method)] || "Other";
}

export function getPaymentMethodLabel(method) {
  const normalized = normalizeMethod(method);
  if (!normalized) return "Not specified";
  return methodDetailLabels[normalized] || titleCase(normalized);
}

export function getDiscountLabel(type) {
  const normalized = normalizeText(type);
  return discountLabels[normalized] || titleCase(normalized) || "None";
}

export function statusLabel(status) {
  return titleCase(normalizeText(status) || "unknown");
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(value, fallback = "Not recorded") {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

// "YYYY-MM-DD" clinic day -> "Oct 01, 2026".
export function formatDay(value, fallback = "") {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return fallback;
  return dayFormatter.format(new Date(`${value}T12:00:00+08:00`));
}

// "HH:MM[:SS]" appointment time -> "7:00 PM".
export function formatClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}
