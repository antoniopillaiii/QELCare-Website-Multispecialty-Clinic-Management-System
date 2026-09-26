const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;

function clean(value) {
  return String(value || "").trim();
}

function validatePasswordStrength(password, label = "Password") {
  const errors = [];
  const value = String(password || "");

  if (!value) {
    errors.push(`${label} is required`);
    return errors;
  }
  if (value.length < 8) errors.push(`${label} must be at least 8 characters`);
  if (value.length > 128) errors.push(`${label} must be 128 characters or less`);
  if (!/[a-z]/.test(value)) errors.push(`${label} must contain a lowercase letter`);
  if (!/[A-Z]/.test(value)) errors.push(`${label} must contain an uppercase letter`);
  if (!/\d/.test(value)) errors.push(`${label} must contain a number`);
  if (!/[@$!%*?&#]/.test(value)) errors.push(`${label} must contain a special character`);

  return errors;
}

const validateLoginInput = (username, password) => {
  const errors = [];
  const cleanUsername = clean(username);

  if (!cleanUsername) errors.push("Username is required");
  if (cleanUsername.length > 50) errors.push("Username must be 50 characters or less");
  if (!password || String(password).trim() === "") errors.push("Password is required");
  if (password && String(password).length > 128) errors.push("Password must be 128 characters or less");

  return errors;
};

const validateEmail = (email) => {
  const errors = [];
  const value = clean(email);

  if (!value) {
    errors.push("Email is required");
    return errors;
  }
  if (value.length > 100) errors.push("Email must be 100 characters or less");
  if (!EMAIL_REGEX.test(value)) errors.push("Invalid email format");

  return errors;
};

// Same rules patient self-registration enforces (patientRegistrationRoutes.js):
// a username starts with a letter and uses 3-50 letters, numbers, dot,
// underscore or hyphen; a name is 2+ characters of letters (incl. accents),
// spaces, hyphens, apostrophes and periods.
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9._-]{2,49}$/;
const NAME_REGEX = /^[A-Za-zÀ-ÿ.'\- ]+$/;

const validateUsername = (username) => {
  const value = clean(username);
  if (!value) return ["Username is required"];
  if (!USERNAME_REGEX.test(value)) {
    return ["Username must start with a letter and be 3-50 characters using letters, numbers, dot, underscore, or hyphen"];
  }
  return [];
};

const validatePersonName = (name, label) => {
  const value = clean(name);
  if (!value) return [`${label} is required`];
  if (value.length < 2) return [`${label} must be at least 2 characters`];
  if (value.length > 50) return [`${label} must be 50 characters or less`];
  if (!NAME_REGEX.test(value)) return [`${label} can only contain letters, spaces, hyphens, apostrophes, and periods`];
  return [];
};

const validatePasswordChange = (currentPassword, newPassword) => {
  const errors = [];

  if (!currentPassword) errors.push("Current password is required");
  if (currentPassword && String(currentPassword).length > 128) errors.push("Current password must be 128 characters or less");
  errors.push(...validatePasswordStrength(newPassword, "New password"));

  return errors;
};

const validateOTPCode = (code) => {
  const errors = [];
  const value = clean(code);

  if (!value) {
    errors.push("Verification code is required");
    return errors;
  }
  if (!OTP_REGEX.test(value)) errors.push("Verification code must be 6 digits");

  return errors;
};

const validateResetPassword = (email, newPassword, code) => {
  const errors = [];
  errors.push(...validateEmail(email));
  errors.push(...validatePasswordStrength(newPassword, "Password"));
  errors.push(...validateOTPCode(code));
  return errors;
};

module.exports = {
  validateLoginInput,
  validateEmail,
  validatePasswordChange,
  validateResetPassword,
  validateOTPCode,
  validatePasswordStrength,
  validateUsername,
  validatePersonName,
};
