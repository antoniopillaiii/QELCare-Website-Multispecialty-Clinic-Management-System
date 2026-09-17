import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { saveLoginData, API_URL, consumeSessionExpired } from "../../utils/auth";
import {
  Plus as PlusIcon,
  User as UserIcon,
  Lock as LockIcon,
  Eye as EyeOpen,
  EyeOff as EyeClosed,
  UserPlus as UserPlusIcon,
  ShieldCheck as ShieldIcon,
  KeyRound as KeyIcon,
  LayoutGrid as GridIcon,
  CircleAlert as AlertIcon,
  Check as CheckIcon,
  Home as HomeIcon,
  TriangleAlert as WarnIcon,
  Clock as ClockIcon,
  MessageSquareText as InquiryIcon,
  Send as SendIcon,
  X as CloseIcon,
} from "lucide-react";

const ROLE_REDIRECT = {
  Admin:   "/admin/dashboard",
  Doctor:  "/doctor/dashboard",
  Nurse:   "/nurse-station",
  Cashier: "/cashier/dashboard",
  Patient: "/dashboard",
  Frontdesk: "/frontdesk/dashboard",
};

const FEATURES = [
  { icon: <GridIcon />,   title: "Role-Based Access",  desc: "Admin, Doctor, Nurse, Cashier & Patient." },
  { icon: <ShieldIcon />, title: "Secure & Protected", desc: "JWT auth with lockout protection." },
  { icon: <KeyIcon />,    title: "Clinic-Ready",       desc: "Built for QELCare multispecialty." },
];

