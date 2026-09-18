import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../utils/auth";

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>;
}
function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4.5 7.5 12 13l7.5-5.5"/></svg>;
}
function ArrowLeftIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
}
function AlertIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>;
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>;
}
function ShieldIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 4v5c0 4.5-2.9 7.9-7 9-4.1-1.1-7-4.5-7-9V7l7-4z"/><path d="M9.5 12.2l1.8 1.8 3.7-4.2"/></svg>;
}

const styles = `
  :root {
    --navy: #0e2340; --navy-2: #163a6b; --navy-3: #1e4d8c;
    --blue: #2d6be4; --teal: #0e8a7a;
    --ink: #111827; --ink-2: #374151; --muted: #6b7280; --line: #e5eaf3;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; overflow: hidden; }
  body { font-family: 'Inter', system-ui, sans-serif; background: linear-gradient(135deg, #eef2fb 0%, #f4f7fc 60%, #eaf0f9 100%); }
  button, input { font: inherit; outline: none; border: none; }

  .fp-page { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .fp-shell {
    width: 100%; max-width: 1100px;
    height: calc(100vh - 40px); max-height: 760px;
    display: grid; grid-template-columns: 1.1fr 0.9fr;
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 24px 64px rgba(14,35,64,.18), 0 2px 6px rgba(14,35,64,.08);
    border: 1px solid rgba(255,255,255,.7);
  }

  /* Brand */
  .fp-brand {
    position: relative; display: flex; flex-direction: column;
    justify-content: space-between; padding: 36px 42px;
    color: #fff; background: linear-gradient(148deg, #0e2340 0%, #1e4d8c 100%); overflow: hidden;
  }
  .fp-brand::before {
    content: ""; position: absolute; width: 480px; height: 480px; top: -180px; right: -140px;
    border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.1) 0%, transparent 68%); pointer-events: none;
  }
  .fp-brand::after {
    content: ""; position: absolute; width: 300px; height: 300px; left: -90px; bottom: -100px;
    border-radius: 50%; background: radial-gradient(circle, rgba(45,107,228,.26) 0%, transparent 70%); pointer-events: none;
  }
  .fp-grid-bg {
    position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 36px 36px;
  }
  .fp-brand-top, .fp-brand-body, .fp-brand-foot { position: relative; z-index: 1; }

  .fp-logo { display: inline-flex; align-items: center; gap: 11px; font-size: .9rem; font-weight: 700; }
  .fp-logo-mark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2); }
  .fp-logo-mark svg { width: 18px; height: 18px; }

  .fp-eyebrow {
    display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
    background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15);
    font-size: .7rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 16px;
  }
  .fp-eyebrow-dot { width: 7px; height: 7px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 4px rgba(94,234,212,.18); }

  .fp-brand h1 {
    font-size: clamp(1.9rem, 2.8vw, 2.9rem); line-height: 1.1; letter-spacing: -.03em; font-weight: 800; margin-bottom: 12px;
  }
  .fp-brand h1 em { font-style: normal; color: rgba(255,255,255,.72); }
  .fp-brand-desc { color: rgba(255,255,255,.65); font-size: .86rem; line-height: 1.68; max-width: 380px; margin-bottom: 28px; }

  /* step cards */
  .fp-steps { display: grid; gap: 10px; }
  .fp-step {
    display: grid; grid-template-columns: 38px 1fr; gap: 14px; align-items: start;
    padding: 14px 16px; border-radius: 14px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.11);
  }
  .fp-step-num {
    width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px;
    background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.14);
    font-weight: 800; font-size: .9rem;
  }
  .fp-step strong { display: block; font-size: .82rem; font-weight: 700; margin-bottom: 3px; }
  .fp-step span { color: rgba(255,255,255,.62); font-size: .77rem; line-height: 1.5; }

  .fp-brand-foot { display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,.42); font-size: .76rem; flex-wrap: wrap; gap: 8px; }
  .fp-foot-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); font-size: .7rem; font-weight: 600; }
  .fp-foot-badge svg { width: 12px; height: 12px; }

  /* Form */
  .fp-form-panel { display: flex; align-items: center; justify-content: center; padding: 36px 44px; background: #fff; }
  .fp-form-inner { width: 100%; max-width: 360px; }

  .fp-back {
    display: inline-flex; align-items: center; gap: 7px; margin-bottom: 22px;
    color: var(--navy-2); font-size: .83rem; font-weight: 700;
    background: none; border: none; cursor: pointer; padding: 0;
    transition: color .15s, transform .15s;
  }
  .fp-back svg { width: 16px; height: 16px; }
  .fp-back:hover { color: var(--blue); transform: translateX(-2px); }

  .fp-form-head { margin-bottom: 20px; }
  .fp-form-head h2 { font-size: 1.7rem; font-weight: 800; letter-spacing: -.03em; color: var(--ink); margin-bottom: 5px; }
  .fp-form-head p { color: var(--muted); font-size: .84rem; line-height: 1.6; }

  .fp-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; background: #f0fdf9; border: 1px solid #bbf0de; color: var(--teal); font-size: .74rem; font-weight: 700; margin-bottom: 18px; }
  .fp-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 3px rgba(14,138,122,.15); }

  .fp-alert { display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; border-radius: 11px; font-size: .83rem; font-weight: 500; margin-bottom: 13px; line-height: 1.5; }
  .fp-alert svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
  .fp-alert-error   { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .fp-alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }

  .fp-field { margin-bottom: 14px; }
  .fp-label { display: block; font-size: .79rem; font-weight: 700; color: var(--ink-2); margin-bottom: 6px; letter-spacing: .01em; }
  .fp-input-wrap { position: relative; }
  .fp-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #b0bbc9; width: 16px; height: 16px; pointer-events: none; }
  .fp-input-icon svg { width: 16px; height: 16px; }
  .fp-input {
    width: 100%; height: 47px; border: 1.5px solid var(--line); background: #fafbfd; border-radius: 11px;
    padding: 0 14px 0 42px; color: var(--ink); font-size: .89rem;
    transition: border-color .18s, box-shadow .18s, background .18s;
  }
  .fp-input::placeholder { color: #c8d0dc; }
  .fp-input:focus { border-color: var(--blue); background: #fff; box-shadow: 0 0 0 3px rgba(45,107,228,.11); }

  .fp-helper { margin-top: 7px; color: var(--muted); font-size: .78rem; line-height: 1.5; }

  .fp-btn {
    width: 100%; height: 47px; border: none; border-radius: 11px;
    background: linear-gradient(135deg, #1e4d8c 0%, #0e2340 100%);
    color: #fff; font-weight: 700; font-size: .91rem; cursor: pointer; letter-spacing: .01em;
    box-shadow: 0 4px 14px rgba(14,35,64,.22); margin-top: 4px;
    transition: transform .18s, box-shadow .18s, opacity .18s;
  }
  .fp-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(14,35,64,.28); }
  .fp-btn:disabled { opacity: .65; cursor: not-allowed; }

  .fp-footnote { margin-top: 16px; text-align: center; color: #9ba8bc; font-size: .78rem; line-height: 1.55; }
  .fp-footnote-link { color: var(--blue); font-weight: 700; border: none; background: none; cursor: pointer; font: inherit; font-size: .78rem; }
  .fp-footnote-link:hover { text-decoration: underline; }

  /* ---- Responsive: tablet & phone ---- */
  @media (max-width: 900px) {
    html, body, #root { height: auto; overflow: auto; }
    .fp-page { height: auto; min-height: 100vh; padding: 0; align-items: stretch; }
    .fp-shell {
      grid-template-columns: 1fr; height: auto; max-height: none; min-height: 100vh;
      max-width: 560px; margin: 0 auto; border-radius: 0; border: none; box-shadow: none;
    }
    .fp-brand { padding: 16px 22px; }
    .fp-brand::before, .fp-brand::after { display: none; }
    .fp-brand-body, .fp-brand-foot { display: none; }
    .fp-form-panel { padding: 26px 22px 40px; align-items: flex-start; }
    .fp-form-inner { max-width: 460px; margin: 0 auto; }
  }
`;

