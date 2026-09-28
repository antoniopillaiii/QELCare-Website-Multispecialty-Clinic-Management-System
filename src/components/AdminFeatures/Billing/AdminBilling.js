import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import ReasonModal from "../../common/ReasonModal";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { CLINIC_TZ } from "../../../utils/manilaDate";
import { buildQuery, fetchAllPages, fetchJson } from "../../../utils/paginatedFetch";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

// Payment times are shown on the clinic's clock (Asia/Manila).
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const methodLabels = {
  cash: "Cash",
  gcash: "Online",
  maya: "Online",
  card: "Online",
  online: "Online",
  hmo: "HMO",
  insurance: "HMO",
  philhealth: "HMO",
};

const methodDetailLabels = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  card: "Card",
  online: "Online Payment",
  hmo: "HMO",
  insurance: "Insurance",
  philhealth: "PhilHealth",
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMethod(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function getPaymentSource(method) {
  const normalized = normalizeMethod(method);
  return methodLabels[normalized] || "Other";
}

function getPaymentMethodLabel(method) {
  const normalized = normalizeMethod(method);
  if (!normalized) return "Not specified";
  return methodDetailLabels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCurrency(value) {
  return pesoFormatter.format(toNumber(value));
}

function formatPaidAt(value) {
  const date = toDateValue(value);
  return date ? dateFormatter.format(date) : "Not recorded";
}

// Payment methods the billing API accepts. The source filter sends the
// methods behind a source, so the grouping above stays the single mapping.
const BILLING_METHODS = ["cash", "gcash", "maya", "card", "bank_transfer", "philhealth", "hmo", "other"];

function methodsForSource(source) {
  if (!source || source === "all") return [];
  return BILLING_METHODS.filter((method) => getPaymentSource(method).toLowerCase() === source);
}

function normalizeTransaction(transaction) {
  const paidAt = transaction.paid_at || transaction.created_at;
  return {
    ...transaction,
    reference:
      transaction.or_number ||
      transaction.receipt_number ||
      transaction.payment_reference ||
      `BILL-${transaction.billing_id || transaction.id || "N/A"}`,
    amount: toNumber(transaction.total_amount || transaction.amount_paid || transaction.amount),
    paidAt,
    paidDate: toDateValue(paidAt),
    status: normalizeText(transaction.status || "paid"),
    paymentMethod: transaction.payment_method || transaction.method,
    paymentSource: getPaymentSource(transaction.payment_method || transaction.method),
  };
}

const PAGE_SIZE = 10;

const EXPORT_COLUMNS = [
  { header: "OR / Reference", value: (txn) => txn.reference || "" },
  { header: "Amount Paid", value: (txn) => formatCurrency(txn.amount) },
  { header: "Payment Source", value: (txn) => txn.paymentSource || "" },
  { header: "Method", value: (txn) => getPaymentMethodLabel(txn.paymentMethod) },
  { header: "Date Paid", value: (txn) => formatPaidAt(txn.paidAt) },
  { header: "Status", value: (txn) => (txn.status || "unknown").replace(/\b\w/g, (char) => char.toUpperCase()) },
];

// Admin: /admin/billing. Cashier: /cashier/transactions (same table, same
// rules). Both roles may void a paid bill; a reason is required (server-enforced).
function AdminBilling({ pageTitle = "Billing" }) {
  // One page of bills from the server. Search, source / status / Manila-date
  // filters, paging and exports all run against the whole billing table; the
  // summary cards are the server's totals over every bill.
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    method: "all",
    status: "paid",
    from: "",
    to: "",
  });

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(filters.search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [filters.search]);

  const query = useMemo(() => ({
    search: searchQuery,
    status: filters.status,
    payment_method: methodsForSource(filters.method),
    // Clinic (Asia/Manila) calendar days, whole day inclusive, filtered on the
    // server - the device's own time zone plays no part.
    date_from: filters.from,
    date_to: filters.to,
  }), [filters.from, filters.method, filters.status, filters.to, searchQuery]);

  // Any filter change goes back to page 1.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const fetchDashboard = useCallback(async () => {
    try {
      const payload = await fetchJson("/billing/dashboard");
      setDashboard(payload?.data || null);
    } catch (err) {
      setError(err.message || "Unable to load billing summary.");
    }
  }, []);

  // Only the latest request may update the table.
  const requestRef = useRef(0);
  const fetchTransactions = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const payload = await fetchJson(`/billing${buildQuery({ ...query, page, limit: PAGE_SIZE })}`);
      if (requestId !== requestRef.current) return;
      setTransactions(Array.isArray(payload?.data) ? payload.data : []);
      setTotal(Number(payload.total) || 0);
      setPages(Number(payload.pages) || 1);
      setError("");
    } catch (err) {
      if (requestId === requestRef.current) setError(err.message || "Unable to load billing transactions.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [page, query]);

  const fetchBilling = useCallback(() => {
    fetchDashboard();
    fetchTransactions();
  }, [fetchDashboard, fetchTransactions]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const pageItems = useMemo(() => transactions.map(normalizeTransaction), [transactions]);

  // Every bill matching the current filters, for the export.
  const loadAllRows = useCallback(
    async () => (await fetchAllPages("/billing", query)).map(normalizeTransaction),
    [query]
  );

  const summary = useMemo(() => {
    const stats = dashboard?.stats || {};
    // HMO Paid over ALL paid bills, grouped with the same source mapping the
    // table uses.
    const hmoPaid = (stats.by_method || [])
      .filter((row) => getPaymentSource(row.payment_method) === "HMO")
      .reduce((sum, row) => sum + toNumber(row.total), 0);

    return {
      totalPaid: stats.total_revenue,
      todayPaid: stats.today_revenue,
      monthPaid: stats.month_revenue,
      hmoPaid,
    };
  }, [dashboard]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const clearFilters = () => {
    setFilters({
      search: "",
      method: "all",
      status: "paid",
      from: "",
      to: "",
    });
  };

  // Voids the bill with the reason from the modal. The modal stays open (busy)
  // until the server answers, so a second click can't send a second void.
  const voidBill = async (reason) => {
    const target = voidTarget;
    if (!target || voiding) return;
    setVoiding(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch(`/billing/${target.id}/void`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to void the payment.");
      }
      setNotice(`${target.reference} voided. The visit is back in Ready for Payment and can be billed again.`);
      fetchBilling();
    } catch (err) {
      // E.g. already voided in another tab: reload the current state first
      // (a successful reload clears the error box), then show why it failed.
      await fetchTransactions();
      setError(err.message || "Failed to void the payment.");
    } finally {
      setVoiding(false);
      setVoidTarget(null);
    }
  };

  return (
    <MainLayout pageTitle={pageTitle} pageSubtitle="Transaction history">
      <div className="admin-billing">
        <div className="billing-header">
          <div>
            <h2>Billing Transactions</h2>
            <p>Paid amounts by date and payment source.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <ExportMenu
              filename="qelcare-billing"
              title="QELCare Billing Transactions"
              subtitle={`${total} transaction${total === 1 ? "" : "s"} matching the current filters`}
              sheetTitle="Billing"
              columns={EXPORT_COLUMNS}
              rows={pageItems}
              rowCount={total}
              loadRows={loadAllRows}
              disabled={loading}
            />
            <button type="button" className="refresh-button" onClick={fetchBilling} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && <div className="billing-alert">{error}</div>}
        {notice && <div className="billing-notice" role="status">{notice}</div>}

        <div className="billing-summary-grid">
          <div className="billing-summary-card">
            <span>Total Paid</span>
            <strong>{formatCurrency(summary.totalPaid)}</strong>
          </div>
          <div className="billing-summary-card">
            <span>Today</span>
            <strong>{formatCurrency(summary.todayPaid)}</strong>
          </div>
          <div className="billing-summary-card">
            <span>This Month</span>
            <strong>{formatCurrency(summary.monthPaid)}</strong>
          </div>
          <div className="billing-summary-card">
            <span>HMO Paid</span>
            <strong>{formatCurrency(summary.hmoPaid)}</strong>
          </div>
        </div>

        <div className="billing-filters">
          <input
            type="search"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Search OR number or patient"
          />
          <select value={filters.method} onChange={(event) => updateFilter("method", event.target.value)}>
            <option value="all">All sources</option>
            <option value="cash">Cash</option>
            <option value="online">Online</option>
            <option value="hmo">HMO</option>
            <option value="other">Other</option>
          </select>
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="paid">Paid only</option>
            <option value="all">All statuses</option>
            <option value="voided">Voided</option>
          </select>
          <input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} />
          <input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} />
          <button type="button" className="secondary-button" onClick={clearFilters}>
            Clear
          </button>
        </div>

        <div className="billing-table-card">
          <div className="table-heading">
            <div>
              <h3>Transactions</h3>
              <p>{total} record{total === 1 ? "" : "s"}</p>
            </div>
          </div>

          <div className="billing-table-wrap">
            <table className="billing-table qc-rtable">
              <thead>
                <tr>
                  <th>OR / Reference</th>
                  <th>Amount Paid</th>
                  <th>Payment Source</th>
                  <th>Method</th>
                  <th>Date Paid</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" className="empty-cell">
                      Loading transactions...
                    </td>
                  </tr>
                ) : pageItems.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-cell">
                      No billing transactions found.
                    </td>
                  </tr>
                ) : (
                  pageItems.map((transaction) => (
                    <tr key={transaction.billing_id || transaction.id || transaction.reference}>
                      <td data-label="OR / Reference">
                        <strong>{transaction.reference}</strong>
                      </td>
                      <td data-label="Amount Paid">{formatCurrency(transaction.amount)}</td>
                      <td data-label="Payment Source">
                        <span className={`source-pill source-${transaction.paymentSource.toLowerCase()}`}>
                          {transaction.paymentSource}
                        </span>
                      </td>
                      <td data-label="Method">{getPaymentMethodLabel(transaction.paymentMethod)}</td>
                      <td data-label="Date Paid">{formatPaidAt(transaction.paidAt)}</td>
                      <td data-label="Status">
                        <span className={`status-pill status-${transaction.status || "unknown"}`}>
                          {(transaction.status || "unknown").replace(/\b\w/g, (char) => char.toUpperCase())}
                        </span>
                      </td>
                      <td data-label="Actions" className="actions-col">
                        {transaction.status === "paid" ? (
                          <button
                            type="button"
                            className="void-button"
                            disabled={voiding}
                            onClick={() => { setNotice(""); setVoidTarget(transaction); }}
                          >
                            Void
                          </button>
                        ) : (
                          <span className="actions-none">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && (
            <Pagination
              page={page}
              totalPages={pages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              label="transactions"
            />
          )}
        </div>
      </div>

      <style>{`
        .admin-billing {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .billing-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }

        .billing-header h2,
        .table-heading h3 {
          margin: 0;
          color: #0f2744;
          font-size: 24px;
          line-height: 1.2;
        }

        .billing-header p,
        .table-heading p {
          margin: 6px 0 0;
          color: #5a6a7e;
          font-size: 14px;
        }

        .refresh-button,
        .secondary-button {
          border: 1px solid #d8e2ee;
          background: #ffffff;
          color: #0f2744;
          border-radius: 8px;
          padding: 10px 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
          white-space: nowrap;
        }

        .refresh-button:hover,
        .secondary-button:hover {
          background: #f8fafd;
          border-color: #aebfd3;
        }

        .refresh-button:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .billing-alert {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 14px;
        }

        .billing-notice {
          border: 1px solid #b8e5cc;
          background: #eaf8f0;
          color: #0f6b3c;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 600;
        }

        .actions-col {
          text-align: right !important;
          white-space: nowrap;
        }

        .void-button {
          border: 1px solid #f1b4b4;
          background: #ffffff;
          color: #ad3131;
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
        }

        .void-button:hover:not(:disabled) {
          background: #fff4f4;
          border-color: #ad3131;
        }

        .void-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .actions-none {
          color: #94a3b8;
        }

        .billing-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .billing-summary-card {
          background: #ffffff;
          border: 1px solid #e4ecf5;
          border-radius: 8px;
          padding: 18px;
          min-width: 0;
        }

        .billing-summary-card span {
          display: block;
          color: #5a6a7e;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .billing-summary-card strong {
          color: #0f2744;
          font-size: 24px;
          line-height: 1.15;
          word-break: break-word;
        }

        .billing-filters {
          display: grid;
          grid-template-columns: minmax(220px, 1.5fr) repeat(4, minmax(130px, 1fr)) auto;
          gap: 10px;
          align-items: center;
          background: #ffffff;
          border: 1px solid #e4ecf5;
          border-radius: 8px;
          padding: 14px;
        }

        .billing-filters input,
        .billing-filters select {
          width: 100%;
          border: 1px solid #d8e2ee;
          border-radius: 8px;
          padding: 10px 12px;
          color: #0f2744;
          background: #ffffff;
          font-size: 14px;
          min-width: 0;
        }

        .billing-table-card {
          background: #ffffff;
          border: 1px solid #e4ecf5;
          border-radius: 8px;
          overflow: hidden;
        }

        .table-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px;
          border-bottom: 1px solid #e4ecf5;
        }

        .billing-table-wrap {
          overflow-x: auto;
        }

        .billing-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 760px;
        }

        .billing-table th,
        .billing-table td {
          padding: 14px 18px;
          text-align: left;
          border-bottom: 1px solid #eef3fb;
          color: #475569;
          font-size: 14px;
          vertical-align: middle;
        }

        .billing-table th {
          color: #5a6a7e;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0;
          background: #f8fafd;
        }

        .billing-table tbody tr:hover {
          background: #f8fafd;
        }

        .billing-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .empty-cell {
          text-align: center !important;
          color: #5a6a7e !important;
          padding: 34px 18px !important;
        }

        .source-pill,
        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .source-cash {
          background: #ecfdf5;
          color: #047857;
        }

        .source-online {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .source-hmo {
          background: #f5f3ff;
          color: #6d28d9;
        }

        .source-other {
          background: #eef3fb;
          color: #475569;
        }

        .status-paid {
          background: #dcfce7;
          color: #166534;
        }

        .status-voided {
          background: #fee2e2;
          color: #991b1b;
        }

        .status-pending {
          background: #fef3c7;
          color: #92400e;
        }

        .status-unknown {
          background: #eef3fb;
          color: #475569;
        }

        @media (max-width: 1180px) {
          .billing-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .billing-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .billing-header {
            flex-direction: column;
          }

          .refresh-button {
            width: 100%;
          }

          .billing-summary-grid,
          .billing-filters {
            grid-template-columns: 1fr;
          }

          .secondary-button {
            width: 100%;
          }
        }
      `}</style>

      {voidTarget && (
        <ReasonModal
          title="Void Payment"
          subtitle={`${voidTarget.reference}${voidTarget.patient_name ? ` · ${voidTarget.patient_name}` : ""} · ${formatCurrency(voidTarget.amount)}`}
          label="Void reason"
          placeholder="Why is this payment being voided? (e.g. wrong amount entered)"
          confirmText="Void Payment"
          busy={voiding}
          onClose={() => setVoidTarget(null)}
          onConfirm={voidBill}
        />
      )}
    </MainLayout>
  );
}

export default AdminBilling;
