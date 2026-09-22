// ============================================================================
// QELCare shared Google Gemini client
// ----------------------------------------------------------------------------
// One raw-HTTPS `generateContent` call used by every Gemini feature, so the
// request/response/error handling lives in one place:
//   - Document OCR (patient results + prescription parsing) -> GEMINI_MODEL
//   - Admin AI Reports & Analytics                           -> GEMINI_REPORTS_MODEL
//
// ENV (see .env.example):
//   GEMINI_API_KEY        = Google AI Studio key (shared by all features)
//   GEMINI_MODEL          = OCR model     (default gemini-3.1-flash-lite)
//   GEMINI_REPORTS_MODEL  = reports model (default gemini-3.8-flash)
//
// The key is sent in the x-goog-api-key header, never in the URL, so it can't
// end up in proxy/access logs. Error messages keep the exact wording the OCR
// controllers match on ("API key not valid", "timed out", "quota", ...).
// ============================================================================

const https = require("https");

const GEMINI_HOST = "generativelanguage.googleapis.com";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_OCR_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_REPORTS_MODEL = "gemini-3.8-flash";

function apiKey() {
  return process.env.GEMINI_API_KEY || "";
}

function ocrModel() {
  return process.env.GEMINI_MODEL || DEFAULT_OCR_MODEL;
}

function reportsModel() {
  return process.env.GEMINI_REPORTS_MODEL || DEFAULT_REPORTS_MODEL;
}

// POST /v1beta/models/{model}:generateContent and resolve the parsed response.
// Rejects with an Error carrying `statusCode` (HTTP) and `apiStatus` (e.g.
// "RESOURCE_EXHAUSTED") when Gemini reports a failure.
function generateContent({ model, contents, systemInstruction, generationConfig, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const payload = { contents };
    if (systemInstruction) payload.systemInstruction = systemInstruction;
    if (generationConfig) payload.generationConfig = generationConfig;
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: GEMINI_HOST,
        path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "x-goog-api-key": apiKey(),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            const err = new Error("Gemini returned invalid JSON.");
            err.statusCode = res.statusCode;
            return reject(err);
          }

          // Gemini returns error details inside the body even on non-200
          if (parsed.error) {
            const err = new Error(`Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
            err.statusCode = res.statusCode;
            err.apiStatus = parsed.error.status;
            return reject(err);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Gemini returned HTTP ${res.statusCode}: ${data}`);
            err.statusCode = res.statusCode;
            return reject(err);
          }

          resolve(parsed);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Gemini request timed out."));
    });

    req.on("error", reject);

    req.write(body);
    req.end();
  });
}

// Single prompt + one inline image (base64), as used by the OCR features.
function generateFromImage({ model, prompt, base64Image, mimeType, generationConfig, timeoutMs }) {
  return generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      },
    ],
    generationConfig,
    timeoutMs,
  });
}

// All answer text of the first candidate (thought-summary parts excluded).
function responseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
}

module.exports = {
  apiKey,
  ocrModel,
  reportsModel,
  generateContent,
  generateFromImage,
  responseText,
};
