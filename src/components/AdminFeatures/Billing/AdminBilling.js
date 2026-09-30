import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import MainLayout from "../../Layout/MainLayout";
import Pagination from "../../common/Pagination";
import ReasonModal from "../../common/ReasonModal";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";
import { buildQuery, describeLoadError, fetchAllPages, fetchJson } from "../../../utils/paginatedFetch";
import TransactionDetails from "./TransactionDetails";
import {
  formatCurrency,
  formatDateTime,
  formatDay,
  getPaymentMethodLabel,
  getPaymentSource,
  statusLabel,
  toNumber,
} from "./billingFormat";

// Payment methods the billing API accepts. The source filter sends the
// methods behind a source, so the grouping in billingFormat stays the single mapping.
const BILLING_METHODS = ["cash", "gcash", "maya", "card", "bank_transfer", "philhealth", "hmo", "other"];

const SOURCE_LABELS = { all: "All sources", cash: "Cash", online: "Online", hmo: "HMO", other: "Other" };
const STATUS_LABELS = { paid: "Paid only", all: "All statuses", voided: "Voided" };

// Same limit as the server.
const MAX_VOID_REASON = 500;
const RANGE_ERROR = "The start date must be on or before the end date.";

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
    status: String(transaction.status || "paid").trim().toLowerCase(),
    paymentMethod: transaction.payment_method || transaction.method,
    paymentSource: getPaymentSource(transaction.payment_method || transaction.method),
  };
}

const PAGE_SIZE = 10;

const EXPORT_COLUMNS = [
  { header: "OR / Reference", value: (txn) => txn.reference || "" },
  { header: "Patient", value: (txn) => txn.patient_name || "" },
  { header: "Amount (PHP)", type: "number", value: (txn) => txn.amount.toFixed(2) },
  { header: "Payment Source", value: (txn) => txn.paymentSource || "" },
  { header: "Method", value: (txn) => getPaymentMethodLabel(txn.paymentMethod) },
  { header: "Date Paid", value: (txn) => formatDateTime(txn.paidAt) },
  { header: "Status", value: (txn) => statusLabel(txn.status) },
  { header: "Collected By", value: (txn) => txn.cashier_name || "" },
  { header: "Voided At", value: (txn) => (txn.voided_at ? formatDateTime(txn.voided_at) : "") },
  { header: "Voided By", value: (txn) => txn.voided_by_name || "" },
  { header: "Void Reason", value: (txn) => txn.void_reason || "" },
];

// "Paid Oct 01, 2026", "Paid Oct 01, 2026 to Oct 05, 2026", "Paid from ...", "Paid up to ...".
function describeDates(from, to) {
  if (from && to) return from === to ? `Paid ${formatDay(from)}` : `Paid ${formatDay(from)} to ${formatDay(to)}`;
  if (from) return `Paid from ${formatDay(from)}`;
  if (to) return `Paid up to ${formatDay(to)}`;
  return "Any date";
}

