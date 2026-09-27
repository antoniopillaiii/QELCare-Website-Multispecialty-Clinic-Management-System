// Clinic business time (Asia/Manila) in the browser. The clinic runs on
// Philippine time, so "today", a birthday or "this month" must not move with the
// device's own time zone — and toISOString() is always UTC, which is yesterday
// between 12 AM and 8 AM in Manila. Use these helpers for calendar-day logic.
export const CLINIC_TZ = "Asia/Manila";

function manilaParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// "YYYY-MM-DD" of the clinic's current day.
export function manilaToday() {
  const v = manilaParts(new Date());
  return `${v.year}-${v.month}-${v.day}`;
}

// "YYYY-MM-DD" clinic day of a timestamp (Date or ISO string); "" if invalid.
export function manilaDateOf(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const v = manilaParts(date);
  return `${v.year}-${v.month}-${v.day}`;
}

// Shift a "YYYY-MM-DD" date by whole years (Feb 29 becomes Feb 28 when needed).
export function addYears(dateString, years) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const target = year + years;
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate();
  return `${target}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// Whole years from a birth date ("YYYY-MM-DD", optionally followed by a time)
// to the clinic's current day; null when the value isn't a date.
export function ageFromBirthDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [birthYear, birthMonth, birthDay] = match.slice(1).map(Number);
  const [year, month, day] = manilaToday().split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}
