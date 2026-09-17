import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../utils/auth";
import {
  Plus as PlusIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ShieldCheck as ShieldIcon,
  Eye as EyeOpen,
  EyeOff as EyeClosed,
  CircleAlert as AlertIcon,
  Check as CheckIcon,
  Home as HomeIcon,
  Calendar as CalendarIcon,
  Phone as PhoneIcon,
  User as UserIcon,
  Mail as MailIcon,
  Lock as LockIcon,
  X as CloseIcon,
} from "lucide-react";

// --- Password strength --------------------------------------------------------
const checkPw = (pw) => ({
  length:    pw.length >= 8,
  lowercase: /(?=.*[a-z])/.test(pw),
  uppercase: /(?=.*[A-Z])/.test(pw),
  number:    /(?=.*\d)/.test(pw),
  special:   /(?=.*[@$!%*?&#])/.test(pw),
});
const pwValid = (pw) => Object.values(checkPw(pw)).every(Boolean);

const PW_CHECKS = [
  { key: "length",    label: "8+ chars" },
  { key: "uppercase", label: "Uppercase" },
  { key: "lowercase", label: "Lowercase" },
  { key: "number",    label: "Number" },
  { key: "special",   label: "Special (@$!%*?&#)" },
];

const STEPS = ["Personal Info", "Account Setup", "Password"];
const EMPTY = {
  first_name: "", last_name: "", date_of_birth: "", phone: "",
  email: "", username: "", password: "", confirm: "",
};

// --- Phone validation (PH format or international) ---------------------------
const isValidPhone = (ph) => {
  if (!ph) return true; // optional
  const cleaned = ph.replace(/[\s\-()]/g, "");
  return /^(09\d{9}|\+639\d{9}|\+\d{10,14})$/.test(cleaned);
};

// --- Age from DOB -------------------------------------------------------------
const calcAge = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

// --- Max DOB date (must be at least 1 year old) -------------------------------
const maxDOB = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split("T")[0];
};

// --- Min DOB date (no older than 120 years) -----------------------------------
const minDOB = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 120);
  return d.toISOString().split("T")[0];
};

// --- Username rules -----------------------------------------------------------
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const usernameHint   = (u) => {
  if (!u) return null;
  if (u.length < 3)           return "At least 3 characters";
  if (u.length > 30)          return "Max 30 characters";
  if (!/^[a-zA-Z]/.test(u))  return "Must start with a letter";
  if (!USERNAME_REGEX.test(u)) return "Only letters, numbers, _ . - allowed";
  return null; // valid
};

