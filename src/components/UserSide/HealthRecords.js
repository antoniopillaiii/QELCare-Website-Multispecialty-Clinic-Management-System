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
} from "../Workflow/ClinicUi";
import ConfirmModal from "../common/ConfirmModal";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PDF_PAGES = 5;
const ACCEPTED_FILES = ".png,.jpg,.jpeg,.webp,.pdf";

/* ============================ shared helpers ============================ */

function fileType(file) {
  if (!file) return "";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}

function compact(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

// Generic "send one image to a backend AI endpoint" helper.
async function callVision(endpoint, source) {
  const { base64, mimeType } = await toBase64(source);
  const response = await authFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ image: base64, mime_type: mimeType }),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "AI processing failed.");
  }
  return payload;
}

// Walk a file (image or multi-page PDF) and call an endpoint per page.
async function processFileWithVision(file, endpoint, onPage) {
  if (fileType(file) === "pdf") {
    const data = await file.arrayBuffer();
    // isEvalSupported:false — never use eval()/Function() for font programs, so
    // rendering stays clean under a CSP that omits 'unsafe-eval'. worker-src still
    // needs 'self' blob: for the pdf worker itself.
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const results = [];
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      if (onPage) onPage(pageNo, pageCount);
      const image = await renderPdfPageToImage(pdf, pageNo);
      results.push(await callVision(endpoint, image));
    }
    return results;
  }
  return [await callVision(endpoint, file)];
}

// Walk MULTIPLE files (each an image or multi-page PDF) and return all page
// results combined — so a prescription/result split across several photos or
// pages (front + back, page 1 + page 2) is read as one. Progress reported as
// (fileIndex, fileCount, page, pages).
async function processFilesWithVision(files, endpoint, onPage) {
  const list = Array.from(files || []);
  const all = [];
  for (let i = 0; i < list.length; i += 1) {
    const pages = await processFileWithVision(list[i], endpoint, (n, total) => {
      if (onPage) onPage(i + 1, list.length, n, total);
    });
    all.push(...pages);
  }
  return all;
}

/* ============================ Documents helpers ============================ */

const emptyDocForm = {
  title: "",
  result_type: "",
  source_facility: "",
  result_date: "",
  extracted_text: "",
  summary_notes: "",
};

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
  if (iso) { const [, y, m, d] = iso; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  const slash = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|19\d{2})\b/);
  if (slash) { const [, m, d, y] = slash; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  return "";
}

function inferResultType(text, fileName = "") {
  const haystack = `${text} ${fileName}`.toLowerCase();
  if (/complete blood count|\bcbc\b/.test(haystack)) return "Complete Blood Count (CBC)";
  if (/urinalysis|urine/.test(haystack)) return "Urinalysis";
  if (/x[- ]?ray|radiograph/.test(haystack)) return "X-Ray / Radiograph";
  if (/ultrasound|sonogram/.test(haystack)) return "Ultrasound";
  if (/ecg|electrocardiogram/.test(haystack)) return "ECG / Electrocardiogram";
  if (/mri|magnetic resonance/.test(haystack)) return "MRI Scan";
  if (/ct scan|computed tomography/.test(haystack)) return "CT Scan";
  if (/blood chemistry|creatinine|cholesterol|glucose|triglyceride/.test(haystack)) return "Blood Chemistry";
  if (/prescription|\brx\b|sig:|take .* tablet/.test(haystack)) return "Prescription";
  if (/laboratory|lab result|reference range/.test(haystack)) return "Laboratory Result";
  return "Medical Document";
}

function inferFacility(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
  return lines.find((line) => /(clinic|hospital|laboratory|diagnostic|medical center|healthcare|lab)/i.test(line) && line.length <= 120) || "";
}

/* ============================ Documents tab ============================ */

