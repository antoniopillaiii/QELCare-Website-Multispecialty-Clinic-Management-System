import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../../utils/auth";
import { C } from "../../../utils/adminTheme";

function intValue(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((intValue(part) / intValue(total)) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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

function normalizeRole(row) {
  const total = intValue(row.total);
  const active = intValue(row.active);
  const deactivated = intValue(row.deactivated);
  return {
    role_name: row.role_name || "Unknown",
    total,
    active,
    deactivated,
    other: Math.max(total - active - deactivated, 0),
  };
}

function buildCsv(rows, summary) {
  const lines = [];
  lines.push(["Metric", "Value"].map(csvCell).join(","));
  lines.push(["Total users", intValue(summary?.users?.total_users)].map(csvCell).join(","));
  lines.push(["Verified users", intValue(summary?.users?.active_users)].map(csvCell).join(","));
  lines.push(["Deactivated users", intValue(summary?.users?.deactivated_users)].map(csvCell).join(","));
  lines.push(["New users this month", intValue(summary?.users?.new_this_month)].map(csvCell).join(","));
  lines.push("");
  lines.push(["Role", "Total", "Verified", "Deactivated", "Other status"].map(csvCell).join(","));
  rows.forEach((row) => {
    lines.push([row.role_name, row.total, row.active, row.deactivated, row.other].map(csvCell).join(","));
  });
  return lines.join("\n");
}

function buildPrintableReport(rows, summary) {
  const users = summary?.users || {};
  const total = intValue(users.total_users);
  const active = intValue(users.active_users);
  const deactivated = intValue(users.deactivated_users);
  const newThisMonth = intValue(users.new_this_month);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>QELCare User Statistics Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17212b; margin: 36px; }
    h1 { color: #163b6b; margin: 0 0 6px; }
    h2 { color: #163b6b; margin-top: 28px; }
    .muted { color: #66758a; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 22px 0; }
    .card { border: 1px solid #d8e2ee; border-left: 5px solid #163b6b; padding: 14px; border-radius: 6px; }
    .label { color: #66758a; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d8e2ee; padding: 8px; text-align: left; }
    th { background: #f4f7fb; color: #163b6b; }
    @media print { body { margin: 20mm; } }
  </style>
</head>
<body>
  <h1>QELCare User Statistics Report</h1>
  <div class="muted">Live account distribution by role and account status.</div>

  <div class="grid">
    <div class="card"><div class="label">Total Users</div><div class="value">${total}</div></div>
    <div class="card"><div class="label">Verified Users</div><div class="value">${active}</div></div>
    <div class="card"><div class="label">Deactivated Users</div><div class="value">${deactivated}</div></div>
    <div class="card"><div class="label">New This Month</div><div class="value">${newThisMonth}</div></div>
  </div>

  <h2>Role Distribution</h2>
  <table>
    <thead>
      <tr><th>Role</th><th>Total</th><th>Verified</th><th>Deactivated</th><th>Other Status</th></tr>
    </thead>
    <tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.role_name)}</td><td>${row.total}</td><td>${row.active}</td><td>${row.deactivated}</td><td>${row.other}</td></tr>`).join("")}
    </tbody>
  </table>

  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

function MetricCard({ label, value, detail, accent = C.navy }) {
  return (
    <article style={{ ...styles.metricCard, borderLeftColor: accent }}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {detail ? <div style={styles.metricDetail}>{detail}</div> : null}
    </article>
  );
}

function RoleBars({ rows }) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  const visibleRows = rows.filter((row) => row.total > 0);

  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>Role Distribution</h2>
      {visibleRows.length === 0 ? (
        <div style={styles.empty}>No user account data found.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {visibleRows.map((row) => {
            const width = Math.max(8, Math.round((row.total / max) * 100));
            return (
              <div key={row.role_name}>
                <div style={styles.barHeader}>
                  <span style={styles.barLabel}>{row.role_name}</span>
                  <span style={styles.barValue}>{row.total}</span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function UserStatisticsReport() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rolesResponse, summaryResponse] = await Promise.all([
        authFetch("/analytics/users/by-role"),
        authFetch("/analytics/summary"),
      ]);

      const rolesPayload = await rolesResponse.json();
      const summaryPayload = await summaryResponse.json();

      if (!rolesResponse.ok || !rolesPayload.success) {
        throw new Error(rolesPayload.message || "Failed to load user role analytics.");
      }
      if (!summaryResponse.ok || !summaryPayload.success) {
        throw new Error(summaryPayload.message || "Failed to load analytics summary.");
      }

      setRoles((rolesPayload.data || []).map(normalizeRole));
      setSummary(summaryPayload.data || null);
    } catch (err) {
      setError(err.message || "Failed to load user statistics report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const totals = useMemo(() => {
    const users = summary?.users || {};
    const total = intValue(users.total_users);
    const active = intValue(users.active_users);
    const deactivated = intValue(users.deactivated_users);
    const newThisMonth = intValue(users.new_this_month);
    return {
      total,
      active,
      deactivated,
      newThisMonth,
      activeRate: pct(active, total),
    };
  }, [summary]);

  function downloadCsv() {
    downloadTextFile("qelcare-user-statistics-report.csv", buildCsv(roles, summary), "text/csv;charset=utf-8");
  }

  function downloadPdf() {
    const popup = window.open("", "_blank", "width=1000,height=800");
    if (!popup) {
      setError("Popup blocked. Allow popups, then click Download PDF again.");
      return;
    }
    popup.document.open();
    popup.document.write(buildPrintableReport(roles, summary));
    popup.document.close();
  }

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <button type="button" style={styles.backButton} onClick={() => navigate(-1)}>
          {"<- Back"}
        </button>
        <div>
          <h1 style={styles.title}>User Statistics Report</h1>
          <p style={styles.subtitle}>Live account distribution by role and verification status.</p>
        </div>
      </header>

      <main style={styles.container}>
        <section style={styles.toolbar}>
          <div>
            <h2 style={styles.toolbarTitle}>Account Summary</h2>
            <p style={styles.toolbarText}>Use this for panel presentation when showing admin control over staff and patient accounts.</p>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={loadReport} disabled={loading} style={styles.primaryButton}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={downloadPdf} disabled={loading || !summary} style={styles.secondaryButton}>
              Download PDF
            </button>
            <button type="button" onClick={downloadCsv} disabled={loading || !summary} style={styles.secondaryButton}>
              Export CSV
            </button>
          </div>
        </section>

        {error ? <div style={styles.error}>{error}</div> : null}

        <section style={styles.metricGrid}>
          <MetricCard label="Total Users" value={totals.total} detail="All system accounts" />
          <MetricCard label="Verified Users" value={totals.active} detail={`${totals.activeRate} of all users`} accent={C.teal} />
          <MetricCard label="Deactivated Users" value={totals.deactivated} detail="Blocked or inactive accounts" accent={C.red} />
          <MetricCard label="New This Month" value={totals.newThisMonth} detail="Recently created users" accent={C.blue} />
        </section>

        <div style={styles.gridTwo}>
          <RoleBars rows={roles} />

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Status Notes</h2>
            <p style={styles.summary}>
              Verified accounts can sign in and use their assigned module. Deactivated accounts are blocked from access. Other statuses include unverified or locked accounts.
            </p>
            <p style={styles.recommendation}>
              Admin should create and manage every staff account separately. Frontdesk, nurse, doctor, cashier, admin, and patient users must remain distinct accounts for audit and accountability.
            </p>
          </section>
        </div>

        <section style={styles.panel}>
          <h2 style={styles.panelTitle}>Detailed Report View</h2>
          {loading ? (
            <div style={styles.empty}>Loading user statistics...</div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Verified</th>
                    <th style={styles.th}>Deactivated</th>
                    <th style={styles.th}>Other Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((row) => (
                    <tr key={row.role_name}>
                      <td style={styles.td}>{row.role_name}</td>
                      <td style={styles.td}>{row.total}</td>
                      <td style={styles.td}>{row.active}</td>
                      <td style={styles.td}>{row.deactivated}</td>
                      <td style={styles.td}>{row.other}</td>
                    </tr>
                  ))}
                  {roles.length === 0 ? (
                    <tr>
                      <td style={styles.td} colSpan={5}>No role data found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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
    color: C.text,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  topbar: {
    background: C.navy,
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
    background: C.white,
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 18,
  },
  toolbarTitle: {
    margin: 0,
    color: C.text,
    fontSize: 18,
  },
  toolbarText: {
    margin: "5px 0 0",
    color: C.muted,
    fontSize: 13,
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "none",
    background: C.navy,
    color: "#ffffff",
    borderRadius: 6,
    padding: "11px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    border: `1px solid ${C.line}`,
    background: C.white,
    color: C.navy,
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
    background: C.white,
    border: `1px solid ${C.line}`,
    borderLeft: `5px solid ${C.navy}`,
    borderRadius: 8,
    padding: 16,
  },
  metricLabel: {
    color: C.muted,
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  metricValue: {
    color: C.text,
    fontSize: 30,
    fontWeight: 800,
    marginTop: 4,
  },
  metricDetail: {
    color: C.muted,
    fontSize: 13,
    marginTop: 4,
  },
  gridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  panel: {
    background: C.white,
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
  },
  panelTitle: {
    margin: "0 0 12px",
    color: C.navy,
    fontSize: 20,
  },
  empty: {
    color: C.muted,
    padding: "14px 0",
  },
  barHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  barLabel: {
    color: C.text,
    fontSize: 13,
    fontWeight: 700,
  },
  barValue: {
    color: C.muted,
    fontSize: 13,
    fontWeight: 800,
  },
  barTrack: {
    height: 10,
    background: "#e8eef5",
    borderRadius: 999,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: C.navy,
    borderRadius: 999,
  },
  summary: {
    margin: "0 0 14px",
    lineHeight: 1.55,
    color: "#263548",
  },
  recommendation: {
    margin: 0,
    background: "#eef6ff",
    borderLeft: `4px solid ${C.navy}`,
    borderRadius: 6,
    padding: "12px 14px",
    color: C.navy,
    fontWeight: 700,
    lineHeight: 1.5,
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
    color: C.navy,
    textAlign: "left",
    padding: 10,
    borderBottom: `1px solid ${C.line}`,
    fontSize: 13,
  },
  td: {
    padding: 10,
    borderBottom: "1px solid #edf2f7",
    color: "#263548",
    fontSize: 14,
  },
};
