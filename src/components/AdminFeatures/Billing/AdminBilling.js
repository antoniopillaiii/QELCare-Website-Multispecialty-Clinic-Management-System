import React, { useEffect, useMemo, useState } from "react";
import MainLayout from "../../Layout/MainLayout";
import Pagination, { usePagination } from "../../common/Pagination";
import { authFetch } from "../../../utils/auth";
import { ExportMenu } from "../../../utils/exportUtils";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
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

function sameDay(date, target) {
  return (
    date &&
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function sameMonth(date, target) {
  return date && date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
}

const EXPORT_COLUMNS = [
  { header: "OR / Reference", value: (txn) => txn.reference || "" },
  { header: "Amount Paid", value: (txn) => formatCurrency(txn.amount) },
  { header: "Payment Source", value: (txn) => txn.paymentSource || "" },
  { header: "Method", value: (txn) => getPaymentMethodLabel(txn.paymentMethod) },
  { header: "Date Paid", value: (txn) => formatPaidAt(txn.paidAt) },
  { header: "Status", value: (txn) => (txn.status || "unknown").replace(/\b\w/g, (char) => char.toUpperCase()) },
];

function AdminBilling() {
  const [transactions, setTransactions] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    method: "all",
    status: "paid",
    from: "",
    to: "",
  });

  const fetchBilling = async () => {
    try {
      setLoading(true);
      setError("");

      const [dashboardResponse, billingResponse] = await Promise.all([
        authFetch("/billing/dashboard"),
        authFetch("/billing?limit=200"),
      ]);

      if (!dashboardResponse.ok) {
        throw new Error("Unable to load billing summary.");
      }

      if (!billingResponse.ok) {
        throw new Error("Unable to load billing transactions.");
      }

      const dashboardData = await dashboardResponse.json();
      const billingData = await billingResponse.json();

      setDashboard(dashboardData?.data || dashboardData || null);
      setTransactions(Array.isArray(billingData?.data) ? billingData.data : []);
    } catch (err) {
      setError(err.message || "Unable to load billing records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBilling();
  }, []);

  const normalizedTransactions = useMemo(() => {
    return transactions
      .map((transaction) => {
        const paidAt = transaction.paid_at || transaction.created_at;
        const date = toDateValue(paidAt);
        return {
          ...transaction,
          reference:
            transaction.or_number ||
            transaction.receipt_number ||
            transaction.payment_reference ||
            `BILL-${transaction.billing_id || transaction.id || "N/A"}`,
          amount: toNumber(transaction.total_amount || transaction.amount_paid || transaction.amount),
          paidAt,
          paidDate: date,
          status: normalizeText(transaction.status || "paid"),
          paymentMethod: transaction.payment_method || transaction.method,
          paymentSource: getPaymentSource(transaction.payment_method || transaction.method),
        };
      })
      .sort((a, b) => {
        const left = a.paidDate ? a.paidDate.getTime() : 0;
        const right = b.paidDate ? b.paidDate.getTime() : 0;
        return right - left;
      });
  }, [transactions]);

  const visibleTransactions = useMemo(() => {
    const search = normalizeText(filters.search);
    const fromDate = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
    const toDate = filters.to ? new Date(`${filters.to}T23:59:59`) : null;

    return normalizedTransactions.filter((transaction) => {
      const matchesSearch =
        !search ||
        normalizeText(transaction.reference).includes(search) ||
        normalizeText(transaction.billing_id).includes(search) ||
        normalizeText(transaction.payment_reference).includes(search);

      const matchesMethod =
        filters.method === "all" || transaction.paymentSource.toLowerCase() === filters.method;

      const matchesStatus = filters.status === "all" || transaction.status === filters.status;

      const matchesFrom = !fromDate || (transaction.paidDate && transaction.paidDate >= fromDate);
      const matchesTo = !toDate || (transaction.paidDate && transaction.paidDate <= toDate);

      return matchesSearch && matchesMethod && matchesStatus && matchesFrom && matchesTo;
    });
  }, [filters, normalizedTransactions]);

  // Paginate the filtered rows; changing any filter returns to page 1.
  const { page, totalPages, pageItems, setPage, pageSize, totalItems } = usePagination(
    visibleTransactions,
    10,
    JSON.stringify(filters)
  );

  const summary = useMemo(() => {
    const today = new Date();
    const stats = dashboard?.stats || dashboard || {};
    const paidTransactions = normalizedTransactions.filter((transaction) => transaction.status === "paid");

    const totalPaid = paidTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const todayPaid = paidTransactions
      .filter((transaction) => sameDay(transaction.paidDate, today))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const monthPaid = paidTransactions
      .filter((transaction) => sameMonth(transaction.paidDate, today))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const hmoPaid = paidTransactions
      .filter((transaction) => transaction.paymentSource === "HMO")
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    return {
      totalPaid: stats.total_paid ?? stats.total_revenue ?? totalPaid,
      todayPaid: stats.today_paid ?? stats.today_revenue ?? todayPaid,
      monthPaid: stats.month_paid ?? stats.month_revenue ?? stats.monthly_revenue ?? monthPaid,
      hmoPaid,
      transactionCount: paidTransactions.length,
    };
  }, [dashboard, normalizedTransactions]);

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

  return (
    <MainLayout pageTitle="Billing" pageSubtitle="Transaction history">
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
              subtitle={`${visibleTransactions.length} transaction${visibleTransactions.length === 1 ? "" : "s"} matching the current filters`}
              sheetTitle="Billing"
              columns={EXPORT_COLUMNS}
              rows={visibleTransactions}
              disabled={loading}
            />
            <button type="button" className="refresh-button" onClick={fetchBilling} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && <div className="billing-alert">{error}</div>}

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
            placeholder="Search OR or reference"
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
            <option value="pending">Pending</option>
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
              <p>{visibleTransactions.length} record{visibleTransactions.length === 1 ? "" : "s"}</p>
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
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6" className="empty-cell">
                      Loading transactions...
                    </td>
                  </tr>
                ) : visibleTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-cell">
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
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
    </MainLayout>
  );
}

export default AdminBilling;
