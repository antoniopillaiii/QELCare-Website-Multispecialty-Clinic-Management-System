// ============================================================
// FILE: src/components/Auth/PatientIdleTimeout.js
// ------------------------------------------------------------
// Inactivity auto-logout for PATIENT accounts ONLY.
//
// Mounted once at the app root. It is a no-op for every other role and when
// logged out: all handlers gate on isPatientSession(), so Doctors, Nurses,
// Admins, Front Desk, and Cashiers keep their full session with zero effect and
// no change to their token lifetime.
//
// How it works:
//   * User activity stamps a shared timestamp in localStorage, so multiple
//     patient tabs share ONE idle clock (activity in any tab keeps them all in).
//   * A light interval — plus an immediate check when the tab regains focus /
//     visibility (covers backgrounded tabs where timers are throttled) — logs the
//     patient out once the idle window is exceeded, redirecting to /login with a
//     "Session Expired" notice.
//   * A storage listener bails this tab out promptly if the session is cleared
//     in another tab.
// ============================================================
import { useEffect } from "react";
import {
  isPatientSession,
  expireSession,
  getToken,
  PATIENT_IDLE_LIMIT_MS,
  LAST_ACTIVITY_KEY,
} from "../../utils/auth";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click", "wheel"];
const CHECK_INTERVAL_MS = 15000; // re-check idle state every 15s
const PUBLIC_PATHS = ["/login", "/", "/register", "/forgot-password", "/verify-email", "/unauthorized"];

export default function PatientIdleTimeout() {
  useEffect(() => {
    let lastWrite = 0;
    let expiring = false;

    // Record activity (throttled to once/sec) — patients only.
    const onActivity = () => {
      if (!isPatientSession()) return;
      const now = Date.now();
      if (now - lastWrite >= 1000) {
        lastWrite = now;
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    };

    // Enforce the idle limit — patients only.
    const check = () => {
      if (expiring || !isPatientSession()) return;
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
      if (Date.now() - last >= PATIENT_IDLE_LIMIT_MS) {
        expiring = true;
        expireSession();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    // Session cleared in another tab (manual logout or idle timeout) -> if our
    // token is gone and we're on an in-app page, return to login. Ignores the
    // frequent activity-key writes.
    const onStorage = (e) => {
      if (e.key !== null && e.key !== "token") return;
      if (!getToken() && !PUBLIC_PATHS.includes(window.location.pathname)) {
        window.location.replace("/login");
      }
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", check);
    window.addEventListener("storage", onStorage);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);

  return null;
}