// """ Lockout Countdown """"""""""""""""""""""""""""""""""""""""""""""""""""""""
function LockoutCountdown({ until, onExpired }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const calc = () => Math.max(0, Math.floor((new Date(until) - Date.now()) / 1000));
    setRemaining(calc());
    const id = setInterval(() => {
      const r = calc();
      setRemaining(r);
      if (r === 0) { clearInterval(id); onExpired?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [until, onExpired]);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {m > 0 ? `${m}m ` : ""}{String(s).padStart(2, "0")}s
    </span>
  );
}

// """ Styles """""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Serif+Display:ital@0;1&display=swap');

  :root {
    --navy:   #0e2340;
    --navy-2: #163a6b;
    --navy-3: #1e4d8c;
    --blue:   #2d6be4;
    --teal:   #0e8a7a;
    --ink:    #111827;
    --ink-2:  #374151;
    --muted:  #6b7280;
    --line:   #e5eaf3;
    --warn:   #b45309;
    --warn-bg:#fffbeb;
    --warn-bd:#fde68a;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; overflow: hidden; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: linear-gradient(135deg, #eef2fb 0%, #f4f7fc 60%, #eaf0f9 100%); }
  button, input { font: inherit; outline: none; }

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
    .ls-btn:hover:not(:disabled), .ls-patient-btn:hover, .ls-home-btn:hover { transform: none; }
  }

  /* Inquiry modal inputs — match the login field focus treatment. */
  .ls-inq-input:focus { border-color: var(--blue); background: #fff; box-shadow: 0 0 0 3px rgba(45,107,228,.11); }

  /* "" Page "" */
  .ls-page { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .ls-shell {
    width: 100%; max-width: 1100px;
    height: calc(100vh - 40px); max-height: 760px;
    display: grid; grid-template-columns: 1.1fr 0.9fr;
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 24px 64px rgba(14,35,64,.18), 0 2px 6px rgba(14,35,64,.08);
    border: 1px solid rgba(255,255,255,.7);
  }

  /* "" Brand "" */
  .ls-brand {
    position: relative; display: flex; flex-direction: column;
    justify-content: space-between; padding: 36px 42px;
    color: #fff; background: linear-gradient(148deg, #0e2340 0%, #1e4d8c 100%); overflow: hidden;
  }
  .ls-brand::before {
    content: ""; position: absolute; width: 480px; height: 480px; top: -180px; right: -140px;
    border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.1) 0%, transparent 68%); pointer-events: none;
  }
  .ls-brand::after {
    content: ""; position: absolute; width: 300px; height: 300px; left: -90px; bottom: -100px;
    border-radius: 50%; background: radial-gradient(circle, rgba(45,107,228,.26) 0%, transparent 70%); pointer-events: none;
  }
  .ls-grid-bg {
    position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 36px 36px;
  }
  .ls-brand-top, .ls-brand-body, .ls-brand-foot { position: relative; z-index: 1; }

  /* Brand top row: logo + home button */
  .ls-brand-top { display: flex; align-items: center; justify-content: space-between; }
  .ls-logo { display: inline-flex; align-items: center; gap: 11px; font-size: .9rem; font-weight: 700; }
  .ls-logo-mark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2); }
  .ls-logo-mark svg { width: 18px; height: 18px; }

  .ls-home-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 14px; border-radius: 10px;
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
    color: rgba(255,255,255,.85); font-size: .78rem; font-weight: 700;
    cursor: pointer; transition: background .18s, color .18s; letter-spacing: .01em;
  }
  .ls-home-btn svg { width: 14px; height: 14px; }
  .ls-home-btn:hover { background: rgba(255,255,255,.18); color: #fff; }

  .ls-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15);
    font-size: .7rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 16px;
  }
  .ls-eyebrow-dot { width: 7px; height: 7px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 4px rgba(94,234,212,.18); }

  .ls-brand h1 { font-family: 'DM Serif Display', Georgia, serif; font-size: clamp(1.9rem, 2.8vw, 2.9rem); line-height: 1.08; letter-spacing: -.02em; font-weight: 400; margin-bottom: 12px; }
  .ls-brand h1 em { font-style: italic; color: rgba(255,255,255,.75); }
  .ls-brand-desc { color: rgba(255,255,255,.65); font-size: .86rem; line-height: 1.68; max-width: 380px; margin-bottom: 26px; }

  .ls-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .ls-feat { padding: 14px 15px; border-radius: 14px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.11); }
  .ls-feat-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.14); margin-bottom: 8px; }
  .ls-feat-icon svg { width: 14px; height: 14px; }
  .ls-feat strong { display: block; font-size: .78rem; font-weight: 700; margin-bottom: 3px; }
  .ls-feat span { color: rgba(255,255,255,.6); font-size: .73rem; line-height: 1.45; }

  .ls-brand-foot { display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,.42); font-size: .76rem; flex-wrap: wrap; gap: 8px; }
  .ls-foot-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); font-size: .7rem; font-weight: 600; }
  .ls-foot-badge svg { width: 12px; height: 12px; }

  /* "" Form panel "" */
  .ls-form-panel { display: flex; align-items: center; justify-content: center; padding: 36px 44px; background: #fff; overflow-y: auto; }
  .ls-form-inner { width: 100%; max-width: 360px; }

  .ls-form-head { margin-bottom: 20px; }
  .ls-form-head h2 { font-family: 'DM Serif Display', Georgia, serif; font-size: 1.85rem; font-weight: 400; letter-spacing: -.02em; color: var(--ink); margin-bottom: 5px; }
  .ls-form-head p { color: var(--muted); font-size: .84rem; line-height: 1.6; }

  .ls-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; background: #f0fdf9; border: 1px solid #bbf0de; color: var(--teal); font-size: .74rem; font-weight: 700; margin-bottom: 18px; }
  .ls-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 3px rgba(14,138,122,.15); }

  /* Alerts */
  .ls-alert { display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; border-radius: 11px; font-size: .83rem; font-weight: 500; margin-bottom: 13px; line-height: 1.5; }
  .ls-alert svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
  .ls-alert-error   { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .ls-alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
  .ls-alert-warn    { background: var(--warn-bg); border: 1px solid var(--warn-bd); color: var(--warn); }
  .ls-alert-lock    { background: #faf5ff; border: 1px solid #ddd6fe; color: #6d28d9; }

  /* Attempts bar */
  .ls-attempts { margin-top: -6px; margin-bottom: 10px; }
  .ls-attempts-track { height: 4px; border-radius: 99px; background: #f1f3f7; overflow: hidden; margin-top: 6px; }
  .ls-attempts-fill  { height: 100%; border-radius: 99px; transition: width .35s, background .35s; }

  /* Fields */
  .ls-field { margin-bottom: 14px; }
  .ls-label { display: block; font-size: .79rem; font-weight: 700; color: var(--ink-2); margin-bottom: 6px; letter-spacing: .01em; }
  .ls-input-wrap { position: relative; }
  .ls-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #b0bbc9; width: 16px; height: 16px; pointer-events: none; }
  .ls-input-icon svg { width: 16px; height: 16px; }
  .ls-input {
    width: 100%; height: 47px;
    border: 1.5px solid var(--line); background: #fafbfd; border-radius: 11px;
    padding: 0 14px 0 42px; color: var(--ink); font-size: .89rem;
    transition: border-color .18s, box-shadow .18s, background .18s;
  }
  .ls-input::placeholder { color: #c8d0dc; }
  .ls-input:focus { border-color: var(--blue); background: #fff; box-shadow: 0 0 0 3px rgba(45,107,228,.11); }
  .ls-input-pr { padding-right: 46px; }
  .ls-input-error { border-color: #fca5a5 !important; background: #fff8f8 !important; }

  .ls-toggle {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 38px; height: 38px; background: transparent; border-radius: 9px;
    color: #9ca3af; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background .15s, color .15s; border: none; z-index: 2; padding: 0;
  }
  .ls-toggle svg { width: 18px; height: 18px; display: block; pointer-events: none; }
  .ls-toggle:hover { background: #f3f5f9; color: var(--ink-2); }
  .ls-toggle:active { background: #e9edf3; }

  /* Remember me + forgot */
  .ls-row-meta { display: flex; align-items: center; justify-content: space-between; margin: -2px 0 16px; }
  .ls-remember { display: flex; align-items: center; gap: 7px; cursor: pointer; }
  .ls-remember input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--blue); cursor: pointer; border-radius: 4px; }
  .ls-remember-label { font-size: .79rem; font-weight: 600; color: var(--ink-2); user-select: none; }
  .ls-link { color: var(--blue); font-size: .81rem; font-weight: 700; border: none; background: none; cursor: pointer; padding: 4px 0; transition: color .15s; }
  .ls-link:hover { color: var(--navy-2); text-decoration: underline; }

  /* Submit */
  .ls-btn {
    width: 100%; height: 47px; border: none; border-radius: 11px;
    background: linear-gradient(135deg, #1e4d8c 0%, #0e2340 100%);
    color: #fff; font-weight: 700; font-size: .91rem; cursor: pointer; letter-spacing: .01em;
    box-shadow: 0 4px 14px rgba(14,35,64,.22);
    transition: transform .18s, box-shadow .18s, opacity .18s;
  }
  .ls-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(14,35,64,.28); }
  .ls-btn:disabled { opacity: .65; cursor: not-allowed; }

  /* Divider */
  .ls-divider { display: flex; align-items: center; gap: 10px; margin: 16px 0 13px; }
  .ls-divider-line { flex: 1; height: 1px; background: var(--line); }
  .ls-divider-label { font-size: .67rem; font-weight: 800; color: #b0bac8; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }

  .ls-patient-box { background: #f8fafd; border: 1.5px solid var(--line); border-radius: 14px; padding: 14px 15px; }
  .ls-patient-lbl { font-size: .68rem; font-weight: 800; color: #9ba8bc; letter-spacing: .09em; text-transform: uppercase; margin-bottom: 10px; text-align: center; }
  .ls-patient-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ls-patient-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    height: 41px; border-radius: 10px; border: 1.5px solid var(--line);
    background: #fff; color: var(--navy-2); font-size: .81rem; font-weight: 700;
    cursor: pointer; box-shadow: 0 1px 3px rgba(14,35,64,.05);
    transition: border-color .18s, background .18s, box-shadow .18s, transform .15s;
  }
  .ls-patient-btn svg { width: 14px; height: 14px; }
  .ls-patient-btn:hover { border-color: #93b4e8; background: #f0f5ff; box-shadow: 0 4px 10px rgba(45,107,228,.1); transform: translateY(-1px); }

  .ls-footnote { margin-top: 13px; text-align: center; color: #9ba8bc; font-size: .75rem; line-height: 1.55; }

  /* Lockout overlay on button */
  .ls-btn-lock { background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%) !important; }

  /* ---- Responsive: tablet & phone ---- */
  @media (max-width: 900px) {
    html, body, #root { height: auto; overflow: auto; }
    .ls-page { height: auto; min-height: 100vh; padding: 0; align-items: stretch; }
    .ls-shell {
      grid-template-columns: 1fr; height: auto; max-height: none; min-height: 100vh;
      max-width: 560px; margin: 0 auto; border-radius: 0; border: none; box-shadow: none;
    }
    .ls-brand { padding: 16px 22px; }
    .ls-brand::before, .ls-brand::after { display: none; }
    .ls-brand-body, .ls-brand-foot { display: none; }
    .ls-form-panel { padding: 26px 22px 40px; overflow: visible; align-items: flex-start; }
    .ls-form-inner { max-width: 460px; margin: 0 auto; }
  }
  @media (max-width: 430px) {
    .ls-form-panel { padding: 22px 16px 36px; }
    .ls-patient-btns { grid-template-columns: 1fr; }
    .ls-form-head h2 { font-size: 1.6rem; }
  }
`;

const inqInputStyle = { width: "100%", boxSizing: "border-box", border: "1.5px solid #e5eaf3", borderRadius: 10, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", color: "#162235", background: "#fafbfd" };

function Inq({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: "#42526a" }}>
      {label}
      <input className="ls-inq-input" type={type} value={value} onChange={e => onChange(e.target.value)} style={inqInputStyle} />
    </label>
  );
}

const EMPTY_INQUIRY = { full_name: "", email: "", phone: "", subject: "", message: "", preferred_date: "" };

export default function LoginScreen() {
  const navigate = useNavigate();
  const usernameRef = useRef(null);

  const [showInquiry, setShowInquiry] = useState(false);
  const [inq, setInq] = useState(EMPTY_INQUIRY);
  const [inqBusy, setInqBusy] = useState(false);
  const [inqMsg, setInqMsg] = useState("");
  const [inqErr, setInqErr] = useState("");

  const [username,     setUsername]     = useState("");
  const [password,     setPassword]     = useState("");
  const [showPass,     setShowPass]     = useState(false);
  const [rememberMe,   setRememberMe]   = useState(false);
  const [error,        setError]        = useState("");
  const [errorType,    setErrorType]    = useState("error"); // "error" | "warn" | "lock"
  const [success,      setSuccess]      = useState("");
  const [loading,      setLoading]      = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(null); // 1-4 = warning
  const [lockoutUntil, setLockoutUntil] = useState(null); // ISO string when locked
  const [isLocked,     setIsLocked]     = useState(false);

  // Pre-fill username if remembered
  useEffect(() => {
    const saved = localStorage.getItem("qelcare_remembered_user");
    if (saved) { setUsername(saved); setRememberMe(true); }
  }, []);

  // Show a notice when a patient was redirected here by the inactivity timeout.
  useEffect(() => {
    if (consumeSessionExpired()) {
      setError("Session expired. You were signed out due to inactivity — please sign in again.");
      setErrorType("warn");
    }
  }, []);

  // Let keyboard users dismiss the inquiry modal with Escape.
  useEffect(() => {
    if (!showInquiry) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setShowInquiry(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInquiry]);

  const clearFeedback = () => { setError(""); setErrorType("error"); setAttemptsLeft(null); };

  const handleLogin = async () => {
    if (loading) return;
    if (!username.trim()) { setError("Please enter your username."); setErrorType("error"); return; }
    if (!password.trim()) { setError("Please enter your password."); setErrorType("error"); return; }
    if (isLocked) return;

    setLoading(true); clearFeedback(); setSuccess("");

    try {
      const res  = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        // "" Unverified patient account ""
        if (data.code === "ACCOUNT_UNVERIFIED") {
          if (data.email) {
            sessionStorage.setItem("otp_email", String(data.email).toLowerCase());
            sessionStorage.setItem("otp_flow", "registration");
            sessionStorage.removeItem("otp_code");
          }
          setError(data.message || "Account is not yet verified. Redirecting to email verification.");
          setErrorType("warn");
          setLoading(false);
          if (data.email) setTimeout(() => navigate("/verify-email"), 1100);
          return;
        }
        // "" Locked with countdown ""
        if (data.lockout_until) {
          setLockoutUntil(data.lockout_until);
          setIsLocked(true);
          setError(data.message || "Account temporarily locked.");
          setErrorType("lock");
          setLoading(false);
          return;
        }
        // "" Permanent lock ""
        if (data.message?.toLowerCase().includes("permanently locked")) {
          setError(data.message);
          setErrorType("lock");
          setLoading(false);
          return;
        }
        // "" Attempts warning ""
        if (typeof data.attempts_left === "number") {
          setAttemptsLeft(data.attempts_left);
          setError(`Incorrect password - ${data.attempts_left} attempt${data.attempts_left !== 1 ? "s" : ""} left before lockout.`);
          setErrorType("warn");
          setLoading(false);
          return;
        }
        // "" Generic error ""
        setError(data.message || "Invalid credentials.");
        setErrorType("error");
        setLoading(false);
        return;
      }

      // "" Success ""
      if (rememberMe) {
        localStorage.setItem("qelcare_remembered_user", username.trim());
      } else {
        localStorage.removeItem("qelcare_remembered_user");
      }
      saveLoginData(data.token, data.user);
      setSuccess("Login successful! Redirecting...");
      setTimeout(() => navigate(ROLE_REDIRECT[data.user.role] || "/dashboard"), 800);
    } catch {
      setError("Cannot connect to server. Please try again.");
      setErrorType("error");
      setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === "Enter") handleLogin(); };
  const focusUsername = () => usernameRef.current?.focus();

  const submitInquiry = async () => {
    setInqErr(""); setInqMsg("");
    if (!inq.full_name.trim() || !inq.message.trim()) { setInqErr("Please enter your name and a message."); return; }
    if (!inq.email.trim() && !inq.phone.trim()) { setInqErr("Please provide an email or phone so the clinic can reach you."); return; }
    setInqBusy(true);
    try {
      const res = await fetch(`${API_URL}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inq),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send inquiry.");
      setInqMsg(data.message || "Your inquiry has been sent.");
      setInq(EMPTY_INQUIRY);
    } catch (e) {
      setInqErr(e.message || "Cannot connect to server.");
    } finally {
      setInqBusy(false);
    }
  };

  // Attempts bar: 5 max before first lock
  const attemptsBarWidth = attemptsLeft != null ? `${((5 - attemptsLeft) / 5) * 100}%` : "0%";
  const attemptsBarColor = attemptsLeft <= 1 ? "#ef4444" : attemptsLeft <= 2 ? "#f97316" : "#eab308";

  const alertClass = {
    error: "ls-alert-error",
    warn:  "ls-alert-warn",
    lock:  "ls-alert-lock",
  }[errorType] || "ls-alert-error";

  const AlertIconForType = () => {
    if (errorType === "lock") return <ClockIcon />;
    if (errorType === "warn") return <WarnIcon />;
    return <AlertIcon />;
  };

  return (
    <>
      <style>{styles}</style>
      <div className="ls-page">
        <div className="ls-shell">

          {/* "" Brand "" */}
          <section className="ls-brand">
            <div className="ls-grid-bg" />
            <div className="ls-brand-top">
              <div className="ls-logo">
                <div className="ls-logo-mark"><PlusIcon /></div>
                <span>QELCare Portal</span>
              </div>
              <button
                className="ls-home-btn"
                onClick={() => navigate("/")}
                title="Go to home page"
              >
                <HomeIcon /> Home
              </button>
            </div>

            <div className="ls-brand-body">
              <div className="ls-eyebrow">
                <span className="ls-eyebrow-dot" />
                Multispecialty Clinic Management
              </div>
              <h1>Secure sign in for<br /><em>patients and clinic staff.</em></h1>
              <p className="ls-brand-desc">Access appointments, records, billing, and clinic services through one streamlined portal.</p>
              <div className="ls-features">
                {FEATURES.map(f => (
                  <div className="ls-feat" key={f.title}>
                    <div className="ls-feat-icon">{f.icon}</div>
                    <strong>{f.title}</strong>
                    <span>{f.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ls-brand-foot">
              <span>QELCare Clinic Management System</span>
              <span className="ls-foot-badge"><ShieldIcon />Secure access</span>
            </div>
          </section>

          {/* "" Form "" */}
          <section className="ls-form-panel">
            <div className="ls-form-inner">
              <div className="ls-form-head">
                <h2>Sign in</h2>
                <p>Enter your credentials to access your QELCare portal account.</p>
              </div>

              <div className="ls-badge"><span className="ls-badge-dot" />Secure portal authentication</div>

              {/* Alerts - aria-live so screen readers announce changes */}
              {error && (
                <div
                  className={`ls-alert ${alertClass}`}
                  role="alert"
                  aria-live="assertive"
                >
                  <AlertIconForType />
                  <span>
                    {error}
                    {errorType === "lock" && lockoutUntil && (
                      <> &mdash; unlocks in{" "}
                        <LockoutCountdown
                          until={lockoutUntil}
                          onExpired={() => { setIsLocked(false); setLockoutUntil(null); clearFeedback(); }}
                        />
                      </>
                    )}
                  </span>
                </div>
              )}
              {success && (
                <div className="ls-alert ls-alert-success" role="status" aria-live="polite">
                  <CheckIcon />{success}
                </div>
              )}

              {/* Attempts progress bar */}
              {attemptsLeft != null && attemptsLeft < 5 && (
                <div className="ls-attempts">
                  <div className="ls-attempts-track">
                    <div
                      className="ls-attempts-fill"
                      style={{ width: attemptsBarWidth, background: attemptsBarColor }}
                    />
                  </div>
                </div>
              )}

              {/* Username */}
              <div className="ls-field">
                <label className="ls-label" htmlFor="qelcare-username">Username</label>
                <div className="ls-input-wrap">
                  <span className="ls-input-icon"><UserIcon /></span>
                  <input
                    id="qelcare-username"
                    ref={usernameRef}
                    className={`ls-input${error && errorType === "error" && !password ? " ls-input-error" : ""}`}
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={e => { setUsername(e.target.value); clearFeedback(); }}
                    onKeyDown={handleKey}
                    maxLength={50}
                    autoComplete="username"
                    disabled={loading || !!success}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="ls-field">
                <label className="ls-label" htmlFor="qelcare-password">Password</label>
                <div className="ls-input-wrap">
                  <span className="ls-input-icon"><LockIcon /></span>
                  <input
                    id="qelcare-password"
                    className="ls-input ls-input-pr"
                    type={showPass ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); clearFeedback(); }}
                    onKeyDown={handleKey}
                    maxLength={128}
                    autoComplete="current-password"
                    disabled={loading || !!success || isLocked}
                  />
                  <button
                    className="ls-toggle"
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    aria-label={showPass ? "Hide password" : "Show password"}
                  >
                    {showPass ? <EyeClosed /> : <EyeOpen />}
                  </button>
                </div>
              </div>

              {/* Remember me + Forgot */}
              <div className="ls-row-meta">
                <label className="ls-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span className="ls-remember-label">Remember me</span>
                </label>
                <button className="ls-link" onClick={() => navigate("/forgot-password")}>
                  Forgot password?
                </button>
              </div>

              <button
                className={`ls-btn${isLocked ? " ls-btn-lock" : ""}`}
                onClick={handleLogin}
                disabled={loading || !!success || isLocked}
              >
                {loading ? "Signing in..." : success ? "Redirecting..." : isLocked ? "Account Locked" : "Sign in to QELCare"}
              </button>

              <div className="ls-divider">
                <div className="ls-divider-line" />
                <span className="ls-divider-label">Patient Access</span>
                <div className="ls-divider-line" />
              </div>

              <div className="ls-patient-box">
                <p className="ls-patient-lbl">New to QELCare or returning patient?</p>
                <div className="ls-patient-btns">
                  <button className="ls-patient-btn" onClick={() => navigate("/register")}>
                    <UserPlusIcon />New Patient
                  </button>
                  <button className="ls-patient-btn" onClick={focusUsername}>
                    <UserIcon />Existing Patient
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setShowInquiry(true); setInqMsg(""); setInqErr(""); }}
                style={{ marginTop: 10, width: "100%", background: "transparent", border: "1.5px dashed #cddbeb", borderRadius: 12, padding: "11px 12px", color: "#163a6b", fontWeight: 800, fontSize: ".82rem", cursor: "pointer" }}
              >
                Book or ask without an account → Send an inquiry
              </button>

              <p className="ls-footnote">Contact your administrator if you need a new staff account.</p>
            </div>
          </section>

        </div>
      </div>

      {showInquiry && (
        <div onClick={() => setShowInquiry(false)} style={{ position: "fixed", inset: 0, background: "rgba(8,18,33,.5)", display: "grid", placeItems: "center", padding: 16, zIndex: 100 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="ls-inq-title" onClick={e => e.stopPropagation()} style={{ width: "min(520px, 96vw)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(14,35,64,.28)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
            <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #e8eef6", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 id="ls-inq-title" style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#0e2340", display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: "#eef4fb", color: "#163a6b", display: "grid", placeItems: "center", flexShrink: 0 }}><InquiryIcon size={17} /></span>
                Send an Inquiry
              </h3>
              <button onClick={() => setShowInquiry(false)} aria-label="Close" style={{ border: 0, background: "#eef4fb", color: "#163a6b", width: 34, height: 34, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}><CloseIcon size={18} /></button>
            </div>
            <div style={{ padding: "16px 20px 22px", display: "grid", gap: 12 }}>
              <p style={{ margin: 0, color: "#5a6a7e", fontSize: 13.5, lineHeight: 1.55 }}>No account needed. Send your question or a booking request and the clinic front desk will contact you.</p>
              {inqErr && <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontWeight: 700, fontSize: 13 }}><AlertIcon size={16} style={{ flexShrink: 0 }} />{inqErr}</div>}
              {inqMsg ? (
                <>
                  <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontWeight: 700, fontSize: 13 }}><CheckIcon size={16} style={{ flexShrink: 0 }} />{inqMsg}</div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setShowInquiry(false)} style={{ border: 0, background: "#163a6b", color: "#fff", borderRadius: 10, padding: "10px 18px", fontWeight: 800, cursor: "pointer" }}>Done</button>
                  </div>
                </>
              ) : (
                <>
                  <Inq label="Full name *" value={inq.full_name} onChange={v => setInq(s => ({ ...s, full_name: v }))} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Inq label="Email" type="email" value={inq.email} onChange={v => setInq(s => ({ ...s, email: v }))} />
                    <Inq label="Phone" value={inq.phone} onChange={v => setInq(s => ({ ...s, phone: v }))} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
                    <Inq label="Subject" value={inq.subject} onChange={v => setInq(s => ({ ...s, subject: v }))} />
                    <Inq label="Preferred date" type="date" value={inq.preferred_date} onChange={v => setInq(s => ({ ...s, preferred_date: v }))} />
                  </div>
                  <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: "#42526a" }}>
                    Message *
                    <textarea className="ls-inq-input" value={inq.message} onChange={e => setInq(s => ({ ...s, message: e.target.value }))} rows={4} style={inqInputStyle} placeholder="How can the clinic help you?" />
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button onClick={() => setShowInquiry(false)} style={{ border: "1px solid #cddbeb", background: "#fff", color: "#163a6b", borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>Close</button>
                    <button onClick={submitInquiry} disabled={inqBusy} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: 0, background: "#163a6b", color: "#fff", borderRadius: 10, padding: "10px 18px", fontWeight: 800, cursor: "pointer", opacity: inqBusy ? .6 : 1 }}><SendIcon size={15} />{inqBusy ? "Sending..." : "Send Inquiry"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
