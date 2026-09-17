import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.entry";
import { authFetch, getToken, API_URL } from "../../utils/auth";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Panel,
  formatDate,
  inputStyle,
  todayISO,
} from "../Workflow/ClinicUi";
import ConfirmModal from "../common/ConfirmModal";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PDF_PAGES = 5;
const ACCEPTED_FILES = ".png,.jpg,.jpeg,.webp,.pdf";

const emptyForm = {
  title: "",
  result_type: "",
  source_facility: "",
  result_date: "",
  extracted_text: "",
  summary_notes: "",
};

function fileType(file) {
  if (!file) return "";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}

function compact(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function firstMeaningfulLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => compact(line))
    .find((line) => line.length >= 3 && line.length <= 90);
}

function toISODate(value) {
  const text = compact(value);
  if (!text) return "";

  const iso = text.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const slash = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|19\d{2})\b/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return "";
}

function inferResultType(text, fileName = "") {
  const haystack = `${text} ${fileName}`.toLowerCase();
  if (/complete blood count|\bcbc\b/.test(haystack)) return "Personal CBC Paper Copy";
  if (/urinalysis|urine/.test(haystack)) return "Personal Urinalysis Paper Copy";
  if (/x[- ]?ray|radiograph/.test(haystack)) return "Personal Imaging Paper Copy";
  if (/ultrasound|sonogram/.test(haystack)) return "Personal Ultrasound Paper Copy";
  if (/ecg|electrocardiogram/.test(haystack)) return "Personal ECG Paper Copy";
  if (/blood chemistry|creatinine|cholesterol|glucose|triglyceride/.test(haystack)) return "Personal Blood Chemistry Paper Copy";
  if (/laboratory|lab result|reference range/.test(haystack)) return "Personal Medical Result Copy";
  return "Personal Medical Paper";
}

function inferFacility(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
  return lines.find((line) => /(clinic|hospital|laboratory|diagnostic|medical center|healthcare|lab)/i.test(line) && line.length <= 120) || "";
}

function inferFields(text, file, detectedType = "") {
  const fallbackTitle = file?.name ? file.name.replace(/\.[^.]+$/, "") : "Uploaded Medical Result";
  return {
    title: firstMeaningfulLine(text) || detectedType || fallbackTitle,
    // Prefer the document type the AI detected from the image itself (works even
    // for image-only films like an X-ray); fall back to text-based inference.
    result_type: detectedType || inferResultType(text, file?.name || ""),
    source_facility: inferFacility(text),
    result_date: toISODate(text) || todayISO(), // default the upload's date to today when none is detected
    extracted_text: text,
  };
}

async function renderPdfPageToImage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.7 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}

// Returns { base64, mimeType } from a File, Blob, or dataURL string.
async function toBase64(source) {
  if (typeof source === "string" && source.startsWith("data:")) {
    const [header, base64] = source.split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
    return { base64, mimeType };
  }
  if (source instanceof Blob || source instanceof File) {
    const mimeType = source.type || "image/jpeg";
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(source);
    });
    return { base64, mimeType };
  }
  throw new Error("Unsupported image source.");
}

// Sends image to the backend Gemini proxy and returns extracted text.
async function recognizeImage(source, onProgress) {
  onProgress(15);

  const { base64, mimeType } = await toBase64(source);

  onProgress(30);

  const response = await authFetch("/patient-results/ocr", {
    method: "POST",
    body: JSON.stringify({ image: base64, mime_type: mimeType }),
  });

  onProgress(90);

  const payload = await response.json();

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Text extraction failed.");
  }

  onProgress(100);
  return { text: payload.text || "", documentType: payload.document_type || "" };
}