// Admin: /admin/billing. Cashier: /cashier/transactions (same table, same
// rules). Both roles may void a paid bill; a reason is required (server-enforced).
function AdminBilling({ pageTitle = "Billing" }) {
  // One page of bills from the server. Search, source / status / Manila-date
  // filters, paging and exports all run against the whole billing table; the
  // summary cards are the server's totals over every bill, and the table
  // heading carries the totals for the current filters.
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  // The rows on screen and the exact query + page they belong to, so rows are
  // never shown under filters they don't match.
  const [list, setList] = useState({ key: null, rows: [], total: 0, pages: 1, summary: null });
  const [listError, setListError] = useState("");
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // A link may open the page pre-filtered, e.g. the Cashier Dashboard's
  // "Today Revenue" (?from=&to= today) or "Voided" (?status=voided) cards.
  const location = useLocation();
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(location.search);
    const date = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(params.get(key) || "") ? params.get(key) : "");
    const status = ["paid", "all", "voided"].includes(params.get("status")) ? params.get("status") : "paid";
    return { search: "", method: "all", status, from: date("from"), to: date("to") };
  });

  // Checked here so an impossible range never reaches the server or leaves
  // old rows on screen under the new dates.
  const rangeError = filters.from && filters.to && filters.from > filters.to ? RANGE_ERROR : "";

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
  const queryKey = useMemo(() => JSON.stringify({ ...query, page }), [query, page]);

  // Any filter change goes back to page 1.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const fetchDashboard = useCallback(async () => {
    try {
      const payload = await fetchJson("/billing/dashboard");
      setDashboard(payload?.data || null);
      setDashboardError("");
    } catch (err) {
      setDashboardError(describeLoadError(err, "Couldn't load the totals."));
    }
  }, []);

  // Only the latest request may update the table.
  const requestRef = useRef(0);
  const fetchTransactions = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (rangeError) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await fetchJson(`/billing${buildQuery({ ...query, page, limit: PAGE_SIZE })}`);
      if (requestId !== requestRef.current) return;
      setList({
        key: queryKey,
        rows: Array.isArray(payload?.data) ? payload.data : [],
        total: Number(payload.total) || 0,
        pages: Number(payload.pages) || 1,
        summary: payload.summary || null,
      });
      setListError("");
    } catch (err) {
      if (requestId === requestRef.current) setListError(describeLoadError(err, "Couldn't load the transactions."));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [page, query, queryKey, rangeError]);

  const fetchBilling = useCallback(
    () => Promise.all([fetchDashboard(), fetchTransactions()]),
    [fetchDashboard, fetchTransactions]
  );

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const showingCurrent = !rangeError && list.key === queryKey;
  const pageItems = useMemo(() => (showingCurrent ? list.rows.map(normalizeTransaction) : []), [list.rows, showingCurrent]);
  const total = showingCurrent ? list.total : 0;
  const filtered = showingCurrent ? list.summary : null;

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

  // A card shows a figure only once the totals have loaded; never ₱0.00 for
  // "couldn't load".
  const cardValue = (value) => {
    if (dashboard) return formatCurrency(value);
    return dashboardError ? "–" : "...";
  };

  // Nothing to show for the current filters vs. a refresh that failed while
  // the last good figures stay on screen.
  const loadIssue = (() => {
    const reason = listError || dashboardError;
    if (!reason || loading) return null;
    const nothingShown = (listError && !showingCurrent && !rangeError) || (dashboardError && !dashboard);
    return nothingShown
      ? { tone: "error", text: `Couldn't load the transactions. ${reason}` }
      : { tone: "warning", text: `Couldn't refresh, so what's shown may be out of date. ${reason}` };
  })();

  const filterDescription = [
    STATUS_LABELS[filters.status] || "Paid only",
    SOURCE_LABELS[filters.method] || "All sources",
    describeDates(filters.from, filters.to),
    searchQuery ? `Search "${searchQuery}"` : "",
  ].filter(Boolean).join(" · ");

  const exportSubtitle = filtered
    ? [
        filterDescription,
        `${total} transaction${total === 1 ? "" : "s"}`,
        filters.status === "voided" ? "" : `Paid total ${formatCurrency(filtered.paid_total)}`,
        filtered.voided_count > 0
          ? `Voided ${formatCurrency(filtered.voided_total)}${filters.status === "voided" ? "" : " (not in the paid total)"}`
          : "",
      ].filter(Boolean).join(" · ")
    : filterDescription;

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

  const openVoid = (transaction) => {
    setNotice("");
    setActionError("");
    setDetailsTarget(null);
    setVoidTarget(transaction);
  };

  // Voids the bill with the reason from the modal. The modal stays open (busy)
  // until the server answers, and the ref blocks clicks landing in the same
  // instant (before "busy" renders), so only one void request is ever sent.
  const voidInFlight = useRef(false);
  const voidBill = async (reason) => {
    const target = voidTarget;
    if (!target || voidInFlight.current) return;
    voidInFlight.current = true;
    setVoiding(true);
    setActionError("");
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
      // E.g. already voided in another tab: reload the list AND the totals
      // first, then show why it failed.
      await fetchBilling();
      setActionError(describeLoadError(err, "Failed to void the payment."));
    } finally {
      voidInFlight.current = false;
      setVoiding(false);
      setVoidTarget(null);
    }
  };

  const recordsLine = () => {
    if (rangeError || !showingCurrent) return loading ? "Loading..." : "—";
    return `${total} record${total === 1 ? "" : "s"}`;
  };

  let tableMessage = null;
  if (rangeError) tableMessage = "Fix the date range above to see transactions.";
  else if (loading) tableMessage = "Loading transactions...";
  else if (!showingCurrent && listError) tableMessage = "error";
  else if (pageItems.length === 0) tableMessage = "No billing transactions found.";

  return (
    <MainLayout pageTitle={pageTitle} pageSubtitle="Transaction history">
      <div className="admin-billing">
        <div className="billing-header">
          <div>
            <h2>Billing Transactions</h2>
            <p>Paid amounts by date and payment source.</p>
          </div>
          <div className="billing-header-actions">
            <ExportMenu
              filename="qelcare-billing"
              title="QELCare Billing Transactions"
              subtitle={exportSubtitle}
              sheetTitle="Billing"
              columns={EXPORT_COLUMNS}
              rows={pageItems}
              rowCount={total}
              loadRows={loadAllRows}
              disabled={loading || !showingCurrent}
            />
            <button type="button" className="refresh-button" onClick={fetchBilling} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {loadIssue && (
          <div className={loadIssue.tone === "error" ? "billing-alert billing-alert-row" : "billing-warning billing-alert-row"} role="alert">
            <span>{loadIssue.text}</span>
            <button type="button" className="secondary-button" onClick={fetchBilling}>
              Try Again
            </button>
          </div>
        )}
        {actionError && <div className="billing-alert" role="alert">{actionError}</div>}
        {notice && <div className="billing-notice" role="status">{notice}</div>}

        <div className="billing-summary-grid">
          <div className="billing-summary-card">
            <span>Total Paid</span>
            <strong>{cardValue(summary.totalPaid)}</strong>
            <small>All time</small>
          </div>
          <div className="billing-summary-card">
            <span>Today</span>
            <strong>{cardValue(summary.todayPaid)}</strong>
            <small>Clinic day (Manila)</small>
          </div>
          <div className="billing-summary-card">
            <span>This Month</span>
            <strong>{cardValue(summary.monthPaid)}</strong>
            <small>Current month</small>
          </div>
          <div className="billing-summary-card">
            <span>HMO Paid</span>
            <strong>{cardValue(summary.hmoPaid)}</strong>
            <small>All time</small>
          </div>
        </div>

        <div className="billing-filters">
          <label className="billing-filter" htmlFor="billing-search">
            <span>Search</span>
            <input
              id="billing-search"
              type="search"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="OR number or patient"
            />
          </label>
          <label className="billing-filter" htmlFor="billing-source">
            <span>Payment source</span>
            <select id="billing-source" value={filters.method} onChange={(event) => updateFilter("method", event.target.value)}>
              <option value="all">All sources</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              <option value="hmo">HMO</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="billing-filter" htmlFor="billing-status">
            <span>Status</span>
            <select id="billing-status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="paid">Paid only</option>
              <option value="all">All statuses</option>
              <option value="voided">Voided</option>
            </select>
          </label>
          <label className="billing-filter" htmlFor="billing-from">
            <span>Paid from</span>
            <input
              id="billing-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              aria-invalid={rangeError ? "true" : undefined}
              aria-describedby={rangeError ? "billing-range-error" : undefined}
              onChange={(event) => updateFilter("from", event.target.value)}
            />
          </label>
          <label className="billing-filter" htmlFor="billing-to">
            <span>Paid to</span>
            <input
              id="billing-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              aria-invalid={rangeError ? "true" : undefined}
              aria-describedby={rangeError ? "billing-range-error" : undefined}
              onChange={(event) => updateFilter("to", event.target.value)}
            />
          </label>
          <button type="button" className="secondary-button" onClick={clearFilters}>
            Clear
          </button>
          {rangeError && (
            <p id="billing-range-error" className="billing-filter-error" role="alert">
              {rangeError}
            </p>
          )}
        </div>

        <div className="billing-table-card">
          <div className="table-heading">
            <div>
              <h3>Transactions</h3>
              <p>{recordsLine()}</p>
            </div>
            {filtered && filters.status === "voided" && (
              <div className="table-totals" aria-live="polite">
                <span>Voided total for these filters</span>
                <strong>{formatCurrency(filtered.voided_total)}</strong>
              </div>
            )}
            {filtered && filters.status !== "voided" && (
              <div className="table-totals" aria-live="polite">
                <span>Paid total for these filters</span>
                <strong>{formatCurrency(filtered.paid_total)}</strong>
                {filtered.voided_count > 0 && (
                  <small>
                    Voided {formatCurrency(filtered.voided_total)} ({filtered.voided_count}) not included
                  </small>
                )}
              </div>
            )}
          </div>

          <div className="billing-table-wrap">
            <table className="billing-table qc-rtable">
              <thead>
                <tr>
                  <th>OR / Reference</th>
                  <th>Patient</th>
                  <th>Amount Paid</th>
                  <th>Payment Source</th>
                  <th>Method</th>
                  <th>Date Paid</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableMessage ? (
                  <tr>
                    <td colSpan="8" className="empty-cell">
                      {tableMessage === "error" ? (
                        <span className="empty-error">
                          Couldn't load transactions for these filters.
                          <button type="button" className="secondary-button" onClick={fetchBilling}>
                            Try Again
                          </button>
                        </span>
                      ) : (
                        tableMessage
                      )}
                    </td>
                  </tr>
                ) : (
                  pageItems.map((transaction) => (
                    <tr key={transaction.billing_id || transaction.id || transaction.reference}>
                      <td data-label="OR / Reference">
                        <strong>{transaction.reference}</strong>
                      </td>
                      <td data-label="Patient">{transaction.patient_name || "—"}</td>
                      <td data-label="Amount Paid">{formatCurrency(transaction.amount)}</td>
                      <td data-label="Payment Source">
                        <span className={`source-pill source-${transaction.paymentSource.toLowerCase()}`}>
                          {transaction.paymentSource}
                        </span>
                      </td>
                      <td data-label="Method">{getPaymentMethodLabel(transaction.paymentMethod)}</td>
                      <td data-label="Date Paid">{formatDateTime(transaction.paidAt)}</td>
                      <td data-label="Status">
                        <span className={`status-pill status-${transaction.status || "unknown"}`}>
                          {statusLabel(transaction.status)}
                        </span>
                      </td>
                      <td data-label="Actions" className="actions-col">
                        <span className="row-actions">
                          <button
                            type="button"
                            className="details-button"
                            aria-label={`Details for ${transaction.reference}`}
                            onClick={() => { setNotice(""); setDetailsTarget(transaction); }}
                          >
                            Details
                          </button>
                          {transaction.status === "paid" && (
                            <button
                              type="button"
                              className="void-button"
                              aria-label={`Void ${transaction.reference}`}
                              disabled={voiding}
                              onClick={() => openVoid(transaction)}
                            >
                              Void
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && showingCurrent && (
            <Pagination
              page={page}
              totalPages={list.pages}
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

        .billing-header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
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

        .billing-warning {
          border: 1px solid #f3d38b;
          background: #fff8e6;
          color: #8a5a00;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 14px;
        }

        .billing-alert-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
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

        .row-actions {
          display: inline-flex;
          gap: 8px;
          justify-content: flex-end;
        }

        .void-button,
        .details-button {
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

        .details-button {
          border-color: #cddbeb;
          color: #163a6b;
        }

        .void-button:hover:not(:disabled) {
          background: #fff4f4;
          border-color: #ad3131;
        }

        .details-button:hover {
          background: #f4f7fb;
          border-color: #163a6b;
        }

        .void-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
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
          display: block;
          color: #0f2744;
          font-size: 24px;
          line-height: 1.15;
          word-break: break-word;
        }

        .billing-summary-card small {
          display: block;
          margin-top: 6px;
          color: #5a6a7e;
          font-size: 12px;
        }

        .billing-filters {
          display: grid;
          grid-template-columns: minmax(220px, 1.5fr) repeat(4, minmax(130px, 1fr)) auto;
          gap: 10px;
          align-items: end;
          background: #ffffff;
          border: 1px solid #e4ecf5;
          border-radius: 8px;
          padding: 14px;
        }

        .billing-filter {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .billing-filter > span {
          color: #5a6a7e;
          font-size: 12px;
          font-weight: 700;
        }

        .billing-filters input,
        .billing-filters select {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #d8e2ee;
          border-radius: 8px;
          padding: 10px 12px;
          color: #0f2744;
          background: #ffffff;
          font-size: 14px;
          min-width: 0;
        }

        .billing-filters input[aria-invalid="true"] {
          border-color: #e6a4a0;
          background: #fdf6f6;
        }

        .billing-filter-error {
          grid-column: 1 / -1;
          margin: 0;
          color: #991b1b;
          font-size: 13px;
          font-weight: 700;
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
          gap: 16px;
          flex-wrap: wrap;
          padding: 18px;
          border-bottom: 1px solid #e4ecf5;
        }

        .table-totals {
          display: grid;
          justify-items: end;
          gap: 2px;
          text-align: right;
        }

        .table-totals span,
        .table-totals small {
          color: #5a6a7e;
          font-size: 12px;
          font-weight: 600;
        }

        .table-totals strong {
          color: #0f2744;
          font-size: 20px;
        }

        .billing-table-wrap {
          overflow-x: auto;
        }

        .billing-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 820px;
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

        .empty-error {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: center;
          color: #991b1b;
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

        /* When the table has to scroll sideways, keep Details / Void in view. */
        @media (min-width: 641px) {
          .billing-table th.actions-col,
          .billing-table td.actions-col {
            position: sticky;
            right: 0;
            z-index: 1;
            background: #ffffff;
            box-shadow: -1px 0 0 #eef3fb;
          }

          .billing-table th.actions-col {
            background: #f8fafd;
          }

          .billing-table tbody tr:hover td.actions-col {
            background: #f8fafd;
          }
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

          .table-totals {
            justify-items: start;
            text-align: left;
          }
        }
      `}</style>

      {detailsTarget && (
        <TransactionDetails
          billId={detailsTarget.id}
          reference={detailsTarget.reference}
          onClose={() => setDetailsTarget(null)}
          onVoid={(bill) => openVoid(normalizeTransaction(bill))}
        />
      )}

      {voidTarget && (
        <ReasonModal
          title="Void Payment"
          subtitle={`${voidTarget.reference}${voidTarget.patient_name ? ` · ${voidTarget.patient_name}` : ""} · ${formatCurrency(voidTarget.amount)}`}
          label="Void reason"
          placeholder="Why is this payment being voided? (e.g. wrong amount entered)"
          confirmText="Void Payment"
          busy={voiding}
          maxLength={MAX_VOID_REASON}
          onClose={() => setVoidTarget(null)}
          onConfirm={voidBill}
        />
      )}
    </MainLayout>
  );
}

export default AdminBilling;
