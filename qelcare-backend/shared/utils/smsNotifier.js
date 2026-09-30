// ============================================================================
// QELCare unified SMS layer
// ----------------------------------------------------------------------------
// WHAT:  Single source of truth for ALL outbound SMS. Mirrors emailNotifier.js:
//        dependency-free (Node's built-in `https`), env-driven provider, and a
//        DEV CONSOLE FALLBACK (only when no gateway is configured, outside
//        production) so development never gets stuck on a missing gateway.
//
// WHY:   SMS is a faster OTP channel (email can lag on weak mobile data). The
//        gateway is pluggable:
//          - "textbee"  : the clinic's own Android phone + SIM via the TextBee
//                         app (textbee.dev); the phone sends from its SIM.
//          - "console"  : print the SMS to the server console (dev only) —
//                         nothing is actually delivered.
//          - "textbelt" : genuine send with NO account on the public free quota
//                         (key "textbelt" = 1 SMS/day), or self-hosted for free.
//          - "semaphore": Philippine gateway (free signup credits, no card).
//          - "twilio"   : global gateway (trial credits).
//
// SMS IS USED ONLY for the Forgot Password and Register Account verification
// codes (see SMS_OTP_PURPOSES in features/auth/services/authService.js).
//
// ENV (see .env.example):
//   SMS_PROVIDER        = console | textbee | textbelt | semaphore | twilio  (default console)
//   TEXTBEE_API_KEY     = API key from the TextBee dashboard
//   TEXTBEE_DEVICE_ID   = optional: which registered phone sends (default: TextBee's default device)
//   TEXTBEE_SIM_SUBSCRIPTION_ID = optional: which SIM sends on a dual-SIM phone
//   TEXTBEE_URL         = optional API base (default https://api.textbee.dev/api/v1)
//   SMS_SENDER          = sender name / ID shown to the recipient (where allowed)
//   SMS_DEV_FALLBACK    = "true" | "false"  (default: true when NODE_ENV != production)
//   TEXTBELT_API_KEY    = "textbelt" (free 1/day) or your paid/self-host key
//   TEXTBELT_URL        = override endpoint for a self-hosted TextBelt (optional)
//   SEMAPHORE_API_KEY   = Semaphore API key
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM = Twilio credentials
// ============================================================================

const https = require("https");
const { URL, URLSearchParams } = require("url");

const REQUEST_TIMEOUT_MS = 10000;
const OTP_TTL_MINUTES_DEFAULT = 10;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------
function provider() {
  return String(process.env.SMS_PROVIDER || "console").trim().toLowerCase();
}

function senderName() {
  return process.env.SMS_SENDER || "QELCare";
}

function devFallbackEnabled() {
  if (typeof process.env.SMS_DEV_FALLBACK === "string") {
    return process.env.SMS_DEV_FALLBACK.toLowerCase() === "true";
  }
  return process.env.NODE_ENV !== "production";
}

