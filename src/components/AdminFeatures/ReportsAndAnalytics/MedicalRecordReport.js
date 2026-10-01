import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Pagination from "../../common/Pagination";
import { safeCsvCell } from "../../../utils/exportUtils";
import { buildQuery, fetchAllPages, fetchJson } from "../../../utils/paginatedFetch";

const PAGE_SIZE = 25;

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Asia/Manila",
  });
}

function normalizeRecord(record) {
  return {
    id: record.record_id || record.id,
    patient_name: record.patient_name || `${record.patient_first_name || ""} ${record.patient_last_name || ""}`.trim() || "Unknown patient",
    doctor_name: record.doctor_name || `${record.doctor_first_name || ""} ${record.doctor_last_name || ""}`.trim() || "Unknown doctor",
    visit_date: record.visit_date || record.created_at,
    diagnosis: record.diagnosis || "No diagnosis encoded",
    treatment_plan: record.treatment_plan || "",
    prescriptions: record.prescriptions || "",
    is_confidential: Boolean(record.is_confidential),
    created_at: record.created_at,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function MetricCard({ label, value, detail }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {detail ? <div style={styles.metricDetail}>{detail}</div> : null}
    </div>
  );
}

// Doctor-entered text goes through safeCsvCell so a value such as
// "=HYPERLINK(...)" opens as text in a spreadsheet, not as a formula.
function buildCsv(records) {
  const lines = [["Visit Date", "Patient", "Doctor", "Diagnosis", "Treatment Plan", "Prescriptions", "Confidential"].map(safeCsvCell).join(",")];
  records.forEach((record) => {
    lines.push([
      formatDate(record.visit_date),
      record.patient_name,
      record.doctor_name,
      record.diagnosis,
      record.treatment_plan,
      record.prescriptions,
      record.is_confidential ? "Yes" : "No",
    ].map(safeCsvCell).join(","));
  });
  return lines.join("\n");
}

function buildPrintableReport(records, metrics, diagnosisRows) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>QELCare Consultation Records Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 36px; }
    h1 { color: #0f2744; margin: 0 0 6px; }
    h2 { color: #0f2744; margin-top: 28px; }
    .muted { color: #607083; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 22px 0; }
    .card { border: 1px solid #d9e2ec; border-left: 5px solid #0f2744; padding: 14px; border-radius: 6px; }
    .label { color: #607083; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d9e2ec; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; color: #0f2744; }
    @media print { button { display: none; } body { margin: 20mm; } }
  </style>
</head>
<body>
  <h1>QELCare Consultation Records Report</h1>
  <div class="muted">Doctor-authored consultation records only. Patient-uploaded medical result tracking is separate.</div>
  <div class="grid">
    <div class="card"><div class="label">Total Records</div><div class="value">${metrics.total}</div></div>
    <div class="card"><div class="label">This Month</div><div class="value">${metrics.thisMonth}</div></div>
    <div class="card"><div class="label">With Prescriptions</div><div class="value">${metrics.withPrescriptions}</div></div>
    <div class="card"><div class="label">Confidential</div><div class="value">${metrics.confidential}</div></div>
  </div>

  <h2>Diagnosis Summary</h2>
  <table>
    <thead><tr><th>Diagnosis</th><th>Records</th></tr></thead>
    <tbody>${diagnosisRows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td></tr>`).join("")}</tbody>
  </table>

  <h2>Records (${records.length})</h2>
  <table>
    <thead><tr><th>Visit Date</th><th>Patient</th><th>Doctor</th><th>Diagnosis</th><th>Prescription</th></tr></thead>
    <tbody>${records.map((record) => `<tr><td>${escapeHtml(formatDate(record.visit_date))}</td><td>${escapeHtml(record.patient_name)}</td><td>${escapeHtml(record.doctor_name)}</td><td>${escapeHtml(record.diagnosis)}</td><td>${escapeHtml(record.prescriptions || "None")}</td></tr>`).join("")}</tbody>
  </table>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

export default function MedicalRecordReport() {
  const navigate = useNavigate();
  // The table shows one server page; the cards, the diagnosis summary and the
  // CSV / PDF cover every record matching the search (no 100-row cap).
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  // Only the latest request may update the page.
  const requestRef = useRef(0);
  const loadRecords = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const [list, totals] = await Promise.all([
        fetchJson(`/medical-records${buildQuery({ search: query, page, limit: PAGE_SIZE })}`),
        fetchJson(`/medical-records/summary${buildQuery({ search: query })}`),
      ]);
      if (requestId !== requestRef.current) return;
      const rows = list.records || list.data || [];
      setRecords(Array.isArray(rows) ? rows.map(normalizeRecord) : []);
      setTotal(Number(list.total) || 0);
      setPages(Number(list.pages) || 1);
      setSummary(totals.data || null);
    } catch (err) {
      if (requestId === requestRef.current) setError(err.message || "Failed to load consultation records.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // "This month" is the clinic's month (Asia/Manila), counted by the server.
  const metrics = {
    total: summary?.total ?? 0,
    thisMonth: summary?.created_this_month ?? 0,
    withPrescriptions: summary?.with_prescriptions ?? 0,
    confidential: summary?.confidential ?? 0,
  };
  const diagnosisRows = summary?.top_diagnoses || [];

  async function loadAllRecords() {
    const rows = await fetchAllPages("/medical-records", { search: query }, { idKey: "record_id" });
    return rows.map(normalizeRecord);
  }

  async function downloadCsv() {
    setExporting(true);
    setError("");
    try {
      downloadTextFile("qelcare-consultation-records-report.csv", buildCsv(await loadAllRecords()), "text/csv;charset=utf-8");
    } catch (err) {
      setError(`Couldn't prepare the CSV: ${err.message || "please try again."}`);
    } finally {
      setExporting(false);
    }
  }

  async function downloadPdf() {
    // Open the window during the click (popup blockers), then fill it.
    const popup = window.open("", "_blank", "width=1000,height=800");
    if (!popup) {
      setError("Popup blocked. Allow popups, then click Download PDF again.");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const all = await loadAllRecords();
      popup.document.open();
      popup.document.write(buildPrintableReport(all, metrics, diagnosisRows));
      popup.document.close();
    } catch (err) {
      popup.close();
      setError(`Couldn't prepare the PDF: ${err.message || "please try again."}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <button type="button" onClick={() => navigate(-1)} style={styles.backButton}>
          {"<- Back"}
        </button>
        <div>
          <h1 style={styles.title}>Consultation Records Report</h1>
          <p style={styles.subtitle}>Live doctor-authored consultation records. Patient-uploaded tracking files are separate.</p>
        </div>
      </header>

      <main style={styles.container}>
        <section style={styles.toolbar}>
          <label style={styles.fieldLabel}>
            Search records
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setQuery(search.trim());
              }}
              placeholder="Patient, doctor, diagnosis"
              style={styles.input}
            />
          </label>
          <div style={styles.actions}>
            <button type="button" onClick={loadRecords} disabled={loading} style={styles.primaryButton}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={downloadPdf} disabled={loading || exporting || total === 0} style={styles.secondaryButton}>
              {exporting ? "Preparing..." : "Download PDF"}
            </button>
            <button type="button" onClick={downloadCsv} disabled={loading || exporting || total === 0} style={styles.secondaryButton}>
              Export CSV
            </button>
          </div>
        </section>

        {error ? <div style={styles.error}>{error}</div> : null}

        <section style={styles.metricGrid}>
          <MetricCard label="Total Records" value={metrics.total} detail="Doctor-authored records" />
          <MetricCard label="This Month" value={metrics.thisMonth} detail="Created this month" />
          <MetricCard label="With Prescriptions" value={metrics.withPrescriptions} detail="Medication instructions encoded" />
          <MetricCard label="Confidential" value={metrics.confidential} detail="Restricted records" />
        </section>

        <div style={styles.gridTwo}>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Diagnosis Summary</h2>
            {diagnosisRows.length === 0 ? (
              <div style={styles.empty}>No diagnosis data yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {diagnosisRows.map((row) => {
                  const max = Math.max(...diagnosisRows.map((item) => num(item.count)), 1);
                  const width = Math.max(8, Math.round((row.count / max) * 100));
                  return (
                    <div key={row.label} style={styles.barRow}>
                      <div style={styles.barLabel}>{row.label}</div>
                      <div style={styles.barTrack}>
                        <div style={{ ...styles.barFill, width: `${width}%` }} />
                      </div>
                      <div style={styles.barValue}>{row.count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Clinical Boundaries</h2>
            <p style={styles.summary}>
              Admin can view records for audit and reporting, but doctor-authored records should be created or edited by doctors only. This keeps clinical accountability clear during presentation and real clinic use.
            </p>
            <p style={styles.recommendation}>
              Patient-uploaded Medical Results are stored in the patient tracking module and are not counted here as official consultation records.
            </p>
          </section>
        </div>

        <section style={styles.panel}>
          <h2 style={styles.panelTitle}>Recent Records</h2>
          {loading ? (
            <div style={styles.empty}>Loading records...</div>
          ) : records.length === 0 ? (
            <div style={styles.empty}>No consultation records found.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Visit Date</th>
                    <th style={styles.th}>Patient</th>
                    <th style={styles.th}>Doctor</th>
                    <th style={styles.th}>Diagnosis</th>
                    <th style={styles.th}>Prescription</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td style={styles.td}>{formatDate(record.visit_date)}</td>
                      <td style={styles.td}>{record.patient_name}</td>
                      <td style={styles.td}>{record.doctor_name}</td>
                      <td style={styles.td}>{record.diagnosis}</td>
                      <td style={styles.td}>{record.prescriptions || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Pagination
                page={page}
                totalPages={pages}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                label="records"
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#eef3f8",
    color: "#172033",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  topbar: {
    background: "#0f2744",
    color: "#ffffff",
    padding: "18px 24px",
    display: "flex",
    alignItems: "center",
    gap: 18,
    boxShadow: "0 8px 18px rgba(18, 59, 109, 0.18)",
  },
  backButton: {
    border: "1px solid rgba(255,255,255,0.35)",
    background: "rgba(255,255,255,0.1)",
    color: "#ffffff",
    borderRadius: 6,
    padding: "9px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.1,
  },
  subtitle: {
    margin: "4px 0 0",
    color: "#dbeafe",
    fontSize: 14,
  },
  container: {
    width: "min(1180px, 94vw)",
    margin: "24px auto 42px",
  },
  toolbar: {
    background: "#ffffff",
    border: "1px solid #e4ecf5",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    marginBottom: 18,
  },
  fieldLabel: {
    display: "grid",
    gap: 6,
    fontSize: 13,
    color: "#475569",
    fontWeight: 700,
  },
  input: {
    minWidth: 250,
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: "10px 12px",
    background: "#ffffff",
    color: "#172033",
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "none",
    background: "#0f2744",
    color: "#ffffff",
    borderRadius: 6,
    padding: "11px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #b9c7d6",
    background: "#ffffff",
    color: "#0f2744",
    borderRadius: 6,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  error: {
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 16,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 14,
    marginBottom: 16,
  },
  metricCard: {
    background: "#ffffff",
    border: "1px solid #e4ecf5",
    borderLeft: "5px solid #0f2744",
    borderRadius: 8,
    padding: 16,
  },
  metricLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#172033",
    fontSize: 30,
    fontWeight: 800,
    marginTop: 4,
  },
  metricDetail: {
    color: "#64748b",
    fontSize: 13,
    marginTop: 4,
  },
  gridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e4ecf5",
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
  },
  panelTitle: {
    margin: "0 0 12px",
    color: "#0f2744",
    fontSize: 20,
  },
  empty: {
    color: "#64748b",
    padding: "14px 0",
  },
  barRow: {
    display: "grid",
    gridTemplateColumns: "150px 1fr 42px",
    alignItems: "center",
    gap: 10,
  },
  barLabel: {
    color: "#34475c",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  barTrack: {
    height: 12,
    background: "#e8eef5",
    borderRadius: 999,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: "#0f2744",
    borderRadius: 999,
  },
  barValue: {
    color: "#172033",
    fontSize: 13,
    fontWeight: 800,
    textAlign: "right",
  },
  summary: {
    margin: "0 0 14px",
    lineHeight: 1.55,
    color: "#263548",
  },
  recommendation: {
    margin: 0,
    background: "#eef6ff",
    borderLeft: "4px solid #0f2744",
    borderRadius: 6,
    padding: "12px 14px",
    color: "#0f2744",
    fontWeight: 700,
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    background: "#eef4fb",
    color: "#0f2744",
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e4ecf5",
    fontSize: 13,
  },
  td: {
    padding: 10,
    borderBottom: "1px solid #edf2f7",
    color: "#263548",
    fontSize: 14,
    verticalAlign: "top",
  },
};
