// ============================================================================
// Clinic business time (Asia/Manila)
// ----------------------------------------------------------------------------
// The clinic runs on Philippine time, but neither the production database
// (Etc/UTC) nor the server process is guaranteed to be in that zone. Anything
// that means "the clinic's local day or clock" must come from here instead of
// CURRENT_DATE, a bare new Date(), or getDate()/getHours().
//
// Stored timestamps (timestamptz) are unaffected: they stay absolute instants.
// Appointment date + time columns are Manila wall-clock values by convention.
// ============================================================================

const BUSINESS_TZ = "Asia/Manila";

// SQL expressions for the clinic's local "now" (timestamp without time zone)
// and "today" (date), independent of the database session's TimeZone setting.
const MANILA_NOW_SQL = "(NOW() AT TIME ZONE 'Asia/Manila')";
const MANILA_TODAY_SQL = "(NOW() AT TIME ZONE 'Asia/Manila')::date";

function manilaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// "YYYY-MM-DD" for the clinic's current local day (optionally offset by days).
function manilaToday(offsetDays = 0) {
  const p = manilaParts(new Date(Date.now() + offsetDays * 86400000));
  return `${p.year}-${p.month}-${p.day}`;
}

// "YYYY-MM-DDTHH:MM" for the clinic's current local minute.
function manilaNowMinuteKey() {
  const p = manilaParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Calendar date in Manila for a Date/timestamp value; strings that already
// hold a date are returned as their first 10 characters.
function manilaDateOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const p = manilaParts(new Date(value));
  return `${p.year}-${p.month}-${p.day}`;
}

// Strict "YYYY-MM-DD" that is also a real calendar date (rejects 2027-02-30).
function isValidDateString(value) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// "HH:MM" or "HH:MM:SS" on a 24-hour clock (rejects 25:99).
function isValidTimeString(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return false;
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return hour <= 23 && minute <= 59 && second <= 59;
}

// Calendar arithmetic on a "YYYY-MM-DD" date: pure day counting, so neither
// the server's nor the database's time zone can shift the result.
function addDays(dateString, days) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + Number(days))).toISOString().slice(0, 10);
}

// Whole years from a "YYYY-MM-DD" birth date to the clinic's current day.
function ageOnManilaToday(birthDate) {
  if (!isValidDateString(birthDate)) return null;
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = manilaToday().split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

module.exports = {
  BUSINESS_TZ,
  MANILA_NOW_SQL,
  MANILA_TODAY_SQL,
  manilaToday,
  manilaNowMinuteKey,
  manilaDateOf,
  isValidDateString,
  isValidTimeString,
  addDays,
  ageOnManilaToday,
};
