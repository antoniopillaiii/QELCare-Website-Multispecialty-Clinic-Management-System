// ============================================================================
// Input check for the AI reading endpoints (document text extraction and
// prescription reading). They take one page as a base64 image; PDF pages are
// turned into images in the app before they are sent. Anything else - a video,
// an audio file, a renamed file - is refused here, before it reaches Gemini
// (which would otherwise accept a video and spend the clinic's quota on it).
// ============================================================================

const READABLE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const NOT_READABLE = "Only PNG, JPG, and WEBP images can be read. Choose a photo, an image, or a PDF of the document.";

// What the image really is, from its first bytes (null if none of the above).
function detectImageType(base64) {
  const head = Buffer.from(String(base64).slice(0, 32), "base64");
  if (head.length < 12) return null;
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// { error } when the upload can't be read, else { mimeType } - the type the
// bytes really are, which is what Gemini is told.
function checkReadableImage(image, declaredType) {
  const declared = String(declaredType || "").trim().toLowerCase();
  if (declared && !READABLE_TYPES.includes(declared)) return { error: NOT_READABLE };
  const detected = detectImageType(image);
  if (!detected) return { error: NOT_READABLE };
  return { mimeType: detected };
}

module.exports = { checkReadableImage };
