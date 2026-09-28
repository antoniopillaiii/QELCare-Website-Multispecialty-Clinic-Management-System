// ============================================================================
// Profile field rules shared by the staff profile (PUT /users/me) and the
// patient profile (PUT /auth/patient/profile, used by the website and the
// mobile app), so both accept and store the same values. Names and date of
// birth follow patient self-registration; lengths are the users /
// user_addresses column widths, checked before the database sees the value.
// ============================================================================
const { isValidDateString, ageOnManilaToday } = require("./manilaTime");

const NAME_REGEX = /^[A-Za-zÀ-ÿ.'\- ]+$/;
const PHONE_REGEX = /^(09\d{9}|\+639\d{9}|\+\d{10,14})$/;

const LIMITS = {
  first_name: 50,
  last_name: 50,
  middle_name: 50,
  suffix: 10,
  email: 100,
  phone: 20,
  alternate_phone: 20,
  address_code: 10, // region/province/municipality/barangay codes
};

const ADDRESS_CODE_FIELDS = [
  ["region_code", "Region code"],
  ["province_code", "Province code"],
  ["municipality_code", "Municipality code"],
  ["barangay_code", "Barangay code"],
];

// Trimmed text of a body field; "" when missing. A non-string (object/array)
// becomes a string that no rule accepts, so it is rejected, never stored.
function text(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Stored form of a phone number: spaces, hyphens and brackets removed, so
// "0917 123 4567" and "09171234567" are the same number everywhere.
function normalizePhone(value) {
  return text(value).replace(/[\s\-()]/g, "");
}

function phoneError(normalized, label) {
  if (!normalized) return null;
  if (normalized.length > LIMITS.phone) return `${label} must be ${LIMITS.phone} characters or less.`;
  if (!PHONE_REGEX.test(normalized)) return `${label} is invalid. Use 09XXXXXXXXX or +639XXXXXXXXX.`;
  return null;
}

// First/last name: required, 2-50 characters (registration rule).
function requiredNameError(value, label) {
  if (!value) return `${label} is required.`;
  if (value.length < 2) return `${label} must be at least 2 characters.`;
  if (value.length > LIMITS.first_name) return `${label} must be ${LIMITS.first_name} characters or less.`;
  if (!NAME_REGEX.test(value)) return `${label} can only contain letters, spaces, hyphens, apostrophes, and periods.`;
  return null;
}

// Middle name / suffix: optional, same characters, column width.
function optionalNameError(value, label, max) {
  if (!value) return null;
  if (value.length > max) return `${label} must be ${max} characters or less.`;
  if (!NAME_REGEX.test(value)) return `${label} can only contain letters, spaces, hyphens, apostrophes, and periods.`;
  return null;
}

// Date of birth: the registration rule (a real calendar date, at least 1 and
// at most 120 years ago on the clinic's Manila date).
function birthDateError(value, { required = false } = {}) {
  if (!value) return required ? "Date of birth is required." : null;
  if (!isValidDateString(value)) return "Please enter a valid date of birth.";
  const age = ageOnManilaToday(value);
  if (age === null || age < 0 || age > 120) return "Please enter a valid date of birth.";
  if (age < 1) return "Date of birth must be at least 1 year ago.";
  return null;
}

function addressCodeErrors(values) {
  return ADDRESS_CODE_FIELDS
    .filter(([key]) => values[key] && values[key].length > LIMITS.address_code)
    .map(([, label]) => `${label} must be ${LIMITS.address_code} characters or less.`);
}

module.exports = {
  LIMITS,
  NAME_REGEX,
  ADDRESS_CODE_FIELDS,
  text,
  normalizePhone,
  phoneError,
  requiredNameError,
  optionalNameError,
  birthDateError,
  addressCodeErrors,
};