const STEPS = [
  { n: "1", title: "Enter your email",     desc: "Provide the email linked to your QELCare account." },
  { n: "2", title: "Receive OTP code",     desc: "A 6-digit code is sent to your inbox. Valid for 10 minutes." },
  { n: "3", title: "Set a new password",   desc: "Verify the code and create a new secure password." },
];

export default function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const [email,   setEmail]   = useState("");
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError(""); setSuccess("");
    if (!email.trim())         return setError("Email is required.");
    if (!validateEmail(email)) return setError("Please enter a valid email address.");
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        // Neutral wording on purpose: the backend does NOT reveal whether an account
        // exists (anti-enumeration), so we must not imply the email is definitely
        // registered. If it isn't, no code arrives and the guidance below helps.
        setSuccess("If an account exists for this email, a 6-digit code is on its way. Redirecting...");
        sessionStorage.setItem("otp_email", email.trim().toLowerCase());
        sessionStorage.setItem("otp_flow", "password_reset");
        sessionStorage.removeItem("otp_code");
        setTimeout(() => navigate("/verify-email"), 1500);
      } else {
        setError(data.message || "Failed to send verification code.");
      }
    } catch {
      setError("Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="fp-page">
        <div className="fp-shell">

          {/* Brand */}
          <section className="fp-brand">
            <div className="fp-grid-bg" />
            <div className="fp-brand-top">
              <div className="fp-logo">
                <div className="fp-logo-mark"><PlusIcon /></div>
                <span>QELCare Portal</span>
              </div>
            </div>
            <div className="fp-brand-body">
              <div className="fp-eyebrow"><span className="fp-eyebrow-dot" />Credential Recovery</div>
              <h1>Reset access to your<br /><em>clinic portal account.</em></h1>
              <p className="fp-brand-desc">Request a secure OTP code to recover access. Works for all roles â€” Admin, Doctor, Nurse, Cashier, and Patient.</p>
              <div className="fp-steps">
                {STEPS.map(s => (
                  <div className="fp-step" key={s.n}>
                    <div className="fp-step-num">{s.n}</div>
                    <div><strong>{s.title}</strong><span>{s.desc}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="fp-brand-foot">
              <span>QELCare Clinic Management System</span>
              <span className="fp-foot-badge"><ShieldIcon />Secure recovery</span>
            </div>
          </section>

          {/* Form */}
          <section className="fp-form-panel">
            <div className="fp-form-inner">
              <button className="fp-back" onClick={() => navigate("/login")}>
                <ArrowLeftIcon />Back to sign in
              </button>

              <div className="fp-form-head">
                <h2>Forgot password</h2>
                <p>Enter your registered email and we'll send a 6-digit verification code.</p>
              </div>

              <div className="fp-badge"><span className="fp-badge-dot" />Secure password recovery</div>

              {error   && <div className="fp-alert fp-alert-error"><AlertIcon />{error}</div>}
              {success && <div className="fp-alert fp-alert-success"><CheckIcon />{success}</div>}

              <form onSubmit={handleSubmit}>
                <div className="fp-field">
                  <label className="fp-label" htmlFor="fp-email">Email address</label>
                  <div className="fp-input-wrap">
                    <span className="fp-input-icon"><MailIcon /></span>
                    <input id="fp-email" className="fp-input" type="email"
                      placeholder="name@example.com" value={email}
                      onChange={e => { setEmail(e.target.value); setError(""); }}
                      maxLength={100} autoComplete="email" />
                  </div>
                  <p className="fp-helper">Enter the email address registered to your QELCare account.</p>
                </div>

                <button className="fp-btn" type="submit" disabled={loading || !!success}>
                  {loading ? "Sending..." : success ? "Check your email" : "Send Verification Code"}
                </button>
              </form>

              <p className="fp-footnote">
                Remembered your password?{" "}
                <button className="fp-footnote-link" onClick={() => navigate("/login")}>Sign in here</button>
              </p>
              <p className="fp-footnote">
                No QELCare account for this email?{" "}
                <button className="fp-footnote-link" onClick={() => navigate("/register")}>Create one</button>
              </p>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