function ResultCard({ item, selected, onSelect, onDelete }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${selected ? "#163a6b" : "#e3ebf5"}`,
        background: selected ? "#f3f7ff" : "#fff",
        borderRadius: 8,
        padding: 14,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#162235", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
          <div style={{ color: "#6b778c", fontSize: 12, marginTop: 4 }}>{item.result_type || "Medical Result"} - {formatDate(item.result_date || item.created_at)}</div>
          {item.source_facility && <div style={{ color: "#42526a", fontSize: 12, marginTop: 4 }}>{item.source_facility}</div>}
        </div>
        <ActionButton
          tone="danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(item);
          }}
        >
          Delete
        </ActionButton>
      </div>
    </button>
  );
}

export default function PatientResults() {
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const fileInputRef = useRef(null);

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return results;
    return results.filter((item) => [item.title, item.result_type, item.source_facility, item.extracted_text]
      .some((value) => String(value || "").toLowerCase().includes(q)));
  }, [results, search]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/patient-results/me");
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to load medical results.");
      const rows = payload.results || payload.data || [];
      setResults(rows);
      setSelected((current) => current ? rows.find((item) => item.result_id === current.result_id) || null : rows[0] || null);
    } catch (err) {
      setError(err.message || "Failed to load medical results.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const startNew = () => {
    setSelected(null);
    setForm(emptyForm);
    setFiles([]);
    setMessage(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectResult = (item) => {
    setSelected(item);
    setForm({
      title: item.title || "",
      result_type: item.result_type || "",
      source_facility: item.source_facility || "",
      result_date: item.result_date ? String(item.result_date).slice(0, 10) : "",
      extracted_text: item.extracted_text || "",
      summary_notes: item.summary_notes || "",
    });
    setFiles([]);
    setMessage(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const setField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const runOcr = async () => {
    if (!files.length) {
      setError("Choose one or more image/PDF files first.");
      return;
    }

    setOcrBusy(true);
    setOcrProgress(0);
    setError(null);
    setMessage("AI Vision is reading the uploaded result(s). Please review the text after extraction.");

    try {
      const chunks = [];
      let detectedType = "";
      // Read every page of every selected file and merge them into one result,
      // so a result/prescription split across multiple photos or pages reads as one.
      for (let fi = 0; fi < files.length; fi += 1) {
        const f = files[fi];
        const prefix = files.length > 1 ? `File ${fi + 1}` : "";
        if (fileType(f) === "pdf") {
          const data = await f.arrayBuffer();
          // isEvalSupported:false — never use eval()/Function() for font programs,
          // so rendering stays clean under a CSP that omits 'unsafe-eval'.
          const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
          const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
          for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
            setMessage(files.length > 1 ? `AI Vision reading file ${fi + 1} of ${files.length} (page ${pageNo}/${pageCount}).` : `AI Vision processing PDF page ${pageNo} of ${pageCount}.`);
            const image = await renderPdfPageToImage(pdf, pageNo);
            const pageResult = await recognizeImage(image, (percent) => setOcrProgress(percent));
            if (!detectedType && pageResult.documentType) detectedType = pageResult.documentType;
            chunks.push(`${prefix ? prefix + " " : ""}Page ${pageNo}\n${pageResult.text}`);
          }
        } else {
          setMessage(files.length > 1 ? `AI Vision reading file ${fi + 1} of ${files.length}.` : "AI Vision is reading the uploaded result.");
          const result = await recognizeImage(f, setOcrProgress);
          if (!detectedType && result.documentType) detectedType = result.documentType;
          chunks.push(`${prefix ? prefix + "\n" : ""}${result.text}`);
        }
      }
      const text = chunks.join("\n\n");

      const inferred = inferFields(text, files[0], detectedType);
      setForm((current) => ({
        ...current,
        title: current.title || inferred.title,
        result_type: current.result_type || inferred.result_type,
        source_facility: current.source_facility || inferred.source_facility,
        result_date: current.result_date || inferred.result_date,
        extracted_text: inferred.extracted_text,
      }));
      setMessage("AI Vision extraction complete. Review and edit the fields before saving.");
    } catch (err) {
      setError(err.message || "Text extraction failed. You can still type the result manually.");
    } finally {
      setOcrBusy(false);
      setOcrProgress(100);
    }
  };

  const saveResult = async () => {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      let response;
      if (selected) {
        response = await authFetch(`/patient-results/${selected.result_id}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      } else {
        const token = getToken();
        const body = new FormData();
        Object.entries(form).forEach(([key, value]) => body.append(key, value || ""));
        if (files[0]) body.append("resultFile", files[0]); // store the first page; combined text from all files is in extracted_text
        response = await fetch(`${API_URL}/patient-results`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body,
        });
      }

      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to save medical result.");
      setMessage(selected ? "Medical result updated." : "Medical result saved.");
      await loadResults();
      const saved = payload.result || payload.data;
      if (saved) selectResult(saved);
    } catch (err) {
      setError(err.message || "Failed to save medical result.");
    } finally {
      setSaving(false);
    }
  };

  const deleteResult = (item) => {
    setConfirm({
      title: "Delete Result",
      message: `Delete ${item.title}? This cannot be undone.`,
      confirmText: "Delete",
      item,
    });
  };

  const doDeleteResult = async (item) => {
    setError(null);
    setMessage(null);
    try {
      const response = await authFetch(`/patient-results/${item.result_id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to delete medical result.");
      if (selected?.result_id === item.result_id) startNew();
      setMessage("Medical result deleted.");
      await loadResults();
    } catch (err) {
      setError(err.message || "Failed to delete medical result.");
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#162235" }}>Medical Results Tracking</div>
            <div style={{ color: "#6b778c", fontSize: 13, marginTop: 3 }}>Save personal copies of printed medical papers for your own tracking. AI Vision only fills text fields; this is not an official clinic, laboratory, or diagnostic submission.</div>
          </div>
          <ActionButton onClick={startNew}>New Result</ActionButton>
        </div>
      </Panel>

      {message && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{message}</div>}
      <ErrorState message={error} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 16, alignItems: "start" }}>
        <Panel style={{ padding: 14 }}>
          <Field label="Search results">
            <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, type, facility, text" />
          </Field>
          <div style={{ height: 12 }} />
          {loading ? (
            <LoadingState label="Loading medical results..." />
          ) : filteredResults.length === 0 ? (
            <EmptyState title="No tracked papers" detail="Upload a personal copy of a printed medical paper or manually enter notes." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filteredResults.map((item) => (
                <ResultCard
                  key={item.result_id}
                  item={item}
                  selected={selected?.result_id === item.result_id}
                  onSelect={selectResult}
                  onDelete={deleteResult}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#162235" }}>{selected ? "Edit Tracked Medical Paper" : "Upload Personal Medical Paper"}</div>
              <div style={{ color: "#6b778c", fontSize: 12, marginTop: 3 }}>AI Vision extracts text only. Review everything before saving to your personal tracker. Staff do not treat this as an official uploaded result.</div>
            </div>
            {ocrBusy && <div style={{ color: "#163a6b", fontWeight: 900, fontSize: 13 }}>Reading... {ocrProgress}%</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {!selected && (
              <Field label="Upload file(s)">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILES}
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                  style={inputStyle}
                />
                {files.length > 0 && <div style={{ fontSize: 11, color: "#6b778c", marginTop: 4 }}>{files.length} file(s) selected — all pages are read together.</div>}
              </Field>
            )}
            {!selected && (
              <Field label="AI Vision">
                <ActionButton disabled={!files.length || ocrBusy} onClick={runOcr}>{ocrBusy ? "Reading file..." : "Extract Text"}</ActionButton>
              </Field>
            )}
            <Field label="Title">
              <input name="title" value={form.title} onChange={setField} style={inputStyle} placeholder="Personal medical paper copy" />
            </Field>
            <Field label="Document type">
              <input name="result_type" value={form.result_type} onChange={setField} style={inputStyle} placeholder="e.g. Chest X-ray, CBC, Prescription (auto-detected by AI)" />
            </Field>
            <Field label="Source facility">
              <input name="source_facility" value={form.source_facility} onChange={setField} style={inputStyle} placeholder="Clinic, hospital, or diagnostic center" />
            </Field>
            <Field label="Result date">
              <input name="result_date" type="date" value={form.result_date} onChange={setField} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <Field label="Extracted text">
              <textarea name="extracted_text" value={form.extracted_text} onChange={setField} rows={12} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} placeholder="AI Vision text or manually typed result details" />
            </Field>
            <Field label="Summary notes">
              <textarea name="summary_notes" value={form.summary_notes} onChange={setField} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} placeholder="Your own notes, reminders, or tracking details. This is not a diagnosis or official clinic result." />
            </Field>
          </div>

          {selected?.file_url && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f8fbff" }}>
              <div style={{ color: "#6b778c", fontSize: 12, fontWeight: 900, marginBottom: 5 }}>Attached file</div>
              <a href={selected.file_url} target="_blank" rel="noreferrer" style={{ color: "#163a6b", fontWeight: 900 }}>Open uploaded result</a>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <ActionButton tone="secondary" onClick={startNew}>Clear</ActionButton>
            <ActionButton disabled={saving || ocrBusy} onClick={saveResult}>{saving ? "Saving..." : selected ? "Save Changes" : "Save Result"}</ActionButton>
          </div>
        </Panel>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const item = confirm.item; setConfirm(null); doDeleteResult(item); }}
        />
      )}
    </div>
  );
}