// --- Styles -------------------------------------------------------------------
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Serif+Display:ital@0;1&display=swap');

  :root {
    --navy: #0e2340; --navy-2: #163a6b; --navy-3: #1e4d8c;
    --blue: #2d6be4; --teal: #0e8a7a; --success: #059669;
    --ink: #111827; --ink-2: #374151; --muted: #6b7280; --line: #e5eaf3;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; overflow: hidden; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: linear-gradient(135deg, #eef2fb 0%, #f4f7fc 60%, #eaf0f9 100%); }
  button, input, select { font: inherit; outline: none; border: none; }

  /* Restore a clear keyboard focus ring for buttons, links, and checkboxes
     (text inputs keep their own :focus ring below). */
  a:focus-visible,
  button:focus-visible,
  input[type="checkbox"]:focus-visible {
    outline: 3px solid var(--blue);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: .001ms !important; animation-duration: .001ms !important; }
    .rg-btn-main:hover:not(:disabled), .rg-home-btn:hover, .rg-back:hover { transform: none; }
  }

  .rg-page { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .rg-shell {
    width: 100%; max-width: 1100px;
    height: calc(100vh - 40px); max-height: 800px;
    display: grid; grid-template-columns: 1.1fr 0.9fr;
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 24px 64px rgba(14,35,64,.18), 0 2px 6px rgba(14,35,64,.08);
    border: 1px solid rgba(255,255,255,.7);
  }

  /* Brand */
  .rg-brand {
    position: relative; display: flex; flex-direction: column;
    justify-content: space-between; padding: 36px 42px;
    color: #fff; background: linear-gradient(148deg, #0e2340 0%, #1e4d8c 100%); overflow: hidden;
  }
  .rg-brand::before { content:""; position:absolute; width:480px; height:480px; top:-180px; right:-140px; border-radius:50%; background:radial-gradient(circle,rgba(255,255,255,.1) 0%,transparent 68%); pointer-events:none; }
  .rg-brand::after  { content:""; position:absolute; width:300px; height:300px; left:-90px; bottom:-100px; border-radius:50%; background:radial-gradient(circle,rgba(45,107,228,.26) 0%,transparent 70%); pointer-events:none; }
  .rg-grid-bg { position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px); background-size:36px 36px; }
  .rg-brand-top, .rg-brand-body, .rg-brand-foot { position: relative; z-index: 1; }

  /* Brand top row: logo + home button */
  .rg-brand-top { display: flex; align-items: center; justify-content: space-between; }
  .rg-logo { display:inline-flex; align-items:center; gap:11px; font-size:.9rem; font-weight:700; }
  .rg-logo-mark { width:40px; height:40px; display:grid; place-items:center; border-radius:12px; background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.2); }
  .rg-logo-mark svg { width:18px; height:18px; }

  .rg-home-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 14px; border-radius: 10px;
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
    color: rgba(255,255,255,.85); font-size: .78rem; font-weight: 700;
    cursor: pointer; transition: background .18s, color .18s; letter-spacing: .01em;
  }
  .rg-home-btn svg { width: 14px; height: 14px; }
  .rg-home-btn:hover { background: rgba(255,255,255,.18); color: #fff; }

  .rg-eyebrow { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.15); font-size:.7rem; font-weight:700; letter-spacing:.07em; text-transform:uppercase; margin-bottom:16px; }
  .rg-eyebrow-dot { width:7px; height:7px; border-radius:50%; background:#5eead4; box-shadow:0 0 0 4px rgba(94,234,212,.18); }

  .rg-brand h1 { font-family:'DM Serif Display',Georgia,serif; font-size:clamp(1.9rem,2.8vw,2.9rem); line-height:1.08; letter-spacing:-.02em; font-weight:400; margin-bottom:12px; }
  .rg-brand h1 em { font-style:italic; color:rgba(255,255,255,.75); }
  .rg-brand-desc { color:rgba(255,255,255,.65); font-size:.86rem; line-height:1.68; max-width:380px; margin-bottom:26px; }

  .rg-highlights { display:grid; gap:10px; }
  .rg-highlight { padding:14px 16px; border-radius:14px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.11); }
  .rg-highlight strong { display:block; font-size:.81rem; font-weight:700; margin-bottom:3px; }
  .rg-highlight span { color:rgba(255,255,255,.62); font-size:.76rem; line-height:1.48; }

  .rg-brand-foot { display:flex; justify-content:space-between; align-items:center; color:rgba(255,255,255,.42); font-size:.76rem; flex-wrap:wrap; gap:8px; }
  .rg-foot-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); font-size:.7rem; font-weight:600; }
  .rg-foot-badge svg { width:12px; height:12px; }

  /* Form */
  .rg-form-panel { display:flex; align-items:center; justify-content:center; padding:28px 40px; background:#fff; overflow-y:auto; }
  .rg-form-inner { width:100%; max-width:360px; padding: 4px 0; }

  .rg-back { display:inline-flex; align-items:center; gap:7px; margin-bottom:14px; color:var(--navy-2); font-size:.83rem; font-weight:700; background:none; border:none; cursor:pointer; padding:0; transition:color .15s,transform .15s; }
  .rg-back svg { width:16px; height:16px; }
  .rg-back:hover { color:var(--blue); transform:translateX(-2px); }

  .rg-form-head { margin-bottom:12px; }
  .rg-form-head h2 { font-family:'DM Serif Display',Georgia,serif; font-size:1.75rem; font-weight:400; letter-spacing:-.02em; color:var(--ink); margin-bottom:4px; }
  .rg-form-head p { color:var(--muted); font-size:.84rem; line-height:1.6; }

  /* Step bar */
  .rg-step-bar { display:flex; gap:6px; margin-bottom:14px; }
  .rg-step-pill { flex:1; height:4px; border-radius:999px; transition:background .3s; }
  .rg-step-labels { display:flex; margin-bottom:12px; }
  .rg-step-label { flex:1; font-size:.68rem; font-weight:700; text-align:center; letter-spacing:.02em; }

  .rg-badge { display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:999px; background:#f0fdf9; border:1px solid #bbf0de; color:var(--teal); font-size:.74rem; font-weight:700; margin-bottom:12px; }
  .rg-badge-dot { width:7px; height:7px; border-radius:50%; background:var(--teal); box-shadow:0 0 0 3px rgba(14,138,122,.15); }

  /* Alerts */
  .rg-alert { display:flex; align-items:flex-start; gap:9px; padding:11px 13px; border-radius:11px; font-size:.83rem; font-weight:500; margin-bottom:12px; line-height:1.5; }
  .rg-alert svg { width:16px; height:16px; flex-shrink:0; margin-top:1px; }
  .rg-alert-error   { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; }
  .rg-alert-success { background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; }

  /* Fields */
  .rg-field { margin-bottom:11px; }
  .rg-label { display:block; font-size:.78rem; font-weight:700; color:var(--ink-2); margin-bottom:5px; letter-spacing:.01em; }
  .rg-label-opt { font-weight:400; color:#9ba8bc; font-size:.73rem; }
  .rg-input-wrap { position: relative; }
  .rg-input-icon { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#b0bbc9; width:16px; height:16px; pointer-events:none; }
  .rg-input-icon svg { width:16px; height:16px; }
  .rg-input {
    width:100%; height:44px; border:1.5px solid var(--line); background:#fafbfd; border-radius:11px;
    padding:0 14px 0 40px; color:var(--ink); font-size:.88rem;
    transition:border-color .18s,box-shadow .18s,background .18s;
  }
  .rg-input-no-icon { padding-left: 14px; }
  .rg-input::placeholder { color:#c8d0dc; }
  .rg-input:focus { border-color:var(--blue); background:#fff; box-shadow:0 0 0 3px rgba(45,107,228,.11); }
  .rg-input-error { border-color:#fca5a5 !important; background:#fff8f8 !important; }
  .rg-field-hint { font-size:.71rem; color:#9ba8bc; margin-top:4px; padding-left:2px; }
  .rg-field-hint-err { color: #b91c1c; }
  .rg-field-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

  /* Password */
  .rg-pw-wrap { position:relative; }
  .rg-pw-wrap .rg-input { padding:0 46px 0 40px; }
  .rg-eye { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:38px; height:38px; background:transparent; border:none; border-radius:9px; color:#9ca3af; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s,color .15s; z-index:2; padding:0; }
  .rg-eye svg { width:17px; height:17px; display:block; pointer-events:none; }
  .rg-eye:hover { background:#f3f5f9; color:var(--ink-2); }
  .rg-eye:active { background:#e9edf3; }

  /* PW checks */
  .rg-pw-checks { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }
  .rg-pw-check { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; font-size:.69rem; font-weight:700; }
  .rg-pw-check svg { width:11px; height:11px; }
  .rg-pw-dot { width:6px; height:6px; border-radius:50%; background:#c4cdd9; flex-shrink:0; }

  /* Confirm match indicator */
  .rg-confirm-match { display:flex; align-items:center; gap:5px; margin-top:5px; font-size:.72rem; font-weight:700; padding-left:2px; }
  .rg-confirm-match svg { width:13px; height:13px; }

  /* Terms */
  .rg-terms { display:flex; align-items:flex-start; gap:9px; margin-top:4px; margin-bottom:2px; cursor:pointer; }
  .rg-terms input[type="checkbox"] { width:15px; height:15px; flex-shrink:0; margin-top:2px; accent-color:var(--blue); cursor:pointer; }
  .rg-terms-label { font-size:.77rem; color:var(--ink-2); line-height:1.5; user-select:none; }
  .rg-terms-link { color:var(--blue); font-weight:700; cursor:pointer; background:none; border:none; font:inherit; font-size:.77rem; padding:0; }
  .rg-terms-link:hover { text-decoration:underline; }

  /* Actions */
  .rg-actions { display:flex; gap:8px; margin-top:14px; }
  .rg-btn-main {
    flex:1; height:44px; border:none; border-radius:11px;
    background:linear-gradient(135deg,#1e4d8c 0%,#0e2340 100%);
    color:#fff; font-weight:700; font-size:.89rem; cursor:pointer; letter-spacing:.01em;
    box-shadow:0 4px 14px rgba(14,35,64,.22);
    display:flex; align-items:center; justify-content:center; gap:7px;
    transition:transform .18s,box-shadow .18s,opacity .18s;
  }
  .rg-btn-main svg { width:15px; height:15px; }
  .rg-btn-main:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 22px rgba(14,35,64,.28); }
  .rg-btn-main:disabled { opacity:.65; cursor:not-allowed; }

  .rg-btn-ghost {
    height:44px; padding:0 16px; border-radius:11px;
    border:1.5px solid var(--line); background:#fff; color:var(--ink-2);
    font-weight:700; font-size:.89rem; cursor:pointer;
    transition:border-color .18s,background .18s;
  }
  .rg-btn-ghost:hover { border-color:#93b4e8; background:#f0f5ff; }

  .rg-footnote { margin-top:12px; text-align:center; color:#9ba8bc; font-size:.76rem; line-height:1.55; }
  .rg-footnote-link { color:var(--blue); font-weight:700; border:none; background:none; cursor:pointer; font:inherit; font-size:.76rem; }
  .rg-footnote-link:hover { text-decoration:underline; }

  /* ---- Responsive: tablet & phone ---- */
  @media (max-width: 900px) {
    html, body, #root { height: auto; overflow: auto; }
    .rg-page { height: auto; min-height: 100vh; padding: 0; align-items: stretch; }
    .rg-shell {
      grid-template-columns: 1fr; height: auto; max-height: none; min-height: 100vh;
      max-width: 560px; margin: 0 auto; border-radius: 0; border: none; box-shadow: none;
    }
    .rg-brand { padding: 16px 22px; }
    .rg-brand::before, .rg-brand::after { display: none; }
    .rg-brand-body, .rg-brand-foot { display: none; }
    .rg-form-panel { padding: 24px 22px 40px; overflow: visible; align-items: flex-start; }
    .rg-form-inner { max-width: 460px; margin: 0 auto; }
  }
  @media (max-width: 430px) {
    .rg-form-panel { padding: 20px 16px 36px; }
    .rg-form-head h2 { font-size: 1.55rem; }
  }
`;

const HIGHLIGHTS = [
  { title: "Secure registration",    desc: "Password-validated with secure encrypted storage." },
  { title: "Patient portal access",  desc: "Book appointments, view records, and track prescriptions." },
  { title: "Walk-in also supported", desc: "Already visited us? Ask staff to set up your account." },
];

// Bump this when the Data Privacy Statement / Terms text below changes, so the
// stored consent version reflects what the patient actually agreed to.
const PRIVACY_VERSION = "1.0";

const LEGAL = {
  privacy: {
    title: "Data Privacy Statement",
    intro:
      "QELCare (KOBE Clinic) values and protects your personal data in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) of the Philippines.",
    sections: [
      ["What we collect", "Your name, date of birth, contact details (email and phone), and the health information you or your doctors provide — appointments, medical records, vitals, and lab result files you choose to upload."],
      ["How we use it", "To create and secure your account, manage your appointments, store your medical records and results, and send you clinic updates and verification codes."],
      ["How we protect it", "Passwords and verification codes are encrypted, access is restricted by staff role, and information is transmitted over secured connections."],
      ["Your rights", "You may access, correct, or request deletion of your personal data, and withdraw consent, by contacting the clinic."],
      ["Your consent", "By creating an account, you consent to the collection and processing of your personal and health information for the purposes described above."],
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "By creating a QELCare account and using the patient portal, you agree to the following:",
    sections: [
      ["Accurate information", "You will provide true and accurate details about yourself and any relative you are authorized to book for."],
      ["Proper use", "You will use the portal only for your own care, or for a relative you are authorized to assist, and will not attempt to access other users' data."],
      ["Not a medical service", "Patient tools — including AI text extraction for uploaded papers — are for personal tracking only and do not replace professional medical advice or an official clinic record."],
      ["Account security", "You are responsible for keeping your login credentials confidential. The clinic may suspend accounts that violate these terms."],
    ],
  },
};

export default function RegisterScreen() {
  const navigate = useNavigate();
  const [step,      setStep]      = useState(1);
  const [form,      setForm]      = useState(EMPTY);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [showPw,    setShowPw]    = useState(false);
  const [showCPw,   setShowCPw]   = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [legalView, setLegalView] = useState(null); // "privacy" | "terms" | null

  // Let keyboard users dismiss the legal modal with Escape.
  useEffect(() => {
    if (!legalView) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setLegalView(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legalView]);

  // Name fields are normalized live: invalid characters are blocked and each word
  // is auto-capitalized ("kelly celocia" -> "Kelly Celocia") as the user types,
  // matching what the backend stores.
  const NAME_FIELDS = ["first_name", "last_name", "middle_name"];
  const handle = e => {
    const { name, value } = e.target;
    let v = value;
    if (NAME_FIELDS.includes(name)) {
      v = value
        .replace(/[^A-Za-zÀ-ÿ.'\- ]/g, "")
        .toLowerCase()
        .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
    }
    setForm(p => ({ ...p, [name]: v }));
    setError("");
  };

  // -- Per-step validation ---------------------------------------------------
  const validate = (s) => {
    if (s === 1) {
      if (!form.first_name.trim()) return "First name is required.";
      if (form.first_name.trim().length < 2) return "First name must be at least 2 characters.";
      if (!form.last_name.trim())  return "Last name is required.";
      if (form.last_name.trim().length < 2)  return "Last name must be at least 2 characters.";
      if (!form.date_of_birth)     return "Date of birth is required.";
      const age = calcAge(form.date_of_birth);
      if (age < 1)  return "Please enter a valid date of birth.";
      if (age > 120) return "Please enter a valid date of birth.";
      if (form.phone && !isValidPhone(form.phone)) {
        return "Invalid phone number. Use 09XXXXXXXXX or +639XXXXXXXXX format.";
      }
    }
    if (s === 2) {
      if (!form.email.trim()) return "Email is required.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Invalid email format.";
      if (!form.username.trim()) return "Username is required.";
      const uErr = usernameHint(form.username.trim());
      if (uErr) return uErr;
    }
    if (s === 3) {
      if (!form.password) return "Password is required.";
      if (!pwValid(form.password)) return "Password does not meet all requirements.";
      if (!form.confirm)  return "Please confirm your password.";
      if (form.password !== form.confirm) return "Passwords do not match.";
      if (!agreedToTerms) return "You must agree to the Terms of Service to register.";
    }
    return null;
  };

  const next = () => {
    const e = validate(step);
    if (e) return setError(e);
    setError("");
    setStep(s => s + 1);
  };
  const back = () => { setStep(s => s - 1); setError(""); };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const err = validate(3);
    if (err) return setError(err);
    setLoading(true); setError("");
    try {
      const payload = {
        first_name:    form.first_name.trim(),
        last_name:     form.last_name.trim(),
        date_of_birth: form.date_of_birth,
        email:         form.email.trim().toLowerCase(),
        username:      form.username.trim().toLowerCase(),
        password:      form.password,
        privacy_agreed: true,
        privacy_version: PRIVACY_VERSION,
        ...(form.phone ? { phone: form.phone.trim() } : {}),
      };
      const res  = await fetch(`${API_URL}/auth/patient/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || "Registration failed. Please try again.");
      sessionStorage.setItem("otp_email", payload.email);
      sessionStorage.setItem("otp_flow", "registration");
      sessionStorage.removeItem("otp_code");
      setSuccess(data.message || "Account created. Redirecting to email verification...");
      setTimeout(() => navigate("/verify-email"), 1600);
    } catch {
      setError("Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const checks = checkPw(form.password);
  const confirmMatch = form.confirm && form.confirm === form.password;
  const confirmMismatch = form.confirm && form.confirm !== form.password;
  const uHint = usernameHint(form.username);
  const age   = calcAge(form.date_of_birth);

  return (
    <>
      <style>{styles}</style>
      <div className="rg-page">
        <div className="rg-shell">

          {/* -- Brand -- */}
          <section className="rg-brand">
            <div className="rg-grid-bg" />
            <div className="rg-brand-top">
              <div className="rg-logo">
                <div className="rg-logo-mark"><PlusIcon /></div>
                <span>QELCare Portal</span>
              </div>
              <button
                className="rg-home-btn"
                onClick={() => navigate("/")}
                title="Go to home page"
              >
                <HomeIcon /> Home
              </button>
            </div>

            <div className="rg-brand-body">
              <div className="rg-eyebrow"><span className="rg-eyebrow-dot" />New Patient Registration</div>
              <h1>Create your<br /><em>QELCare patient account.</em></h1>
              <p className="rg-brand-desc">Register as a new patient to book appointments, access your records, and manage your health services online.</p>
              <div className="rg-highlights">
                {HIGHLIGHTS.map(h => (
                  <div className="rg-highlight" key={h.title}>
                    <strong>{h.title}</strong>
                    <span>{h.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rg-brand-foot">
              <span>QELCare Clinic Management System</span>
              <span className="rg-foot-badge"><ShieldIcon />Patient self-registration</span>
            </div>
          </section>

          {/* -- Form -- */}
          <section className="rg-form-panel">
            <div className="rg-form-inner">

              <button className="rg-back" onClick={() => step > 1 ? back() : navigate("/login")}>
                <ArrowLeftIcon />
                {step > 1 ? "Previous step" : "Back to sign in"}
              </button>

              <div className="rg-form-head">
                <h2>Create account</h2>
                <p>Step {step} of 3 - {STEPS[step - 1]}</p>
              </div>

              {/* Step progress bar */}
              <div className="rg-step-bar">
                {[1, 2, 3].map(s => (
                  <div key={s} className="rg-step-pill" style={{
                    background: s < step ? "#059669" : s === step ? "#1e4d8c" : "#e5eaf3"
                  }} />
                ))}
              </div>
              <div className="rg-step-labels">
                {STEPS.map((label, i) => (
                  <span key={label} className="rg-step-label" style={{
                    color: i + 1 < step ? "#059669" : i + 1 === step ? "#1e4d8c" : "#c4cdd9",
                  }}>
                    {label}
                  </span>
                ))}
              </div>

              <div className="rg-badge"><span className="rg-badge-dot" />Patient Registration</div>

              {error   && <div className="rg-alert rg-alert-error" role="alert"><AlertIcon />{error}</div>}
              {success && <div className="rg-alert rg-alert-success" role="status"><CheckIcon />{success}</div>}

              <form onSubmit={handleSubmit} noValidate>

                {/* -- Step 1: Personal Info -- */}
                {step === 1 && <>
                  <div className="rg-field-row">
                    <div className="rg-field">
                      <label className="rg-label">First Name</label>
                      <div className="rg-input-wrap">
                        <input
                          className="rg-input rg-input-no-icon"
                          name="first_name"
                          value={form.first_name}
                          onChange={handle}
                          placeholder="Juan"
                          maxLength={50}
                          autoComplete="given-name"
                        />
                      </div>
                    </div>
                    <div className="rg-field">
                      <label className="rg-label">Last Name</label>
                      <div className="rg-input-wrap">
                        <input
                          className="rg-input rg-input-no-icon"
                          name="last_name"
                          value={form.last_name}
                          onChange={handle}
                          placeholder="dela Cruz"
                          maxLength={50}
                          autoComplete="family-name"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rg-field">
                    <label className="rg-label">
                      Date of Birth
                    </label>
                    <div className="rg-input-wrap">
                      <span className="rg-input-icon"><CalendarIcon /></span>
                      <input
                        className="rg-input"
                        type="date"
                        name="date_of_birth"
                        value={form.date_of_birth}
                        onChange={handle}
                        min={minDOB()}
                        max={maxDOB()}
                        autoComplete="bdate"
                      />
                    </div>
                    {age !== null && age >= 0 && (
                      <p className="rg-field-hint">Age: {age} year{age !== 1 ? "s" : ""} old</p>
                    )}
                  </div>

                  <div className="rg-field">
                    <label className="rg-label">
                      Phone Number <span className="rg-label-opt">(optional)</span>
                    </label>
                    <div className="rg-input-wrap">
                      <span className="rg-input-icon"><PhoneIcon /></span>
                      <input
                        className={`rg-input${form.phone && !isValidPhone(form.phone) ? " rg-input-error" : ""}`}
                        name="phone"
                        value={form.phone}
                        onChange={handle}
                        placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                        maxLength={20}
                        autoComplete="tel"
                        inputMode="tel"
                      />
                    </div>
                    {form.phone && !isValidPhone(form.phone) && (
                      <p className="rg-field-hint rg-field-hint-err">Format: 09XXXXXXXXX or +639XXXXXXXXX</p>
                    )}
                  </div>
                </>}

                {/* -- Step 2: Account Setup -- */}
                {step === 2 && <>
                  <div className="rg-field">
                    <label className="rg-label">Email Address</label>
                    <div className="rg-input-wrap">
                      <span className="rg-input-icon"><MailIcon /></span>
                      <input
                        className="rg-input"
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handle}
                        placeholder="name@example.com"
                        maxLength={100}
                        autoComplete="email"
                        inputMode="email"
                      />
                    </div>
                    <p className="rg-field-hint">Used for account recovery and notifications.</p>
                  </div>

                  <div className="rg-field">
                    <label className="rg-label">Username</label>
                    <div className="rg-input-wrap">
                      <span className="rg-input-icon"><UserIcon /></span>
                      <input
                        className={`rg-input${uHint && form.username ? " rg-input-error" : ""}`}
                        name="username"
                        value={form.username}
                        onChange={handle}
                        placeholder="Choose a unique username"
                        maxLength={30}
                        autoComplete="username"
                        autoCapitalize="none"
                      />
                    </div>
                    {form.username && (
                      <p className={`rg-field-hint${uHint ? " rg-field-hint-err" : ""}`}>
                        {uHint
                          ? uHint
                          : "Looks good — 3-30 characters, letters/numbers/_ . -"}
                      </p>
                    )}
                    {!form.username && (
                      <p className="rg-field-hint">3-30 characters. Letters, numbers, _ . - allowed. Must start with a letter.</p>
                    )}
                  </div>
                </>}

                {/* -- Step 3: Password -- */}
                {step === 3 && <>
                  <div className="rg-field">
                    <label className="rg-label">Password</label>
                    <div className="rg-pw-wrap">
                      <span className="rg-input-icon" style={{zIndex:1}}><LockIcon /></span>
                      <input
                        className="rg-input"
                        type={showPw ? "text" : "password"}
                        name="password"
                        value={form.password}
                        onChange={handle}
                        placeholder="Create a secure password"
                        maxLength={128}
                        autoComplete="new-password"
                      />
                      <button type="button" className="rg-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? "Hide" : "Show"}>
                        {showPw ? <EyeClosed /> : <EyeOpen />}
                      </button>
                    </div>
                    {form.password && (
                      <div className="rg-pw-checks">
                        {PW_CHECKS.map(({ key, label }) => (
                          <span key={key} className="rg-pw-check" style={{
                            background: checks[key] ? "#eaf8f0" : "#f1f3f7",
                            color:      checks[key] ? "#059669" : "#9ba8bc",
                          }}>
                            {checks[key] ? <CheckIcon /> : <span className="rg-pw-dot" />}
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rg-field">
                    <label className="rg-label">Confirm Password</label>
                    <div className="rg-pw-wrap">
                      <span className="rg-input-icon" style={{zIndex:1}}><LockIcon /></span>
                      <input
                        className={`rg-input${confirmMismatch ? " rg-input-error" : ""}`}
                        type={showCPw ? "text" : "password"}
                        name="confirm"
                        value={form.confirm}
                        onChange={handle}
                        placeholder="Re-enter password"
                        maxLength={128}
                        autoComplete="new-password"
                      />
                      <button type="button" className="rg-eye" onClick={() => setShowCPw(v => !v)} aria-label={showCPw ? "Hide" : "Show"}>
                        {showCPw ? <EyeClosed /> : <EyeOpen />}
                      </button>
                    </div>
                    {confirmMatch && (
                      <div className="rg-confirm-match" style={{ color: "#059669" }}>
                        <CheckIcon />Passwords match
                      </div>
                    )}
                    {confirmMismatch && (
                      <div className="rg-confirm-match" style={{ color: "#b91c1c" }}>
                        <AlertIcon />Passwords do not match
                      </div>
                    )}
                  </div>

                  {/* Terms of Service */}
                  <label className="rg-terms">
                    <input
                      type="checkbox"
                      checked={agreedToTerms}
                      onChange={e => { setAgreedToTerms(e.target.checked); setError(""); }}
                    />
                    <span className="rg-terms-label">
                      I agree to the{" "}
                      <button
                        type="button"
                        className="rg-terms-link"
                        onClick={e => { e.preventDefault(); setLegalView("terms"); }}
                      >
                        Terms of Service
                      </button>
                      {" "}and{" "}
                      <button
                        type="button"
                        className="rg-terms-link"
                        onClick={e => { e.preventDefault(); setLegalView("privacy"); }}
                      >
                        Data Privacy Statement
                      </button>
                    </span>
                  </label>
                </>}

                {/* -- Navigation -- */}
                <div className="rg-actions">
                  {step < 3 && (
                    <button type="button" className="rg-btn-main" onClick={next}>
                      Continue <ArrowRightIcon />
                    </button>
                  )}
                  {step === 3 && (
                    <button
                      type="submit"
                      className="rg-btn-main"
                      disabled={loading || !!success}
                    >
                      {loading ? "Creating account..." : success ? "Done!" : "Create Account"}
                    </button>
                  )}
                </div>
              </form>

              <p className="rg-footnote">
                Already have an account?{" "}
                <button className="rg-footnote-link" onClick={() => navigate("/login")}>
                  Sign in here
                </button>
              </p>

            </div>
          </section>

        </div>
      </div>

      {legalView && (
        <div
          onClick={() => setLegalView(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(8,18,33,.5)", display: "grid", placeItems: "center", padding: 16, zIndex: 100 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rg-legal-title"
            onClick={e => e.stopPropagation()}
            style={{ width: "min(560px, 96vw)", maxHeight: "86vh", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(14,35,64,.28)", fontFamily: "'DM Sans', system-ui, sans-serif" }}
          >
            <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #e8eef6", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 id="rg-legal-title" style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#0e2340", display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: "#eef4fb", color: "#163a6b", display: "grid", placeItems: "center", flexShrink: 0 }}><ShieldIcon size={17} /></span>
                {LEGAL[legalView].title}
              </h3>
              <button
                type="button"
                onClick={() => setLegalView(null)}
                aria-label="Close"
                style={{ border: 0, background: "#eef4fb", color: "#163a6b", width: 34, height: 34, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div style={{ padding: "16px 20px 22px" }}>
              <p style={{ margin: "0 0 14px", color: "#42526a", fontSize: 14, lineHeight: 1.6 }}>{LEGAL[legalView].intro}</p>
              {LEGAL[legalView].sections.map(([heading, body]) => (
                <div key={heading} style={{ marginBottom: 14 }}>
                  <div style={{ color: "#0e2340", fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{heading}</div>
                  <div style={{ color: "#5a6a7e", fontSize: 13.5, lineHeight: 1.6 }}>{body}</div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => { setAgreedToTerms(true); setLegalView(null); setError(""); }}
                  style={{ border: 0, borderRadius: 10, padding: "10px 16px", background: "#163a6b", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
                  I Understand &amp; Agree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
