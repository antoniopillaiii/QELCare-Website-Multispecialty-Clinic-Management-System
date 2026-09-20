import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import { C } from "../../../utils/adminTheme";
import { X } from "lucide-react";

// These were hard-coded copies of the shared palette (identical values), which
// is exactly the drift adminTheme.js exists to prevent — if the theme changes,
// this module would silently stay behind. Aliases keep the rest of the file
// reading unchanged. No visual change.
const NAVY = C.navy;
const MUTED = C.text;
const BORDER = C.border;
const BG = "#eef4fb";

const STATUS_META = {
  new:         { label: "New",         bg: "#fff7df", color: "#9a6500" },
  in_progress: { label: "In Progress", bg: "#eaf1ff", color: "#1b4d9b" },
  resolved:    { label: "Resolved",    bg: "#edf8f1", color: "#0f6b3c" },
  archived:    { label: "Archived",    bg: "#f3f4f6", color: "#5b6472" },
};
const STATUS_ORDER = ["new", "in_progress", "resolved", "archived"];
const FILTERS = [{ id: "", label: "All" }, ...STATUS_ORDER.map((s) => ({ id: s, label: STATUS_META[s].label }))];
const PAGE_SIZE = 10;

const EXPORT_COLUMNS = [
  { header: "ID", value: (r) => `#${r.inquiry_id}` },
  { header: "Date", value: (r) => new Date(r.created_at).toLocaleString("en-PH") },
  { header: "Name", value: (r) => r.full_name || "" },
  { header: "Email", value: (r) => r.email || "" },
  { header: "Phone", value: (r) => r.phone || "" },
  { header: "Subject", value: (r) => r.subject || "" },
  { header: "Message", value: (r) => r.message || "" },
  { header: "Preferred date", value: (r) => (r.preferred_date ? String(r.preferred_date).slice(0, 10) : "") },
  { header: "Status", value: (r) => STATUS_META[r.status]?.label || r.status },
  { header: "Handled by", value: (r) => r.handled_by_name || "" },
];

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, bg: BG, color: MUTED };
  return (
    <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

export default function AdminInquiries() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [active, setActive] = useState(null); // inquiry being viewed/edited
  const [draft, setDraft] = useState({ status: "new", admin_notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status) params.set("status", status);
      if (query) params.set("search", query);
      const res = await authFetch(`/inquiries?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Failed to load inquiries.");
      setRows(payload.inquiries || payload.data || []);
      setTotal(payload.total || 0);
      setPages(payload.pages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, query]);

  useEffect(() => { load(); }, [load]);

  const newCount = useMemo(() => rows.filter((r) => r.status === "new").length, [rows]);

  function openInquiry(item) {
    setActive(item);
    setDraft({ status: item.status, admin_notes: item.admin_notes || "" });
    setMsg("");
  }

  async function saveInquiry() {
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`/inquiries/${active.inquiry_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, admin_notes: draft.admin_notes }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Failed to update inquiry.");
      setMsg("Inquiry updated.");
      setActive(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const runSearch = () => { setPage(1); setQuery(search.trim()); };

  return (
    <MainLayout pageTitle="Inquiries" pageSubtitle="Booking requests and questions submitted without an account">
    <div style={{ padding: 22, background: BG, minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {/* The static description now lives in the Topbar subtitle; only the
            live count is worth repeating here. */}
        <div>
          {newCount > 0 && (
            <div style={{ color: MUTED, fontSize: 13, fontWeight: 700 }}>
              {newCount} new on this page.
            </div>
          )}
        </div>
        <ExportMenu filename="qelcare-inquiries" title="QELCare Inquiries" subtitle={`${total} total`} columns={EXPORT_COLUMNS} rows={rows} />
      </div>

      {/* Filters + search */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id || "all"}
              onClick={() => { setStatus(f.id); setPage(1); }}
              style={{
                minHeight: 36, padding: "0 14px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13,
                border: `1px solid ${status === f.id ? NAVY : BORDER}`,
                background: status === f.id ? NAVY : "#fff",
                color: status === f.id ? "#fff" : NAVY,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder="Search name, email, message..."
            style={{ minWidth: 220, height: 36, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0 12px", fontSize: 13, fontFamily: "inherit" }}
          />
          <button onClick={runSearch} style={{ height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${NAVY}`, background: NAVY, color: "#fff", fontWeight: 800, cursor: "pointer" }}>Search</button>
        </div>
      </div>

      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fff0f0", color: "#ad3131", fontWeight: 800, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontWeight: 800, marginBottom: 12 }}>{msg}</div>}

      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 28, textAlign: "center", color: MUTED, fontWeight: 700 }}>Loading inquiries...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: MUTED }}>
            <div style={{ fontWeight: 900, color: NAVY, marginBottom: 4 }}>No inquiries</div>
            <div style={{ fontSize: 13 }}>New inquiries from the sign in page will appear here.</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="qc-rtable" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f7fafd", color: MUTED }}>
                  {["ID", "Received", "Name", "Contact", "Subject", "Preferred", "Status", ""].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "11px 14px", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.inquiry_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td data-label="ID" style={{ padding: "11px 14px", color: MUTED, fontWeight: 800 }}>#{item.inquiry_id}</td>
                    <td data-label="Received" style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>{new Date(item.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td data-label="Name" style={{ padding: "11px 14px", fontWeight: 800, color: NAVY }}>{item.full_name}</td>
                    <td data-label="Contact" style={{ padding: "11px 14px", color: MUTED }}>
                      <div>{item.email || "-"}</div>
                      <div>{item.phone || ""}</div>
                    </td>
                    <td data-label="Subject" className="qc-td-block" style={{ padding: "11px 14px", maxWidth: 240 }}>
                      <div style={{ fontWeight: 700, color: NAVY }}>{item.subject || "(no subject)"}</div>
                      <div style={{ color: MUTED, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.message}</div>
                    </td>
                    <td data-label="Preferred" style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>{item.preferred_date ? String(item.preferred_date).slice(0, 10) : "-"}</td>
                    <td data-label="Status" style={{ padding: "11px 14px" }}><StatusBadge status={item.status} /></td>
                    <td data-label="Action" className="qc-td-block" style={{ padding: "11px 14px" }}>
                      <button onClick={() => openInquiry(item)} style={{ border: `1px solid ${NAVY}`, background: "#fff", color: NAVY, borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination (server-side: page drives the fetch) */}
        {!loading && (
          <Pagination
            page={page}
            totalPages={pages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            label="inquiries"
          />
        )}
      </div>

      {/* Detail / action modal */}
      {active && (
        <div onClick={() => setActive(null)} style={{ position: "fixed", inset: 0, background: "rgba(8,18,33,.5)", display: "grid", placeItems: "center", padding: 16, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 24px 64px rgba(14,35,64,.28)" }}>
            <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: `1px solid ${BORDER}`, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: NAVY, fontSize: 18, fontWeight: 900 }}>Inquiry #{active.inquiry_id}</h3>
              <button onClick={() => setActive(null)} aria-label="Close" style={{ border: 0, background: BG, color: NAVY, width: 34, height: 34, borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
            </div>
            <div style={{ padding: "16px 20px 22px", display: "grid", gap: 12 }}>
              <Detail label="From" value={active.full_name} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Detail label="Email" value={active.email || "-"} />
                <Detail label="Phone" value={active.phone || "-"} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Detail label="Subject" value={active.subject || "(no subject)"} />
                <Detail label="Preferred date" value={active.preferred_date ? String(active.preferred_date).slice(0, 10) : "-"} />
              </div>
              <Detail label="Message" value={active.message} multiline />

              <div style={{ height: 1, background: BORDER, margin: "4px 0" }} />

              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: MUTED }}>
                Status
                <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} style={fieldStyle}>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: MUTED }}>
                Staff notes
                <textarea value={draft.admin_notes} onChange={(e) => setDraft((d) => ({ ...d, admin_notes: e.target.value }))} rows={3} style={fieldStyle} placeholder="Internal notes (e.g. called the patient, booked them in)" />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                <button onClick={() => setActive(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: NAVY, borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>Close</button>
                <button onClick={saveInquiry} disabled={saving} style={{ border: 0, background: NAVY, color: "#fff", borderRadius: 10, padding: "10px 18px", fontWeight: 800, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </MainLayout>
  );
}

const fieldStyle = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", color: NAVY, background: "#fafbfd" };
function Detail({ label, value, multiline }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 11, fontWeight: 900, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ color: NAVY, fontSize: 14, whiteSpace: multiline ? "pre-wrap" : "normal", lineHeight: 1.55 }}>{value}</div>
    </div>
  );
}
