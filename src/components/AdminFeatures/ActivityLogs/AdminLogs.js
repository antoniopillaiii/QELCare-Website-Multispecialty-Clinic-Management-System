// FILE: src/components/AdminFeatures/ActivityLogs/AdminLogs.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { C as COLORS } from "../../../utils/adminTheme";

const EXPORT_COLUMNS = [
  { header: "Time", value: (log) => formatDateTime(log.created_at) },
  { header: "Actor", value: (log) => actorName(log) },
  { header: "Role", value: (log) => log.role_name || log.username || "System" },
  { header: "Action", value: (log) => formatAction(log.action) },
  { header: "Entity", value: (log) => `${entityMeta(log.entity_type).label}${log.entity_id ? ` #${log.entity_id}` : ""}` },
  { header: "Description", value: (log) => log.description || "" },
  { header: "IP Address", value: (log) => log.ip_address || "" },
];

const ENTITY_META = {
  appointment: { label: "Appointment", color: COLORS.blue, bg: "#eef3fb" },
  billing: { label: "Billing", color: COLORS.amber, bg: "#fff6e5" },
  patient: { label: "Patient", color: COLORS.teal, bg: "#eaf7f5" },
  queue: { label: "Queue", color: COLORS.purple, bg: "#f5eeff" },
  medical_record: { label: "Medical Record", color: COLORS.navy, bg: "#eef3fb" },
  record: { label: "Medical Record", color: COLORS.navy, bg: "#eef3fb" },
  vitals: { label: "Vitals", color: COLORS.green, bg: "#eaf6ef" },
  user: { label: "User", color: COLORS.purple, bg: "#f5eeff" },
  auth: { label: "Auth", color: COLORS.red, bg: "#fff0f0" },
  system: { label: "System", color: COLORS.gray, bg: "#f2f5f8" },
};

const DEFAULT_FILTERS = {
  search: "",
  action: "ALL",
  entity_type: "ALL",
  user_id: "ALL",
  from: "",
  to: "",
  limit: "25",
};

function formatAction(action) {
  if (!action) return "Activity";
  return action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function entityMeta(entityType) {
  return ENTITY_META[String(entityType || "system").toLowerCase()] || {
    label: formatAction(entityType || "System"),
    color: COLORS.gray,
    bg: "#f2f5f8",
  };
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function actorName(log) {
  const name = log.actor_name || [log.first_name, log.last_name].filter(Boolean).join(" ").trim();
  return name || log.username || "System";
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildQuery(filters, page) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", filters.limit || "25");

  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.action !== "ALL") params.set("action", filters.action);
  if (filters.entity_type !== "ALL") params.set("entity_type", filters.entity_type);
  if (filters.user_id !== "ALL") params.set("user_id", filters.user_id);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return params.toString();
}

function SummaryCard({ label, value, helper, color }) {
  return (
    <div className="al-card">
      <div className="al-card-mark" style={{ background: `${color}18`, color }}>
        <span />
      </div>
      <div>
        <div className="al-card-label">{label}</div>
        <div className="al-card-value">{value}</div>
        <div className="al-card-helper">{helper}</div>
      </div>
    </div>
  );
}

function Badge({ children, color, bg }) {
  return (
    <span className="al-badge" style={{ color, background: bg }}>
      {children}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="al-skeleton-wrap">
      {[1, 2, 3, 4, 5].map((item) => (
        <div className="al-skeleton-row" key={item}>
          <div className="al-skeleton-dot" />
          <div className="al-skeleton-lines">
            <div />
            <div />
          </div>
          <div className="al-skeleton-date" />
        </div>
      ))}
    </div>
  );
}

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState({ actions: [], entity_types: [], users: [] });
  const [summary, setSummary] = useState({
    total: 0,
    today: 0,
    last_24_hours: 0,
    active_users: 0,
    system_events: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    pages: 1,
  });
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [queryFilters, setQueryFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const res = await authFetch("/activity-logs/meta");
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to load activity log filters.");
      }
      setMeta(data.data || { actions: [], entity_types: [], users: [] });
    } catch (err) {
      console.error("Activity log filter load failed:", err);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = buildQuery(queryFilters, page);
      const res = await authFetch(`/activity-logs?${query}`);
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to load activity logs.");
      }

      setLogs(Array.isArray(data.data) ? data.data : []);
      setSummary(data.summary || {});
      setPagination(data.pagination || { page, limit: Number(queryFilters.limit), total: 0, pages: 1 });
    } catch (err) {
      setLogs([]);
      setError(err.message || "Failed to load activity logs.");
    } finally {
      setLoading(false);
    }
  }, [page, queryFilters]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filterCount = useMemo(() => {
    return ["search", "action", "entity_type", "user_id", "from", "to"].reduce((count, key) => {
      const emptyValue = DEFAULT_FILTERS[key];
      return draftFilters[key] !== emptyValue ? count + 1 : count;
    }, 0);
  }, [draftFilters]);

  function updateDraft(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setQueryFilters(draftFilters);
  }

  function clearFilters() {
    setDraftFilters(DEFAULT_FILTERS);
    setQueryFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  const totalPages = Math.max(1, safeNumber(pagination.pages));
  const currentPage = Math.min(page, totalPages);

  return (
    <MainLayout pageTitle="Activity Logs" pageSubtitle="Admin audit trail for important system actions">
      <div className="al-page">
        <div className="al-summary">
          <SummaryCard
            label="Matching Logs"
            value={safeNumber(summary.total).toLocaleString()}
            helper="Based on current filters"
            color={COLORS.blue}
          />
          <SummaryCard
            label="Today"
            value={safeNumber(summary.today).toLocaleString()}
            helper="Events recorded today"
            color={COLORS.green}
          />
          <SummaryCard
            label="Last 24 Hours"
            value={safeNumber(summary.last_24_hours).toLocaleString()}
            helper="Recent audit activity"
            color={COLORS.amber}
          />
          <SummaryCard
            label="Active Actors"
            value={safeNumber(summary.active_users).toLocaleString()}
            helper="Users who generated logs"
            color={COLORS.purple}
          />
        </div>

        <section className="al-panel">
          <div className="al-panel-head">
            <div>
              <h2>Audit Trail</h2>
              <p>
                {loading
                  ? "Loading activity..."
                  : `${safeNumber(pagination.total).toLocaleString()} log${safeNumber(pagination.total) === 1 ? "" : "s"} found`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ExportMenu
                filename="qelcare-activity-logs"
                title="QELCare Activity Logs"
                subtitle={`Current page — ${logs.length} log${logs.length === 1 ? "" : "s"} (page ${currentPage} of ${totalPages})`}
                sheetTitle="Activity Logs"
                columns={EXPORT_COLUMNS}
                rows={logs}
                disabled={loading}
              />
              <button className="al-icon-button" type="button" onClick={loadLogs} title="Refresh logs">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
          </div>

          <form className="al-filters" onSubmit={applyFilters}>
            <div className="al-field al-field-wide">
              <label>Search</label>
              <input
                value={draftFilters.search}
                onChange={(event) => updateDraft("search", event.target.value)}
                placeholder="Action, user, description, entity, IP"
              />
            </div>

            <div className="al-field">
              <label>Action</label>
              <select
                value={draftFilters.action}
                onChange={(event) => updateDraft("action", event.target.value)}
                disabled={metaLoading}
              >
                <option value="ALL">All actions</option>
                {(meta.actions || []).map((item) => (
                  <option key={item.action} value={item.action}>
                    {formatAction(item.action)} ({item.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="al-field">
              <label>Entity</label>
              <select
                value={draftFilters.entity_type}
                onChange={(event) => updateDraft("entity_type", event.target.value)}
                disabled={metaLoading}
              >
                <option value="ALL">All entities</option>
                {(meta.entity_types || []).map((item) => {
                  const info = entityMeta(item.entity_type);
                  return (
                    <option key={item.entity_type} value={item.entity_type}>
                      {info.label} ({item.count})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="al-field">
              <label>Actor</label>
              <select
                value={draftFilters.user_id}
                onChange={(event) => updateDraft("user_id", event.target.value)}
                disabled={metaLoading}
              >
                <option value="ALL">All users</option>
                {(meta.users || [])
                  .filter((user) => user.user_id)
                  .map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.actor_name || user.username} ({user.count})
                    </option>
                  ))}
              </select>
            </div>

            <div className="al-field">
              <label>From</label>
              <input
                type="date"
                value={draftFilters.from}
                onChange={(event) => updateDraft("from", event.target.value)}
              />
            </div>

            <div className="al-field">
              <label>To</label>
              <input
                type="date"
                value={draftFilters.to}
                onChange={(event) => updateDraft("to", event.target.value)}
              />
            </div>

            <div className="al-field">
              <label>Rows</label>
              <select value={draftFilters.limit} onChange={(event) => updateDraft("limit", event.target.value)}>
                <option value="25">25 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
              </select>
            </div>

            <div className="al-filter-actions">
              <button className="al-primary" type="submit">
                Apply
              </button>
              <button className="al-secondary" type="button" onClick={clearFilters}>
                Clear{filterCount ? ` (${filterCount})` : ""}
              </button>
            </div>
          </form>

          {error && <div className="al-error">{error}</div>}

          <div className="al-table-wrap">
            {loading ? (
              <SkeletonRows />
            ) : logs.length === 0 ? (
              <div className="al-empty">
                <div className="al-empty-icon">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h3>No activity logs found</h3>
                <p>Logs will appear after users create, update, queue, record, bill, or manage clinic data.</p>
              </div>
            ) : (
              <table className="al-table qc-rtable">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Description</th>
                    <th>IP Address</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const info = entityMeta(log.entity_type);
                    return (
                      <tr key={log.log_id}>
                        <td data-label="Time" className="al-time">{formatShortDate(log.created_at)}</td>
                        <td data-label="Actor">
                          <div className="al-actor">
                            <span>{actorName(log)}</span>
                            <small>{log.role_name || log.username || "System"}</small>
                          </div>
                        </td>
                        <td data-label="Action">
                          <Badge color={COLORS.navy} bg="#eef3fb">
                            {formatAction(log.action)}
                          </Badge>
                        </td>
                        <td data-label="Entity">
                          <div className="al-entity">
                            <Badge color={info.color} bg={info.bg}>
                              {info.label}
                            </Badge>
                            {log.entity_id && <small>#{log.entity_id}</small>}
                          </div>
                        </td>
                        <td data-label="Description" className="al-description qc-td-block">{log.description || "No description provided."}</td>
                        <td data-label="IP Address" className="al-ip">{log.ip_address || "Not recorded"}</td>
                        <td data-label="Details" className="al-actions qc-td-block">
                          <button type="button" onClick={() => setSelectedLog(log)}>
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={safeNumber(pagination.total)}
              pageSize={safeNumber(pagination.limit) || 25}
              onPageChange={setPage}
              label="logs"
            />
          )}
        </section>

        {selectedLog && (
          <div className="al-modal-backdrop" role="presentation" onMouseDown={() => setSelectedLog(null)}>
            <div className="al-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <div className="al-modal-head">
                <div>
                  <h3>{formatAction(selectedLog.action)}</h3>
                  <p>Log #{selectedLog.log_id} recorded {formatDateTime(selectedLog.created_at)}</p>
                </div>
                <button type="button" onClick={() => setSelectedLog(null)} aria-label="Close details">
                  x
                </button>
              </div>

              <div className="al-detail-grid">
                <Detail label="Actor" value={actorName(selectedLog)} />
                <Detail label="Role" value={selectedLog.role_name || "System"} />
                <Detail label="Username" value={selectedLog.username || "Not recorded"} />
                <Detail label="Email" value={selectedLog.email || "Not recorded"} />
                <Detail label="Entity" value={`${entityMeta(selectedLog.entity_type).label}${selectedLog.entity_id ? ` #${selectedLog.entity_id}` : ""}`} />
                <Detail label="IP Address" value={selectedLog.ip_address || "Not recorded"} />
              </div>

              <div className="al-detail-block">
                <label>Description</label>
                <p>{selectedLog.description || "No description provided."}</p>
              </div>

              <div className="al-detail-block">
                <label>Metadata</label>
                <pre>{JSON.stringify(selectedLog.metadata || {}, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .al-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: ${COLORS.navy};
        }

        .al-summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .al-card {
          background: #fff;
          border: 1px solid ${COLORS.border};
          border-radius: 14px;
          padding: 18px;
          display: flex;
          gap: 14px;
          align-items: flex-start;
          box-shadow: 0 2px 10px rgba(15, 39, 68, 0.05);
        }

        .al-card-mark {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
        }

        .al-card-mark span {
          width: 14px;
          height: 14px;
          border: 3px solid currentColor;
          border-radius: 50%;
        }

        .al-card-label {
          font-size: 12px;
          font-weight: 800;
          color: #7c8a9a;
          margin-bottom: 4px;
        }

        .al-card-value {
          font-size: 27px;
          line-height: 1;
          font-weight: 900;
          color: ${COLORS.navy};
        }

        .al-card-helper {
          margin-top: 6px;
          font-size: 12px;
          color: #8a97a8;
        }

        .al-panel {
          background: #fff;
          border: 1px solid ${COLORS.border};
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 18px rgba(15, 39, 68, 0.06);
        }

        .al-panel-head {
          padding: 20px 22px;
          border-bottom: 1px solid #eef3f9;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .al-panel-head h2,
        .al-modal-head h3,
        .al-empty h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 900;
          color: ${COLORS.navy};
        }

        .al-panel-head p,
        .al-modal-head p,
        .al-empty p {
          margin: 4px 0 0;
          color: #7c8a9a;
          font-size: 13px;
        }

        .al-icon-button {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          border: 1px solid #dce6f1;
          background: #fff;
          color: ${COLORS.blue};
          display: grid;
          place-items: center;
          cursor: pointer;
        }

        .al-filters {
          padding: 16px 22px;
          display: grid;
          grid-template-columns: 1.4fr repeat(6, minmax(120px, 1fr)) auto;
          gap: 12px;
          align-items: end;
          border-bottom: 1px solid #eef3f9;
          background: #fbfdff;
        }

        .al-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .al-field label,
        .al-detail-block label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0;
          font-weight: 900;
          color: #7c8a9a;
        }

        .al-field input,
        .al-field select {
          height: 38px;
          width: 100%;
          border: 1px solid #dce6f1;
          border-radius: 10px;
          background: #fff;
          color: #17212b;
          font-family: inherit;
          font-size: 13px;
          padding: 0 11px;
          outline: none;
        }

        .al-field input:focus,
        .al-field select:focus {
          border-color: ${COLORS.blue};
          box-shadow: 0 0 0 3px rgba(22, 58, 107, 0.1);
        }

        .al-filter-actions {
          display: flex;
          gap: 8px;
        }

        .al-primary,
        .al-secondary,
        .al-actions button {
          height: 38px;
          border-radius: 10px;
          border: 1px solid transparent;
          padding: 0 14px;
          font-family: inherit;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }

        .al-primary {
          background: ${COLORS.blue};
          color: #fff;
        }

        .al-secondary,
        .al-actions button {
          background: #fff;
          border-color: #dce6f1;
          color: ${COLORS.blue};
        }

        .al-error {
          margin: 16px 22px 0;
          padding: 12px 14px;
          background: #fff0f0;
          color: #8f2f2f;
          border: 1px solid #ffd1d1;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
        }

        .al-table-wrap {
          overflow-x: auto;
        }

        .al-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1060px;
        }

        .al-table th {
          text-align: left;
          padding: 13px 16px;
          font-size: 11px;
          color: #7c8a9a;
          text-transform: uppercase;
          letter-spacing: 0;
          background: #fff;
          border-bottom: 1px solid #eef3f9;
        }

        .al-table td {
          padding: 15px 16px;
          border-bottom: 1px solid #f0f5fb;
          vertical-align: top;
          font-size: 13px;
          color: #17212b;
        }

        .al-table tbody tr:hover {
          background: #f8fbfd;
        }

        .al-time,
        .al-ip {
          color: #66778a;
          white-space: nowrap;
        }

        .al-actor {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 150px;
        }

        .al-actor span {
          font-weight: 850;
          color: ${COLORS.navy};
        }

        .al-actor small,
        .al-entity small {
          color: #8a97a8;
          font-size: 12px;
        }

        .al-badge {
          display: inline-flex;
          align-items: center;
          min-height: 25px;
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 900;
          line-height: 1.2;
          white-space: nowrap;
        }

        .al-entity {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: flex-start;
        }

        .al-description {
          color: #3e4c5b;
          max-width: 420px;
          line-height: 1.45;
        }

        .al-actions {
          text-align: right;
        }

        .al-actions button {
          height: 32px;
          padding: 0 11px;
        }

        .al-empty {
          padding: 56px 20px;
          text-align: center;
        }

        .al-empty-icon {
          width: 58px;
          height: 58px;
          margin: 0 auto 14px;
          border-radius: 15px;
          background: #eef3fb;
          color: ${COLORS.blue};
          display: grid;
          place-items: center;
        }

        .al-skeleton-wrap {
          padding: 10px 0;
        }

        .al-skeleton-row {
          display: flex;
          gap: 14px;
          align-items: center;
          padding: 17px 22px;
          border-bottom: 1px solid #f0f5fb;
        }

        .al-skeleton-dot,
        .al-skeleton-lines div,
        .al-skeleton-date {
          background: linear-gradient(90deg, #eef3f9, #f8fbfd, #eef3f9);
          background-size: 200% 100%;
          animation: al-pulse 1s linear infinite;
        }

        .al-skeleton-dot {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          flex: 0 0 auto;
        }

        .al-skeleton-lines {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .al-skeleton-lines div:first-child {
          width: 38%;
          height: 13px;
          border-radius: 8px;
        }

        .al-skeleton-lines div:last-child {
          width: 72%;
          height: 11px;
          border-radius: 8px;
        }

        .al-skeleton-date {
          width: 105px;
          height: 12px;
          border-radius: 8px;
        }

        .al-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(10, 24, 40, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .al-modal {
          width: min(760px, 100%);
          max-height: min(760px, calc(100vh - 36px));
          overflow: auto;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(15, 39, 68, 0.25);
          border: 1px solid ${COLORS.border};
        }

        .al-modal-head {
          padding: 20px 22px;
          border-bottom: 1px solid #eef3f9;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .al-modal-head button {
          width: 34px;
          height: 34px;
          border: 1px solid #dce6f1;
          border-radius: 10px;
          background: #fff;
          color: ${COLORS.gray};
          cursor: pointer;
          font-weight: 900;
        }

        .al-detail-grid {
          padding: 18px 22px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .al-detail-item {
          border: 1px solid #eef3f9;
          border-radius: 12px;
          padding: 11px 12px;
          background: #fbfdff;
          min-width: 0;
        }

        .al-detail-item label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0;
          color: #7c8a9a;
          font-weight: 900;
          margin-bottom: 4px;
        }

        .al-detail-item span {
          display: block;
          color: ${COLORS.navy};
          font-size: 13px;
          font-weight: 750;
          overflow-wrap: anywhere;
        }

        .al-detail-block {
          padding: 0 22px 18px;
        }

        .al-detail-block p,
        .al-detail-block pre {
          margin: 8px 0 0;
          border: 1px solid #eef3f9;
          border-radius: 12px;
          background: #fbfdff;
          padding: 12px;
          color: #24364a;
          font-size: 13px;
          line-height: 1.55;
        }

        .al-detail-block pre {
          overflow: auto;
          font-family: Consolas, Monaco, "Courier New", monospace;
          max-height: 260px;
        }

        @keyframes al-pulse {
          to { background-position: -200% 0; }
        }

        @media (max-width: 1180px) {
          .al-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .al-filters {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .al-field-wide {
            grid-column: span 3;
          }
        }

        @media (max-width: 760px) {
          .al-summary,
          .al-filters,
          .al-detail-grid {
            grid-template-columns: 1fr;
          }

          .al-field-wide {
            grid-column: auto;
          }

          .al-panel-head {
            align-items: stretch;
            flex-direction: column;
          }

          .al-filter-actions {
            width: 100%;
          }

          .al-primary,
          .al-secondary {
            flex: 1;
          }
        }
      `}</style>
    </MainLayout>
  );
}

function Detail({ label, value }) {
  return (
    <div className="al-detail-item">
      <label>{label}</label>
      <span>{value || "Not recorded"}</span>
    </div>
  );
}
