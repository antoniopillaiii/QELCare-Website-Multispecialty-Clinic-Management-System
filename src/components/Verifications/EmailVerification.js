import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../utils/auth";

// Password requirements (same as Bantay)
const checkPassword = (pw) => ({
  length:    pw.length >= 8,
  lowercase: /(?=.*[a-z])/.test(pw),
  uppercase: /(?=.*[A-Z])/.test(pw),
  number:    /(?=.*\d)/.test(pw),
  special:   /(?=.*[@$!%*?&#])/.test(pw),
});
const passwordValid = (pw) => Object.values(checkPassword(pw)).every(Boolean);

export default function EmailVerification() {
  const navigate  = useNavigate();
  const email     = sessionStorage.getItem("otp_email") || "";
  const flow      = sessionStorage.getItem("otp_flow") || "password_reset";
  const isRegistration = flow === "registration";

  const [view, setView]               = useState("verify");   // "verify" | "reset"
  const [code, setCode]               = useState(["","","","","",""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw, setConfirmPw]     = useState("");
  const [showPw, setShowPw]           = useState(false);
  const [showCPw, setShowCPw]         = useState(false);
  const [timer, setTimer]             = useState(600);  // code validity (10 min) — matches backend OTP_TTL_MINUTES
  const [resendIn, setResendIn]       = useState(60);   // resend cooldown — matches backend OTP_COOLDOWN_SECONDS
  const canResend = resendIn <= 0;
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");
  const [loading, setLoading]         = useState(false);
  const inputs = useRef([]);

  // Redirect if no email in session
  useEffect(() => {
    if (!email) navigate(isRegistration ? "/register" : "/forgot-password");
  }, [email, isRegistration, navigate]);

  // Countdown timers: expiry (informational) + resend cooldown (enables Resend).
  // Both run off one interval; resend unlocks after 60s while the code stays valid
  // for the full 10 minutes.
  useEffect(() => {
    if (view !== "verify") return;
    const id = setInterval(() => {
      setTimer(t => (t <= 1 ? 0 : t - 1));
      setResendIn(r => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [view]);

  // -- OTP input handlers ------------------------------------
  const handleCodeChange = (i, val) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...code];
    next[i] = val.slice(-1);
    setCode(next);
    setError("");
    if (val && i < 5) inputs.current[i + 1]?.focus();
  };

  const handleCodeKey = (i, e) => {
    if (e.key === "Backspace" && !code[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  // Let the user paste the whole 6-digit code from their email; distribute the
  // digits across the boxes (non-digits stripped).
  const handleCodePaste = (e) => {
    const digits = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    for (let j = 0; j < digits.length; j += 1) next[j] = digits[j];
    setCode(next);
    setError("");
    inputs.current[Math.min(digits.length, 5)]?.focus();
  };

  // -- Verify OTP --------------------------------------------
  const handleVerify = async () => {
    if (loading) return;
    const fullCode = code.join("");
    if (fullCode.length !== 6) return setError("Please enter all 6 digits.");

    setLoading(true); setError("");
    try {
      const endpoint = isRegistration
        ? `${API_URL}/auth/patient/register/verify`
        : `${API_URL}/auth/otp/verify`;

      const res  = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: fullCode }),
      });
      const data = await res.json();

      if (data.success) {
        if (isRegistration) {
          setSuccess(data.message || "Account verified! Redirecting to sign in...");
          sessionStorage.removeItem("otp_email");
          sessionStorage.removeItem("otp_flow");
          sessionStorage.removeItem("otp_code");
          setTimeout(() => navigate("/login"), 1600);
        } else {
          sessionStorage.setItem("otp_code", fullCode);
          setSuccess("Code verified! Please set your new password.");
          setTimeout(() => { setView("reset"); setSuccess(""); }, 1200);
        }
      } else {
        setError(data.message || "Invalid code.");
        // Clear the boxes so the user retypes cleanly instead of editing stale digits.
        setCode(["", "", "", "", "", ""]);
        inputs.current[0]?.focus();
      }
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  };

  // -- Resend OTP --------------------------------------------
  const handleResend = async () => {
    if (!canResend || loading) return;
    setLoading(true); setError("");
    try {
      const endpoint = isRegistration
        ? `${API_URL}/auth/patient/register/resend`
        : `${API_URL}/auth/otp/resend`;

      const res  = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.success) {
        setTimer(600); setResendIn(60);
        setCode(["","","","","",""]);
        setSuccess("New code sent!"); setTimeout(() => setSuccess(""), 2000);
      } else {
        setError(data.message || "Failed to resend.");
      }
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  };

  // -- Reset Password ----------------------------------------
  const handleReset = async () => {
    if (loading) return;
    if (!newPassword) return setError("New password is required.");
    if (!passwordValid(newPassword)) return setError("Password does not meet all requirements.");
    if (!confirmPw) return setError("Please confirm your new password.");
    if (newPassword !== confirmPw) return setError("Passwords do not match.");
    const resetCode = sessionStorage.getItem("otp_code") || code.join("");
    if (!/^\d{6}$/.test(resetCode)) return setError("Please verify your email code before resetting your password.");

    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: resetCode, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) return setError(data.message || "Reset failed.");

      setSuccess("Password reset successfully! Redirecting to sign in...");
      sessionStorage.removeItem("otp_email");
      sessionStorage.removeItem("otp_flow");
      sessionStorage.removeItem("otp_code");
      setTimeout(() => navigate("/login"), 2000);
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  };

  const checks = checkPassword(newPassword);

  // -- Same style as LoginScreen ----------------------------
  const styles = `
    :root{--primary:#163a6b;--primary-2:#25549a;--primary-3:#4f81d1;
      --ink:#152235;--muted:#66768b;--line:#dbe4f0;--success:#1d8d5c;
      --shadow-lg:0 28px 70px rgba(17,34,68,.18);--shadow-md:0 14px 32px rgba(17,34,68,.10);}
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--ink);
      background:radial-gradient(circle at top left,rgba(79,129,209,.18),transparent 34%),
      radial-gradient(circle at bottom right,rgba(22,58,107,.16),transparent 30%),
      linear-gradient(180deg,#fafdff,#f1f6fc);}
    button,input{font:inherit;}
    .page-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;}
    .shell{width:100%;max-width:1280px;min-height:740px;display:grid;grid-template-columns:1fr 1fr;
      background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.72);border-radius:30px;
      overflow:hidden;box-shadow:var(--shadow-lg);}
    .brand{position:relative;padding:42px 38px;color:#fff;display:flex;flex-direction:column;
      justify-content:space-between;background:linear-gradient(145deg,rgba(22,58,107,.98),rgba(37,84,154,.96));overflow:hidden;}
    .brand::before{content:"";position:absolute;width:360px;height:360px;top:-110px;right:-110px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,.18),rgba(255,255,255,.05) 60%,transparent 74%);}
    .brand::after{content:"";position:absolute;width:280px;height:280px;left:-90px;bottom:-110px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,.12),rgba(255,255,255,.04) 56%,transparent 74%);}
    .brand-top,.brand-hero,.brand-footer{position:relative;z-index:1;}
    .logo{display:inline-flex;align-items:center;gap:12px;font-weight:800;font-size:1.08rem;}
    .logo-mark{width:50px;height:50px;display:grid;place-items:center;border-radius:16px;
      background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);}
    .logo-mark svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;}
    .eyebrow{display:inline-flex;padding:9px 14px;border-radius:999px;background:rgba(255,255,255,.12);
      border:1px solid rgba(255,255,255,.16);font-size:.82rem;font-weight:700;margin-bottom:18px;}
    .brand h1{font-size:clamp(2rem,3.8vw,3.2rem);line-height:1.04;letter-spacing:-.05em;margin-bottom:16px;}
    .brand p{color:rgba(255,255,255,.82);font-size:1rem;line-height:1.68;max-width:530px;}
    .trust-grid{display:grid;gap:14px;margin-top:28px;}
    .trust-card{display:grid;grid-template-columns:42px 1fr;gap:14px;align-items:start;
      padding:16px;border-radius:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);}
    .trust-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;
      background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);}
    .trust-icon svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
    .trust-card strong{display:block;margin-bottom:5px;font-size:.96rem;}
    .trust-card span{color:rgba(255,255,255,.76);font-size:.87rem;line-height:1.55;}
    .brand-footer{display:flex;justify-content:space-between;color:rgba(255,255,255,.72);font-size:.9rem;flex-wrap:wrap;gap:12px;}
    .form-pane{padding:42px 44px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,250,255,.96));
      display:flex;align-items:center;justify-content:center;}
    .form-wrap{width:100%;max-width:480px;}
    .back-link{display:inline-flex;align-items:center;gap:8px;margin-bottom:18px;color:var(--primary-2);
      font-weight:700;font-size:.92rem;border:none;background:none;cursor:pointer;}
    .back-link:hover{text-decoration:underline;}
    .auth-head{margin-bottom:22px;}
    .auth-head h2{font-size:2rem;letter-spacing:-.04em;margin-bottom:8px;}
    .auth-head p{color:var(--muted);font-size:.96rem;line-height:1.65;}
    .email-display{font-weight:700;color:var(--primary-2);}
    .card{background:#fff;border:1px solid #e4ebf4;border-radius:24px;padding:28px;box-shadow:var(--shadow-md);}
    .status-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
      background:#f0faf5;border:1px solid #b8e5cc;color:#1d6f47;font-size:.81rem;font-weight:800;margin-bottom:18px;}
    .status-pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;}
    .alert{padding:13px 14px;border-radius:14px;font-size:.9rem;margin-bottom:16px;font-weight:600;}
    .alert-error{background:#fff2f4;border:1px solid #f7c5cb;color:#b63342;}
    .alert-success{background:#f0faf5;border:1px solid #b8e5cc;color:#1d6f47;}
    .field{margin-bottom:16px;}
    label{font-size:.9rem;font-weight:800;color:#24354c;}
    .code-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
    .code-label{font-size:.9rem;font-weight:800;color:#24354c;}
    .timer-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;
      background:#fff7e6;border:1px solid #f2d9a8;color:#b7791f;font-size:.82rem;font-weight:800;}
    .otp-inputs{display:grid;grid-template-columns:repeat(6,minmax(44px,1fr));gap:10px;margin-top:10px;}
    .otp-inputs input{height:62px;border:1px solid var(--line);border-radius:16px;text-align:center;
      font-size:1.4rem;font-weight:800;outline:none;background:#fbfdff;color:var(--ink);
      transition:border-color .2s,box-shadow .2s;}
    .otp-inputs input:focus{border-color:#86a9da;box-shadow:0 0 0 4px rgba(37,84,154,.13);}
    .otp-helper{margin-top:8px;color:var(--muted);font-size:.84rem;line-height:1.55;}
    .input-wrap{position:relative;margin-top:8px;}
    .input-wrap input{width:100%;height:54px;border:1px solid var(--line);background:#fff;border-radius:14px;
      padding:0 48px 0 16px;outline:none;transition:border-color .2s,box-shadow .2s;color:var(--ink);}
    .input-wrap input:focus{border-color:#86a9da;box-shadow:0 0 0 4px rgba(37,84,154,.12);}
    .toggle-btn{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:36px;height:36px;
      border:none;border-radius:10px;background:transparent;color:#7086a2;cursor:pointer;display:grid;place-items:center;}
    .toggle-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}
    .toggle-btn:hover{background:#f0f5fb;}
    .pw-reqs{margin-top:10px;padding:14px;border-radius:14px;background:#f8fbff;border:1px solid #dde7f3;}
    .pw-reqs p{font-size:.84rem;font-weight:800;color:#243445;margin-bottom:8px;}
    .pw-reqs ul{list-style:none;display:grid;gap:6px;}
    .pw-reqs li{font-size:.84rem;color:var(--muted);display:flex;align-items:center;gap:8px;}
    .pw-reqs li.met{color:var(--success);}
    .actions{display:flex;flex-direction:column;gap:10px;margin-top:20px;}
    .btn{width:100%;height:54px;border:none;border-radius:14px;
      background:linear-gradient(180deg,var(--primary-3),var(--primary-2) 45%,var(--primary));
      color:#fff;font-weight:800;font-size:1rem;cursor:pointer;
      box-shadow:0 14px 26px rgba(22,58,107,.18);transition:transform .18s,box-shadow .18s;}
    .btn:hover:not(:disabled){transform:translateY(-1px);}
    .btn:disabled{opacity:.7;cursor:not-allowed;}
    .btn-ghost{width:100%;height:54px;border:1px solid var(--line);border-radius:14px;
      background:#fff;color:var(--primary);font-weight:800;cursor:pointer;transition:transform .18s;}
    .btn-ghost:hover:not(:disabled){transform:translateY(-1px);}
    .btn-ghost:disabled{opacity:.45;cursor:not-allowed;}
    .resend-copy{margin-top:16px;text-align:center;color:var(--muted);font-size:.9rem;}
    @media(max-width:1024px){.shell{grid-template-columns:1fr;}.brand{min-height:400px;}}
    @media(max-width:640px){.page-wrap{padding:14px;}.brand,.form-pane{padding:24px;}.card{padding:20px;}
      .otp-inputs input{height:52px;font-size:1.2rem;}}
  `;

  return (
    <>
      <style>{styles}</style>
      <main className="page-wrap">
        <div className="shell">
          {/* Brand */}
          <section className="brand">
            <div className="brand-top">
              <div className="logo">
                <div className="logo-mark">
                  <svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>
                </div>
                <span>QELCare Portal</span>
              </div>
            </div>
            <div className="brand-hero">
              <div className="eyebrow">{view === "verify" ? "Email verification" : "Reset password"}</div>
              <h1>{view === "verify" ? "Enter the code sent to your email." : "Create your new secure password."}</h1>
              <p>{isRegistration ? "QELCare requires email verification before your patient account can sign in." : "QELCare requires a one-time code before resetting your password. Check your inbox and enter the 6-digit code."}</p>
              <div className="trust-grid">
                {[
                  { title:"Secure identity check",   body:"The code confirms access to the registered email address." },
                  { title:"10-minute expiry",         body:"Each code expires after 10 minutes. You can request a new one after 60 seconds." },
                  { title:"Password requirements",    body:"At least 8 characters with uppercase, lowercase, number, and special character." },
                ].map(c => (
                  <div className="trust-card" key={c.title}>
                    <div className="trust-icon">
                      <svg viewBox="0 0 24 24"><path d="M12 3l7 4v5c0 4.5-2.9 7.9-7 9-4.1-1.1-7-4.5-7-9V7l7-4z"/><path d="M9.5 12.2l1.8 1.8 3.7-4.2"/></svg>
                    </div>
                    <div><strong>{c.title}</strong><span>{c.body}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="brand-footer">
              <span>QELCare Clinic Management System</span>
              <span>Secure email verification</span>
            </div>
          </section>

          {/* Form */}
          <section className="form-pane">
            <div className="form-wrap">
              <button className="back-link" onClick={() => navigate(isRegistration ? "/register" : "/forgot-password")}>{"<- Back"}</button>

              {/* -- VERIFY VIEW -- */}
              {view === "verify" && (
                <>
                  <div className="auth-head">
                    <h2>{isRegistration ? "Verify account" : "Verify your email"}</h2>
                    <p>Enter the 6-digit code sent to <span className="email-display">{email}</span></p>
                  </div>
                  <div className="card">
                    <div className="status-pill">Code sent</div>

                    {error   && <div className="alert alert-error">{error}</div>}
                    {success && <div className="alert alert-success">{success}</div>}

                    <div>
                      <div className="code-row">
                        <span className="code-label">Verification code</span>
                        <span className="timer-pill"> {Math.floor(timer/60)}:{String(timer%60).padStart(2,"0")}</span>
                      </div>
                      <div className="otp-inputs">
                        {code.map((v,i) => (
                          <input key={i} ref={el => inputs.current[i]=el}
                            type="text" inputMode="numeric" maxLength={1} value={v}
                            onChange={e => handleCodeChange(i, e.target.value)}
                            onPaste={handleCodePaste}
                            onKeyDown={e => handleCodeKey(i, e)} />
                        ))}
                      </div>
                      <p className="otp-helper">
                        Enter each digit from your email. Check your spam folder if not received.
                        {!isRegistration && " No code after a minute? Double-check the email address you entered, or create an account if you don't have one yet."}
                      </p>
                    </div>

                    <div className="actions">
                      <button className="btn" onClick={handleVerify} disabled={loading || !!success}>
                        {loading ? "Verifying..." : isRegistration ? "Verify Account" : "Verify Code"}
                      </button>
                      <button className="btn-ghost" onClick={handleResend} disabled={!canResend || loading}>
                        {loading ? "Sending..." : canResend ? "Resend Code" : `Resend in ${resendIn}s`}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* -- RESET VIEW -- */}
              {view === "reset" && (
                <>
                  <div className="auth-head">
                    <h2>Reset password</h2>
                    <p>Create a new secure password for your QELCare account.</p>
                  </div>
                  <div className="card">
                    <div className="status-pill">Code verified</div>

                    {error   && <div className="alert alert-error">{error}</div>}
                    {success && <div className="alert alert-success">{success}</div>}

                    <div className="field">
                      <label>New Password</label>
                      <div className="input-wrap">
                        <input
                          type={showPw ? "text" : "password"}
                          placeholder="Enter new password"
                          value={newPassword}
                          onChange={e => { setNewPassword(e.target.value); setError(""); }}
                          onPaste={e => e.preventDefault()}
                          maxLength={50}
                        />
                        <button className="toggle-btn" type="button" onClick={() => setShowPw(v => !v)}>
                          <svg viewBox="0 0 24 24">{showPw ? <><path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.4 5.1A11.2 11.2 0 0 1 12 5c6.5 0 10 7 10 7a15.8 15.8 0 0 1-4 4.7"/><path d="M6.6 6.7C3.9 8.5 2 12 2 12a15.8 15.8 0 0 0 10 7"/></> : <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></>}</svg>
                        </button>
                      </div>
                    </div>

                    {/* Password requirements - same as Bantay */}
                    {newPassword && (
                      <div className="pw-reqs">
                        <p>Password Requirements:</p>
                        <ul>
                          {[
                            { key:"length",    label:"At least 8 characters" },
                            { key:"uppercase", label:"One uppercase letter" },
                            { key:"lowercase", label:"One lowercase letter" },
                            { key:"number",    label:"One number" },
                            { key:"special",   label:"One special character (@$!%*?&#)" },
                          ].map(r => (
                            <li key={r.key} className={checks[r.key] ? "met" : ""}>
                              {checks[r.key] ? "OK" : ""} {r.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="field" style={{marginTop:16}}>
                      <label>Confirm New Password</label>
                      <div className="input-wrap">
                        <input
                          type={showCPw ? "text" : "password"}
                          placeholder="Re-enter new password"
                          value={confirmPw}
                          onChange={e => { setConfirmPw(e.target.value); setError(""); }}
                          onPaste={e => e.preventDefault()}
                          maxLength={50}
                        />
                        <button className="toggle-btn" type="button" onClick={() => setShowCPw(v => !v)}>
                          <svg viewBox="0 0 24 24">{showCPw ? <><path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.4 5.1A11.2 11.2 0 0 1 12 5c6.5 0 10 7 10 7a15.8 15.8 0 0 1-4 4.7"/><path d="M6.6 6.7C3.9 8.5 2 12 2 12a15.8 15.8 0 0 0 10 7"/></> : <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></>}</svg>
                        </button>
                      </div>
                    </div>

                    <div className="actions">
                      <button className="btn" onClick={handleReset} disabled={loading || !!success}>
                        {loading ? "Resetting..." : "Reset Password"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
