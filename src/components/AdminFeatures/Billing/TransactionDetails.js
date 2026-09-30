import React, { useCallback, useEffect, useState } from "react";
import Modal from "../../common/Modal";
import { describeLoadError, fetchJson } from "../../../utils/paginatedFetch";
import {
  formatClock,
  formatCurrency,
  formatDateTime,
  formatDay,
  getDiscountLabel,
  getPaymentMethodLabel,
  statusLabel,
  toNumber,
} from "./billingFormat";

// Read-only view of one bill: visit, charges, payment and (for a voided bill)
// who voided it, when and why. A paid bill can be voided from here.
export default function TransactionDetails({ billId, reference, onClose, onVoid }) {
  const [bill, setBill] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchJson(`/billing/${billId}`);
      setBill(payload?.data || null);
    } catch (err) {
      setError(describeLoadError(err, "Couldn't load this transaction."));
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    load();
  }, [load]);

  const status = String(bill?.status || "").toLowerCase();
  const items = Array.isArray(bill?.line_items) ? bill.line_items : [];
  const discountAmount = toNumber(bill?.discount_amount);
  const visit = [formatDay(bill?.appointment_date), formatClock(bill?.appointment_time)].filter(Boolean).join(" · ");
  const doctor = [bill?.doctor_name, bill?.specialty_name].filter(Boolean).join(" · ");

  return (
    <Modal
      title={bill?.or_number || reference || "Transaction"}
      subtitle={bill ? `${bill.patient_name || "Unknown patient"} · ${statusLabel(bill.status)}` : "Transaction details"}
      onClose={onClose}
      width={620}
    >
      <div className="txd">
        {loading ? (
          <p className="txd-muted" role="status">Loading transaction...</p>
        ) : error ? (
          <div className="txd-error" role="alert">
            <span>{error}</span>
            <button type="button" className="txd-btn" onClick={load}>
              Try Again
            </button>
          </div>
        ) : bill ? (
          <>
            <section>
              <h4>Patient and visit</h4>
              <dl className="txd-grid">
                <dt>Patient</dt>
                <dd>{bill.patient_name || "—"}</dd>
                <dt>Visit</dt>
                <dd>{visit || "—"}</dd>
                <dt>Doctor</dt>
                <dd>{doctor || "—"}</dd>
              </dl>
            </section>

            <section>
              <h4>Charges</h4>
              <table className="txd-items">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">Qty</th>
                    <th scope="col" className="num">Unit price</th>
                    <th scope="col" className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="txd-muted">No line items recorded.</td>
                    </tr>
                  ) : (
                    items.map((item, index) => (
                      <tr key={index}>
                        <td>{item.description || "Clinic service"}</td>
                        <td className="num">{toNumber(item.quantity) || 1}</td>
                        <td className="num">{formatCurrency(item.unit_price)}</td>
                        <td className="num">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <dl className="txd-totals">
                <dt>Subtotal</dt>
                <dd>{formatCurrency(bill.subtotal)}</dd>
                {(discountAmount > 0 || (bill.discount_type && bill.discount_type !== "none")) && (
                  <>
                    <dt>
                      Discount ({getDiscountLabel(bill.discount_type)}, {toNumber(bill.discount_pct)}%)
                    </dt>
                    <dd>− {formatCurrency(discountAmount)}</dd>
                  </>
                )}
                <dt className="strong">Total</dt>
                <dd className="strong">{formatCurrency(bill.total_amount)}</dd>
              </dl>
            </section>

            <section>
              <h4>Payment</h4>
              <dl className="txd-grid">
                <dt>Method</dt>
                <dd>{getPaymentMethodLabel(bill.payment_method)}</dd>
                <dt>Amount tendered</dt>
                <dd>{formatCurrency(bill.amount_tendered)}</dd>
                <dt>Change</dt>
                <dd>{formatCurrency(bill.change_amount)}</dd>
                <dt>Paid</dt>
                <dd>{formatDateTime(bill.paid_at || bill.created_at)}</dd>
                <dt>Collected by</dt>
                <dd>{bill.cashier_name || "Not recorded"}</dd>
              </dl>
            </section>

            {status === "voided" && (
              <section className="txd-void">
                <h4>Voided</h4>
                <dl className="txd-grid">
                  <dt>Voided</dt>
                  <dd>{formatDateTime(bill.voided_at)}</dd>
                  <dt>Voided by</dt>
                  <dd>{bill.voided_by_name || "Not recorded"}</dd>
                  <dt>Reason</dt>
                  <dd className="txd-reason">{bill.void_reason || "Not recorded"}</dd>
                </dl>
              </section>
            )}

            {bill.payment_notes && (
              <section>
                <h4>Notes</h4>
                <p className="txd-reason">{bill.payment_notes}</p>
              </section>
            )}
          </>
        ) : null}

        <div className="txd-actions">
          {bill && status === "paid" && onVoid && (
            <button type="button" className="txd-btn danger" onClick={() => onVoid(bill)}>
              Void Payment
            </button>
          )}
          <button type="button" className="txd-btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>

      <style>{`
        .txd { display: grid; gap: 18px; color: #0f2744; font-size: 14px; }
        .txd section { display: grid; gap: 10px; }
        .txd h4 { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #5a6a7e; }
        .txd-grid { display: grid; grid-template-columns: minmax(120px, 38%) 1fr; gap: 8px 14px; margin: 0; }
        .txd-grid dt { color: #5a6a7e; font-weight: 700; }
        .txd-grid dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
        .txd-items { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4ecf5; border-radius: 8px; }
        .txd-items th, .txd-items td { padding: 8px 10px; border-bottom: 1px solid #eef3fb; text-align: left; }
        .txd-items th { font-size: 12px; color: #5a6a7e; background: #f8fafd; }
        .txd-items .num { text-align: right; white-space: nowrap; }
        .txd-totals { display: grid; grid-template-columns: 1fr auto; gap: 6px 14px; margin: 0; }
        .txd-totals dt { color: #5a6a7e; font-weight: 700; text-align: right; }
        .txd-totals dd { margin: 0; text-align: right; font-weight: 600; white-space: nowrap; }
        .txd-totals .strong { color: #0f2744; font-weight: 800; font-size: 15px; }
        .txd-void { border: 1px solid #f1c4c4; background: #fff6f6; border-radius: 10px; padding: 12px 14px; }
        .txd-reason { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .txd-muted { color: #5a6a7e; margin: 0; }
        .txd-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 12px 14px; }
        .txd-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
        .txd-btn { height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid #cddbeb; background: #fff; color: #163a6b; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
        .txd-btn.primary { background: #163a6b; border-color: #163a6b; color: #fff; }
        .txd-btn.danger { border-color: #f1b4b4; color: #ad3131; }
        .txd-btn.danger:hover { background: #fff4f4; border-color: #ad3131; }
        @media (max-width: 520px) {
          .txd-grid { grid-template-columns: 1fr; gap: 2px; }
          .txd-grid dd { margin-bottom: 8px; }
        }
      `}</style>
    </Modal>
  );
}