// A real gateway is configured only when the selected provider has its creds.
function isSmsConfigured() {
  switch (provider()) {
    case "textbee":
      return Boolean(process.env.TEXTBEE_API_KEY);
    case "textbelt":
      return Boolean(process.env.TEXTBELT_API_KEY);
    case "semaphore":
      return Boolean(process.env.SEMAPHORE_API_KEY);
    case "twilio":
      return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM
      );
    case "console":
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Phone normalization
//   Accepts local PH formats (09XXXXXXXXX, 639XXXXXXXXX, +639XXXXXXXXX) and
//   generic international (+CC...). Returns E.164 (+63...) or null if unusable.
// ---------------------------------------------------------------------------
function normalizePhone(raw) {
  if (!raw) return null;
  let value = String(raw).trim().replace(/[\s\-()]/g, "");
  if (!value) return null;

  if (value.startsWith("+")) {
    const digits = value.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const digits = value.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`; // 09XXXXXXXXX -> +639XXXXXXXXX
  if (/^639\d{9}$/.test(digits)) return `+${digits}`; // 639XXXXXXXXX
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`; // 9XXXXXXXXX
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`; // generic intl
  return null;
}

// ---------------------------------------------------------------------------
// Low-level HTTPS POST helper (form-encoded or basic-auth), promise-based.
// ---------------------------------------------------------------------------
function httpsPostForm(endpoint, form, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(endpoint);
    } catch (err) {
      return reject(new Error(`Invalid SMS endpoint: ${endpoint}`));
    }

    const body = new URLSearchParams(form).toString();
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, data }));
      }
    );

    req.on("timeout", () => req.destroy(new Error("SMS request timed out.")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// JSON POST helper (TextBee), promise-based.
function httpsPostJson(endpoint, payload, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(endpoint);
    } catch (err) {
      return reject(new Error("Invalid SMS endpoint."));
    }

    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, data }));
      }
    );

    req.on("timeout", () => req.destroy(new Error("SMS request timed out.")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function logSmsToConsole({ to, message, note }) {
  const line = "=".repeat(54);
  console.log(
    `\n${line}\n` +
      `  QELCare SMS (DEV FALLBACK — ${note})\n` +
      `  To:   ${to}\n` +
      `  Text: ${message}\n` +
      `${line}\n`
  );
}

// ---------------------------------------------------------------------------
// Provider senders — each returns { ok, reason?, rateLimited? }.
// ---------------------------------------------------------------------------

// TextBee: the API hands the text to the clinic's phone, which sends it from
// its SIM. The reason never includes the message or the number.
async function sendViaTextbee(to, message) {
  const base = String(process.env.TEXTBEE_URL || "https://api.textbee.dev/api/v1").replace(/\/+$/, "");
  const payload = { recipients: [to], message };
  if (process.env.TEXTBEE_DEVICE_ID) payload.deviceId = process.env.TEXTBEE_DEVICE_ID;
  const sim = Number(process.env.TEXTBEE_SIM_SUBSCRIPTION_ID);
  if (Number.isInteger(sim)) payload.simSubscriptionId = sim;

  const res = await httpsPostJson(`${base}/gateway/send-sms`, payload, {
    headers: { "x-api-key": process.env.TEXTBEE_API_KEY },
  });
  let parsed = {};
  try {
    parsed = JSON.parse(res.data || "{}");
  } catch (_) {
    /* non-JSON error body */
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    return { ok: true, id: parsed.data?.smsBatchId || null };
  }
  const detail = typeof parsed.message === "string" ? `: ${parsed.message.slice(0, 120)}` : "";
  return {
    ok: false,
    reason: `TextBee HTTP ${res.statusCode}${detail}`,
    // 429 = TextBee's daily/monthly plan cap or its rate limit.
    rateLimited: res.statusCode === 429,
  };
}

async function sendViaTextbelt(to, message) {
  const endpoint = process.env.TEXTBELT_URL || "https://textbelt.com/text";
  const res = await httpsPostForm(endpoint, {
    phone: to,
    message,
    key: process.env.TEXTBELT_API_KEY,
  });
  let parsed = {};
  try {
    parsed = JSON.parse(res.data || "{}");
  } catch (_) {
    /* non-JSON error body */
  }
  if (parsed.success) return { ok: true };
  const reason = parsed.error || `TextBelt HTTP ${res.statusCode}`;
  return { ok: false, reason, rateLimited: /quota|limit/i.test(reason) };
}

async function sendViaSemaphore(to, message) {
  // Semaphore expects the local 11-digit form (09XXXXXXXXX) or +63; it accepts
  // 639XXXXXXXXX. We pass the E.164 digits without the leading '+'.
  const number = to.replace(/^\+/, "");
  const form = {
    apikey: process.env.SEMAPHORE_API_KEY,
    number,
    message,
  };
  // Only send a custom sender name when EXPLICITLY set — an unregistered name is
  // rejected by Semaphore, so an unset SMS_SENDER uses the account's default
  // sender (works out of the box on free/trial accounts).
  if (process.env.SMS_SENDER) form.sendername = process.env.SMS_SENDER;
  const res = await httpsPostForm("https://api.semaphore.co/api/v4/messages", form);
  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true };
  return {
    ok: false,
    reason: `Semaphore HTTP ${res.statusCode}: ${res.data}`,
    rateLimited: res.statusCode === 429,
  };
}

async function sendViaTwilio(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await httpsPostForm(
    endpoint,
    { To: to, From: process.env.TWILIO_FROM, Body: message },
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true };
  return {
    ok: false,
    reason: `Twilio HTTP ${res.statusCode}: ${res.data}`,
    rateLimited: res.statusCode === 429,
  };
}

// ---------------------------------------------------------------------------
// Generic SMS send
//   Returns: { ok, skipped?, dev?, reason?, rateLimited? }
// ---------------------------------------------------------------------------
async function sendSms({ to, message }) {
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { ok: false, skipped: true, reason: "Missing or invalid recipient phone." };
  }
  const text = String(message || "").slice(0, 480); // ~3 SMS segments max

  // Not configured -> console fallback in dev, otherwise a clean skip.
  if (!isSmsConfigured()) {
    if (devFallbackEnabled()) {
      logSmsToConsole({ to: normalized, message: text, note: `provider "${provider()}" not configured` });
      return { ok: true, dev: true };
    }
    return { ok: false, skipped: true, reason: "SMS service is not configured." };
  }

  // A gateway IS configured: report its real result. Never fall back to the
  // console here — that would print the code to the log and hide a failed send.
  try {
    let result;
    switch (provider()) {
      case "textbee":
        result = await sendViaTextbee(normalized, text);
        break;
      case "textbelt":
        result = await sendViaTextbelt(normalized, text);
        break;
      case "semaphore":
        result = await sendViaSemaphore(normalized, text);
        break;
      case "twilio":
        result = await sendViaTwilio(normalized, text);
        break;
      default:
        result = { ok: false, reason: `Unknown SMS provider "${provider()}".` };
    }

    if (result.ok) {
      // The batch id lets support find the message in the TextBee dashboard.
      if (result.id) console.log(`SMS accepted by ${provider()} (batch ${result.id})`);
      return { ok: true };
    }
    console.error(`SMS send failed (${provider()}): ${result.reason}`);
    return { ok: false, reason: result.reason, rateLimited: Boolean(result.rateLimited) };
  } catch (err) {
    console.error(`SMS send failed (${provider()}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// OTP SMS — short, plain text (no HTML). A real gateway never logs the code;
// only the dev console fallback (no gateway configured) prints it.
// ---------------------------------------------------------------------------
async function sendOtpSms({ to, otp, ttlMinutes }) {
  const minutes = ttlMinutes || OTP_TTL_MINUTES_DEFAULT;
  return sendSms({
    to,
    message: `QELCare: Your verification code is ${otp}. It expires in ${minutes} minutes. Do not share this code.`,
  });
}

module.exports = {
  isSmsConfigured,
  devFallbackEnabled,
  normalizePhone,
  sendSms,
  sendOtpSms,
  provider,
};