function DocumentsTab() {
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyDocForm);
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const fileInputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return results;
    return results.filter((item) => [item.title, item.result_type, item.source_facility, item.extracted_text]
      .some((value) => String(value || "").toLowerCase().includes(q)));
  }, [results, search]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await authFetch("/patient-results/me");
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to load documents.");
      const rows = payload.results || payload.data || [];
      setResults(rows);
      setSelected((current) => current ? rows.find((r) => r.result_id === current.result_id) || null : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setSelected(null); setForm(emptyDocForm); setFiles([]); setStatus(null); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectItem = (item) => {
    setSelected(item);
    setForm({
      title: item.title || "",
      result_type: item.result_type || "",
      source_facility: item.source_facility || "",
      result_date: item.result_date ? String(item.result_date).slice(0, 10) : "",
      extracted_text: item.extracted_text || "",
      summary_notes: item.summary_notes || "",
    });
    setFiles([]); setStatus(null); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const setField = (e) => {
    const { name, value } = e.target;
    setForm((c) => ({ ...c, [name]: value }));
  };

  const runOcr = async () => {
    if (!files.length) { setError("Choose one or more image/PDF files first."); return; }
    setOcrBusy(true); setError(null);
    setStatus("AI Vision is reading the document...");
    try {
      const pages = await processFilesWithVision(files, "/patient-results/ocr", (fi, fc, n, total) => setStatus(fc > 1 ? `AI Vision reading file ${fi} of ${fc} (page ${n}/${total})...` : `AI Vision reading page ${n} of ${total}...`));
      const text = pages.map((p, i) => (pages.length > 1 ? `Page ${i + 1}\n${p.text || ""}` : p.text || "")).join("\n\n");
      // The AI classifies the document type from the image itself, so an image-only
      // film like an X-ray (with no readable text) is still detected correctly.
      const detectedType = pages.find((p) => p.document_type)?.document_type || "";
      const fallbackTitle = files[0]?.name ? files[0].name.replace(/\.[^.]+$/, "") : "Uploaded Medical Document";
      setForm((c) => ({
        ...c,
        title: c.title || firstMeaningfulLine(text) || detectedType || fallbackTitle,
        result_type: c.result_type || detectedType || inferResultType(text, files[0]?.name || ""),
        source_facility: c.source_facility || inferFacility(text),
        result_date: c.result_date || toISODate(text) || todayISO(),
        extracted_text: text,
      }));
      setStatus("Extraction complete. Review and edit the fields before saving.");
    } catch (err) {
      setError(err.message || "Text extraction failed. You can still type the details manually.");
    } finally {
      setOcrBusy(false);
    }
  };

  const save = async () => {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null); setStatus(null);
    try {
      let response;
      if (selected) {
        response = await authFetch(`/patient-results/${selected.result_id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        const token = getToken();
        const body = new FormData();
        Object.entries(form).forEach(([k, v]) => body.append(k, v || ""));
        if (files[0]) body.append("resultFile", files[0]); // store the first page as the attachment; combined text from all files is in extracted_text
        response = await fetch(`${API_URL}/patient-results`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body });
      }
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to save document.");
      setStatus(selected ? "Document updated." : "Document saved.");
      await load();
      const saved = payload.result || payload.data;
      if (saved) selectItem(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = (item) => {
    setConfirm({
      title: "Delete Document",
      message: `Delete "${item.title}"? This cannot be undone.`,
      confirmText: "Delete",
      item,
    });
  };

  const doRemove = async (item) => {
    setError(null); setStatus(null);
    try {
      const response = await authFetch(`/patient-results/${item.result_id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to delete document.");
      if (selected?.result_id === item.result_id) startNew();
      setStatus("Document deleted.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#162235" }}>Medical Documents</div>
            <div style={{ color: "#6b778c", fontSize: 13, marginTop: 3 }}>
              Upload personal copies of lab results, X-rays, prescriptions, and other medical papers. AI Vision reads the text and detects the document type. This is your personal tracker, not an official clinic submission.
            </div>
          </div>
          <ActionButton onClick={startNew}>New Document</ActionButton>
        </div>
      </Panel>

      {status && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{status}</div>}
      <ErrorState message={error} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 16, alignItems: "start" }}>
        <Panel style={{ padding: 14 }}>
          <Field label="Search documents">
            <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, type, facility, text" />
          </Field>
          <div style={{ height: 12 }} />
          {loading ? (
            <LoadingState label="Loading documents..." />
          ) : filtered.length === 0 ? (
            <EmptyState title="No documents yet" detail="Upload a medical paper or enter details manually." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filtered.map((item) => (
                <button
                  key={item.result_id}
                  type="button"
                  onClick={() => selectItem(item)}
                  style={{
                    width: "100%", textAlign: "left",
                    border: `1px solid ${selected?.result_id === item.result_id ? "#163a6b" : "#e3ebf5"}`,
                    background: selected?.result_id === item.result_id ? "#f3f7ff" : "#fff",
                    borderRadius: 8, padding: 14, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: "#162235", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                      <div style={{ color: "#6b778c", fontSize: 12, marginTop: 4 }}>{item.result_type || "Medical Document"} - {formatDate(item.result_date || item.created_at)}</div>
                      {item.source_facility && <div style={{ color: "#42526a", fontSize: 12, marginTop: 4 }}>{item.source_facility}</div>}
                    </div>
                    <ActionButton tone="danger" onClick={(e) => { e.stopPropagation(); remove(item); }}>Delete</ActionButton>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#162235" }}>{selected ? "Edit Document" : "Upload Document"}</div>
            {ocrBusy && <div style={{ color: "#163a6b", fontWeight: 900, fontSize: 13 }}>Reading...</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {!selected && (
              <Field label="Upload file(s)">
                <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILES} onChange={(e) => setFiles(Array.from(e.target.files || []))} style={inputStyle} />
                {files.length > 0 && <div style={{ fontSize: 11, color: "#6b778c", marginTop: 4 }}>{files.length} file(s) selected — all pages are read together.</div>}
              </Field>
            )}
            {!selected && (
              <Field label="AI Vision">
                <ActionButton disabled={!files.length || ocrBusy} onClick={runOcr}>{ocrBusy ? "Reading..." : "Extract Text"}</ActionButton>
              </Field>
            )}
            <Field label="Title"><input name="title" value={form.title} onChange={setField} style={inputStyle} placeholder="e.g. CBC Result - May 2026" /></Field>
            <Field label="Document type"><input name="result_type" value={form.result_type} onChange={setField} style={inputStyle} placeholder="Auto-detected by AI (editable)" /></Field>
            <Field label="Source facility"><input name="source_facility" value={form.source_facility} onChange={setField} style={inputStyle} placeholder="Clinic, hospital, or lab" /></Field>
            <Field label="Document date"><input name="result_date" type="date" value={form.result_date} onChange={setField} style={inputStyle} /></Field>
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <Field label="Extracted text"><textarea name="extracted_text" value={form.extracted_text} onChange={setField} rows={10} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} placeholder="AI Vision text or manually typed details" /></Field>
            <Field label="My notes"><textarea name="summary_notes" value={form.summary_notes} onChange={setField} rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} placeholder="Personal notes or reminders" /></Field>
          </div>

          {selected?.file_url && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #e3ebf5", borderRadius: 8, background: "#f8fbff" }}>
              <a href={selected.file_url} target="_blank" rel="noreferrer" style={{ color: "#163a6b", fontWeight: 900 }}>Open uploaded file</a>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <ActionButton tone="secondary" onClick={startNew}>Clear</ActionButton>
            <ActionButton disabled={saving || ocrBusy} onClick={save}>{saving ? "Saving..." : selected ? "Save Changes" : "Save Document"}</ActionButton>
          </div>
        </Panel>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const item = confirm.item; setConfirm(null); doRemove(item); }}
        />
      )}
    </div>
  );
}

/* ============================ Medications tab ============================ */

const FREQ_OPTIONS = [
  { value: 1, label: "Once a day" },
  { value: 2, label: "Twice a day" },
  { value: 3, label: "3 times a day" },
  { value: 4, label: "4 times a day" },
];

const emptyMedForm = {
  drug_name: "",
  dosage: "",
  form: "",
  frequency_per_day: 1,
  times_of_day: ["08:00"],
  start_date: todayISO(),
  duration_days: "",
  instructions: "",
  reminders_enabled: true,
};

const DEFAULT_TIMES = {
  1: ["08:00"], 2: ["08:00", "20:00"], 3: ["08:00", "14:00", "20:00"], 4: ["08:00", "12:00", "16:00", "20:00"],
};

function MedicationsTab() {
  const [meds, setMeds] = useState([]);
  const [adherence, setAdherence] = useState(null);
  const [schedule, setSchedule] = useState({ date: todayISO(), slots: [] });
  const [scheduleDate, setScheduleDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  const [form, setForm] = useState(emptyMedForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [files, setFiles] = useState([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [parsed, setParsed] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const fileInputRef = useRef(null);

  const loadMeds = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await authFetch("/medications");
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to load medications.");
      setMeds(payload.medications || payload.data || []);
      setAdherence(payload.adherence || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSchedule = useCallback(async (date) => {
    try {
      const response = await authFetch(`/medications/schedule?date=${date}`);
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to load schedule.");
      setSchedule({ date: payload.date, slots: payload.slots || [] });
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadMeds(); }, [loadMeds]);
  useEffect(() => { loadSchedule(scheduleDate); }, [scheduleDate, loadSchedule]);

  const resetForm = () => { setForm(emptyMedForm); setEditingId(null); setParsed([]); setFiles([]); if (fileInputRef.current) fileInputRef.current.value = ""; };

  const setField = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "frequency_per_day") {
      const freq = parseInt(value, 10);
      setForm((c) => ({ ...c, frequency_per_day: freq, times_of_day: DEFAULT_TIMES[freq] || c.times_of_day }));
      return;
    }
    setForm((c) => ({ ...c, [name]: type === "checkbox" ? checked : value }));
  };

  const setTime = (index, value) => {
    setForm((c) => {
      const times = [...c.times_of_day];
      times[index] = value;
      return { ...c, times_of_day: times };
    });
  };

  const editMed = (med) => {
    setEditingId(med.medication_id);
    setForm({
      drug_name: med.drug_name || "",
      dosage: med.dosage || "",
      form: med.form || "",
      frequency_per_day: med.frequency_per_day || 1,
      times_of_day: Array.isArray(med.times_of_day) && med.times_of_day.length ? med.times_of_day : (DEFAULT_TIMES[med.frequency_per_day] || ["08:00"]),
      start_date: med.start_date ? String(med.start_date).slice(0, 10) : todayISO(),
      duration_days: med.duration_days || "",
      instructions: med.instructions || "",
      reminders_enabled: med.reminders_enabled !== false,
    });
    setParsed([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveMed = async () => {
    if (!form.drug_name.trim()) { setError("Medicine name is required."); return; }
    setSaving(true); setError(null); setStatus(null);
    try {
      const endpoint = editingId ? `/medications/${editingId}` : "/medications";
      const method = editingId ? "PATCH" : "POST";
      const response = await authFetch(endpoint, { method, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to save medication.");
      setStatus(editingId ? "Medication updated. It will be reviewed by a doctor again before reminders resume." : "Medication added. A doctor will review it before reminders begin.");
      resetForm();
      await loadMeds();
      await loadSchedule(scheduleDate);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setMedStatus = async (med, newStatus) => {
    setError(null);
    try {
      const response = await authFetch(`/medications/${med.medication_id}/status`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to update status.");
      await loadMeds();
      await loadSchedule(scheduleDate);
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteMed = (med) => {
    setConfirm({
      title: "Remove Medication",
      message: `Remove ${med.drug_name} from your medications?`,
      confirmText: "Remove",
      med,
    });
  };

  const doDeleteMed = async (med) => {
    setError(null);
    try {
      const response = await authFetch(`/medications/${med.medication_id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to remove medication.");
      if (editingId === med.medication_id) resetForm();
      await loadMeds();
      await loadSchedule(scheduleDate);
    } catch (err) {
      setError(err.message);
    }
  };

  const runPrescriptionOcr = async () => {
    if (!files.length) { setError("Choose one or more prescription image/PDF files first."); return; }
    setOcrBusy(true); setError(null); setStatus("AI is reading your prescription...");
    try {
      const pages = await processFilesWithVision(files, "/medications/parse", (fi, fc, n, total) => setStatus(fc > 1 ? `AI reading file ${fi} of ${fc} (page ${n}/${total})...` : `AI reading page ${n} of ${total}...`));
      const all = pages.flatMap((p) => p.medications || []);
      if (all.length === 0) {
        setStatus("No medications detected. You can add them manually below.");
      } else {
        setStatus(`AI found ${all.length} medication(s). Review and confirm to add them.`);
      }
      setParsed(all);
    } catch (err) {
      setError(err.message || "Could not read the prescription. Add medications manually.");
    } finally {
      setOcrBusy(false);
    }
  };

  const confirmParsed = async () => {
    if (parsed.length === 0) return;
    setSaving(true); setError(null);
    try {
      const response = await authFetch("/medications/batch", { method: "POST", body: JSON.stringify({ medications: parsed }) });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to add medications.");
      setStatus("Medication(s) added. A doctor will review them before reminders begin.");
      setParsed([]); setFiles([]); if (fileInputRef.current) fileInputRef.current.value = "";
      await loadMeds();
      await loadSchedule(scheduleDate);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateParsedField = (index, key, value) => {
    setParsed((list) => list.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  };

  const logDose = async (slot, newStatus) => {
    setError(null);
    try {
      const response = await authFetch("/medications/log", {
        method: "POST",
        body: JSON.stringify({
          medication_id: slot.medication_id,
          scheduled_date: schedule.date,
          scheduled_time: slot.scheduled_time,
          status: newStatus,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.message || "Failed to record dose.");
      await loadSchedule(scheduleDate);
      await loadMeds();
    } catch (err) {
      setError(err.message);
    }
  };

  const activeCount = meds.filter((m) => m.status === "active" && m.approval_status === "approved").length;
  const pendingCount = meds.filter((m) => m.approval_status === "pending").length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#162235" }}>Medication Tracking</div>
            <div style={{ color: "#6b778c", fontSize: 13, marginTop: 3 }}>
              Snap a prescription and let AI parse it, or add medicines manually. Track your daily doses and reminders. This is a personal reminder tool, not medical advice.
            </div>
          </div>
          {adherence && adherence.adherence_rate !== null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: adherence.adherence_rate >= 80 ? "#0f6b3c" : "#b45309" }}>{adherence.adherence_rate}%</div>
              <div style={{ color: "#6b778c", fontSize: 11, fontWeight: 800 }}>30-DAY ADHERENCE</div>
            </div>
          )}
        </div>
      </Panel>

      {status && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{status}</div>}
      <ErrorState message={error} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 420px) 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: add / OCR */}
        <div style={{ display: "grid", gap: 14 }}>
          <Panel style={{ padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#162235", marginBottom: 10 }}>Scan a Prescription (AI)</div>
            <Field label="Prescription image(s) or PDF">
              <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILES} onChange={(e) => setFiles(Array.from(e.target.files || []))} style={inputStyle} />
              {files.length > 0 && <div style={{ fontSize: 11, color: "#6b778c", marginTop: 4 }}>{files.length} file(s) selected — front/back or multiple pages will be read together.</div>}
            </Field>
            <div style={{ height: 10 }} />
            <ActionButton disabled={!files.length || ocrBusy} onClick={runPrescriptionOcr}>{ocrBusy ? "Reading prescription..." : "Read with AI"}</ActionButton>

            {parsed.length > 0 && (
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#163a6b" }}>Review parsed medications</div>
                {parsed.map((item, index) => (
                  <div key={index} style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
                    <input value={item.drug_name} onChange={(e) => updateParsedField(index, "drug_name", e.target.value)} style={inputStyle} placeholder="Medicine name" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input value={item.dosage} onChange={(e) => updateParsedField(index, "dosage", e.target.value)} style={inputStyle} placeholder="Dosage" />
                      <input type="number" min={1} max={12} value={item.frequency_per_day} onChange={(e) => updateParsedField(index, "frequency_per_day", parseInt(e.target.value, 10) || 1)} style={inputStyle} placeholder="x/day" />
                    </div>
                    <input value={item.instructions} onChange={(e) => updateParsedField(index, "instructions", e.target.value)} style={inputStyle} placeholder="Instructions" />
                  </div>
                ))}
                <ActionButton disabled={saving} onClick={confirmParsed}>{saving ? "Adding..." : `Add ${parsed.length} medication(s)`}</ActionButton>
              </div>
            )}
          </Panel>

          <Panel style={{ padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#162235", marginBottom: 10 }}>{editingId ? "Edit Medication" : "Add Manually"}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label="Medicine name *"><input name="drug_name" value={form.drug_name} onChange={setField} style={inputStyle} placeholder="e.g. Paracetamol" /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Dosage"><input name="dosage" value={form.dosage} onChange={setField} style={inputStyle} placeholder="500 mg" /></Field>
                <Field label="Form"><input name="form" value={form.form} onChange={setField} style={inputStyle} placeholder="tablet" /></Field>
              </div>
              <Field label="How often">
                <select name="frequency_per_day" value={form.frequency_per_day} onChange={setField} style={inputStyle}>
                  {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Reminder times">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                  {form.times_of_day.map((t, i) => (
                    <input key={i} type="time" value={t} onChange={(e) => setTime(i, e.target.value)} style={inputStyle} />
                  ))}
                </div>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Start date"><input name="start_date" type="date" value={form.start_date} onChange={setField} style={inputStyle} /></Field>
                <Field label="Duration (days)"><input name="duration_days" type="number" min={1} value={form.duration_days} onChange={setField} style={inputStyle} placeholder="e.g. 7" /></Field>
              </div>
              <Field label="Instructions"><input name="instructions" value={form.instructions} onChange={setField} style={inputStyle} placeholder="e.g. after meals" /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#42526a", fontWeight: 700 }}>
                <input name="reminders_enabled" type="checkbox" checked={form.reminders_enabled} onChange={setField} /> Enable reminders
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                {editingId && <ActionButton tone="secondary" onClick={resetForm}>Cancel</ActionButton>}
                <ActionButton disabled={saving} onClick={saveMed}>{saving ? "Saving..." : editingId ? "Save Changes" : "Add Medication"}</ActionButton>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right: today's schedule + medication list */}
        <div style={{ display: "grid", gap: 14 }}>
          <Panel style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>Dose Schedule</div>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
            </div>
            {schedule.slots.length === 0 ? (
              <EmptyState title="No doses scheduled" detail="Active medications with reminder times show up here." />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {schedule.slots.map((slot) => (
                  <div key={`${slot.medication_id}-${slot.scheduled_time}`} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                    border: "1px solid #e3ebf5", borderRadius: 8, padding: "10px 12px",
                    background: slot.status === "taken" ? "#edf8f1" : slot.status === "skipped" ? "#fdf0f0" : "#fff",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#162235" }}>{slot.scheduled_time} - {slot.drug_name}</div>
                      <div style={{ color: "#6b778c", fontSize: 12 }}>{[slot.dosage, slot.instructions].filter(Boolean).join(" - ") || "No extra instructions"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {slot.status === "taken" ? (
                        <span style={{ color: "#0f6b3c", fontWeight: 900, fontSize: 13 }}>Taken</span>
                      ) : slot.status === "skipped" ? (
                        <span style={{ color: "#b91c1c", fontWeight: 900, fontSize: 13 }}>Skipped</span>
                      ) : (
                        <>
                          <ActionButton onClick={() => logDose(slot, "taken")}>Take</ActionButton>
                          <ActionButton tone="secondary" onClick={() => logDose(slot, "skipped")}>Skip</ActionButton>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel style={{ padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#162235", marginBottom: 12 }}>
              My Medications ({activeCount} active{pendingCount > 0 ? `, ${pendingCount} pending review` : ""})
            </div>
            {loading ? (
              <LoadingState label="Loading medications..." />
            ) : meds.length === 0 ? (
              <EmptyState title="No medications tracked" detail="Scan a prescription or add a medicine manually." />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {meds.map((med) => (
                  <div key={med.medication_id} style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 12, opacity: med.status === "active" ? 1 : 0.65 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#162235" }}>
                          {med.drug_name} {med.dosage && <span style={{ color: "#6b778c", fontWeight: 700 }}>- {med.dosage}</span>}
                        </div>
                        <div style={{ color: "#6b778c", fontSize: 12, marginTop: 3 }}>
                          {(med.frequency_per_day || 1)}x/day at {(Array.isArray(med.times_of_day) ? med.times_of_day : []).join(", ") || "-"}
                          {med.end_date ? ` - until ${formatDate(med.end_date)}` : " - ongoing"}
                        </div>
                        {med.instructions && <div style={{ color: "#42526a", fontSize: 12, marginTop: 3 }}>{med.instructions}</div>}
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {med.approval_status === "pending" ? (
                            <span style={{ fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 999, color: "#9a6500", background: "#fff7df" }}>PENDING DOCTOR REVIEW</span>
                          ) : med.approval_status === "rejected" ? (
                            <span style={{ fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 999, color: "#b91c1c", background: "#fdecec" }}>NOT VALIDATED</span>
                          ) : (
                            <span style={{
                              fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 999,
                              color: med.status === "active" ? "#0f6b3c" : "#64748b",
                              background: med.status === "active" ? "#e7f6ed" : "#eef2f6",
                            }}>{String(med.status || "").toUpperCase()}</span>
                          )}
                          {med.source === "ocr" && <span style={{ fontSize: 11, color: "#6b778c" }}>via AI scan</span>}
                        </div>
                        {med.approval_status === "rejected" && med.rejection_reason && (
                          <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>Reason: {med.rejection_reason}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <ActionButton tone="secondary" onClick={() => editMed(med)}>Edit</ActionButton>
                        {med.status === "active" ? (
                          <ActionButton tone="secondary" onClick={() => setMedStatus(med, "finished")}>Finish</ActionButton>
                        ) : med.status === "finished" || med.status === "paused" ? (
                          <ActionButton tone="secondary" onClick={() => setMedStatus(med, "active")}>Reactivate</ActionButton>
                        ) : null}
                        <ActionButton tone="danger" onClick={() => deleteMed(med)}>Delete</ActionButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const med = confirm.med; setConfirm(null); doDeleteMed(med); }}
        />
      )}
    </div>
  );
}

/* ============================ Hub shell ============================ */

export default function HealthRecords() {
  const [tab, setTab] = useState("medications");

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        padding: "10px 18px", border: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 14, fontWeight: 900,
        color: tab === id ? "#163a6b" : "#6b778c",
        background: "transparent",
        borderBottom: `3px solid ${tab === id ? "#163a6b" : "transparent"}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#162235" }}>Medications & Documents</div>
          <div style={{ color: "#6b778c", fontSize: 13, marginTop: 3 }}>Track your medications and store your medical documents in one place.</div>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "10px 12px 0", borderBottom: "1px solid #e8eef6" }}>
          {tabBtn("medications", "Medications")}
          {tabBtn("documents", "Documents")}
        </div>
      </Panel>

      {tab === "medications" ? <MedicationsTab /> : <DocumentsTab />}
    </div>
  );
}
