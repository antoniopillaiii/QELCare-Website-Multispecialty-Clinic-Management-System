// ============================================================================
// QELCare push layer — Firebase Cloud Messaging (FCM) HTTP v1
// ----------------------------------------------------------------------------
// WHAT:  Sends OS-level push notifications to registered device tokens (the
//        patient mobile APK). Delivers even when the app is backgrounded or
//        closed. One place all push sending lives.
//
// WHY / HOW:  Google shut down the legacy FCM server-key API (June 2024), so we
//        must use HTTP v1 with an OAuth2 access token minted from a service
//        account. To keep this consistent with emailNotifier (raw `https`, NO
//        heavyweight SDK), we sign the service-account JWT ourselves with Node's
//        built-in `crypto` (RS256), exchange it for a short-lived access token
//        (cached ~55 min), and POST to the FCM v1 endpoint.
//
// DEV FALLBACK: If FCM is not configured, pushes are printed to the server
//        console instead of sent, so local dev/demos are never blocked.
//
// ENV (from your Firebase service-account JSON — see .env.example):
//   FCM_PROJECT_ID    = "project_id"
//   FCM_CLIENT_EMAIL  = "client_email"
//   FCM_PRIVATE_KEY   = "private_key"  (keep the \n escapes; they are un-escaped here)
//   PUSH_DEV_FALLBACK = "true" | "false"  (default: true when NODE_ENV != production)
// ============================================================================

const https = require("https");
const crypto = require("crypto");

const TOKEN_HOST = "oauth2.googleapis.com";
const TOKEN_PATH = "/token";
const FCM_HOST = "fcm.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REQUEST_TIMEOUT_MS = 10000;

let cachedToken = null; // { accessToken, expiresAt }

// ---------------------------------------------------------------------------
function projectId() {
  return process.env.FCM_PROJECT_ID || "";
}
function clientEmail() {
  return process.env.FCM_CLIENT_EMAIL || "";
}
function privateKey() {
  // Env stores the PEM with literal "\n"; convert back to real newlines. Also
  // tolerate a value that arrived wrapped in quotes (some hosting dashboards keep
  // the surrounding quotes) — a PEM never legitimately starts/ends with one.
  let key = String(process.env.FCM_PRIVATE_KEY || "").trim();
  key = key.replace(/^["']|["']$/g, "");
  return key.replace(/\\n/g, "\n");
}

function isPushConfigured() {
  return Boolean(projectId() && clientEmail() && privateKey());
}

function devFallbackEnabled() {
  if (typeof process.env.PUSH_DEV_FALLBACK === "string") {
    return process.env.PUSH_DEV_FALLBACK.toLowerCase() === "true";
  }
  return process.env.NODE_ENV !== "production";
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ---------------------------------------------------------------------------
// Low-level JSON POST
// ---------------------------------------------------------------------------
function httpsPostJson({ hostname, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
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
    req.on("timeout", () => req.destroy(new Error("FCM request timed out.")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Mint (and cache) an OAuth2 access token from the service account.
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken;
  }

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail(),
      scope: SCOPE,
      aud: `https://${TOKEN_HOST}${TOKEN_PATH}`,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey())
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const assertion = `${signingInput}.${signature}`;

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();

  const res = await httpsPostJson({
    hostname: TOKEN_HOST,
    path: TOKEN_PATH,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(params) },
    body: params,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`OAuth token error ${res.statusCode}: ${res.data}`);
  }
  const parsed = JSON.parse(res.data);
  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: now + (parsed.expires_in || 3600),
  };
  return cachedToken.accessToken;
}

// ---------------------------------------------------------------------------
// Send to a single token. Returns { ok, invalidToken?, reason? }.
//   invalidToken=true means the token is dead (UNREGISTERED / invalid) and the
//   caller should delete it.
// ---------------------------------------------------------------------------
async function sendToToken(accessToken, token, { title, body, data }) {
  // FCM data values MUST be strings.
  const stringData = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined && v !== null) stringData[k] = String(v);
  }

  const message = {
    message: {
      token,
      notification: { title, body },
      data: stringData,
      android: {
        priority: "high",
        notification: { sound: "default", default_sound: true },
      },
    },
  };

  const res = await httpsPostJson({
    hostname: FCM_HOST,
    path: `/v1/projects/${projectId()}/messages:send`,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: message,
  });

  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true };

  let reason = `FCM HTTP ${res.statusCode}`;
  let invalidToken = false;
  try {
    const parsed = JSON.parse(res.data);
    const status = parsed.error?.status;
    reason = parsed.error?.message || reason;
    // Dead/unregistered tokens: prune them.
    if (
      res.statusCode === 404 ||
      status === "UNREGISTERED" ||
      status === "NOT_FOUND" ||
      (res.statusCode === 400 && /registration token|invalid/i.test(reason))
    ) {
      invalidToken = true;
    }
  } catch (_) {
    /* non-JSON error body */
  }
  return { ok: false, invalidToken, reason };
}

// ---------------------------------------------------------------------------
// Public: send one notification to many tokens.
//   Returns { sent, failed, invalidTokens: [tokens to delete] }.
// ---------------------------------------------------------------------------
async function sendPushToTokens(tokens, { title, body, data } = {}) {
  const list = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean);
  const result = { sent: 0, failed: 0, invalidTokens: [] };
  if (list.length === 0) return result;

  if (!isPushConfigured()) {
    if (devFallbackEnabled()) {
      const line = "=".repeat(54);
      console.log(
        `\n${line}\n  QELCare PUSH (DEV FALLBACK — FCM not configured)\n` +
          `  Tokens: ${list.length}\n  Title:  ${title}\n  Body:   ${body}\n${line}\n`
      );
      result.sent = list.length;
      return result;
    }
    return result;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("Push auth error:", err.message);
    result.failed = list.length;
    return result;
  }

  await Promise.all(
    list.map(async (token) => {
      try {
        const r = await sendToToken(accessToken, token, { title, body, data });
        if (r.ok) result.sent += 1;
        else {
          result.failed += 1;
          if (r.invalidToken) result.invalidTokens.push(token);
        }
      } catch (err) {
        result.failed += 1;
        console.error("Push send error:", err.message);
      }
    })
  );

  return result;
}

module.exports = {
  isPushConfigured,
  devFallbackEnabled,
  sendPushToTokens,
};
