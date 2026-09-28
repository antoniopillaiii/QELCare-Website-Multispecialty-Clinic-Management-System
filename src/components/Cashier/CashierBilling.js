import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../Layout/MainLayout";
import { authFetch } from "../../utils/auth";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Panel,
  StatusBadge,
  formatDate,
  formatTime,
  inputStyle,
  money,
} from "../Workflow/ClinicUi";
import { fetchAllPages } from "../../utils/paginatedFetch";

const DEFAULT_FEE = 800;

function getRequestedServices(item) {
  return String(item?.requested_services || item?.lab_requests || "").trim();
}

export default function CashierBilling() {
  const [appointments, setAppointments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [method, setMethod] = useState("cash");
  const [amountTendered, setAmountTendered] = useState(DEFAULT_FEE);
  const [discountPct, setDiscountPct] = useState(0);
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFee, setProcedureFee] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Every visit awaiting payment, however many there are. FOR_BILLING already
  // means "consultation done, not paid": paying flips it to COMPLETED in the
  // same transaction, and a void puts it back. (Previously this read the first
  // 100 appointments and the first 100 bills, so older visits could vanish.)
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAppointments(await fetchAllPages("/appointments", { status: "FOR_BILLING" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const payable = useMemo(() => {
    return appointments
      .filter((item) => item.status === "FOR_BILLING")
      .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
  }, [appointments]);

  const total = useMemo(() => {
    const subtotal = Number(fee || 0) + Number(procedureFee || 0);
    return Math.max(0, subtotal - subtotal * (Number(discountPct || 0) / 100));
  }, [discountPct, fee, procedureFee]);

  const canSubmit = Boolean(selected && !saving && Number(fee || 0) >= 0 && Number(amountTendered || 0) >= total);

  useEffect(() => {
    setAmountTendered((current) => {
      const currentAmount = Number(current || 0);
      return currentAmount < total ? total : current;
    });
  }, [total]);

  function selectAppointment(item) {
    const requestedServices = getRequestedServices(item);
    setSelected(item);
    setMessage("");
    setError("");
    setFee(DEFAULT_FEE);
    setDiscountPct(0);
    setProcedureDescription(requestedServices);
    setProcedureFee(0);
    setAmountTendered(DEFAULT_FEE);
    setNotes(requestedServices ? `Doctor requested services: ${requestedServices}` : "");
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!selected || saving) return;

    if (Number(amountTendered || 0) < total) {
      setError("Amount tendered must be equal to or greater than the total.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await authFetch("/billing", {
        method: "POST",
        body: JSON.stringify({
          appointment_id: selected.id,
          patient_id: selected.patient_id,
          line_items: [
            { description: "Consultation fee", amount: Number(fee || 0) },
            ...(Number(procedureFee || 0) > 0
              ? [{ description: procedureDescription || "Additional procedure / diagnostic service", amount: Number(procedureFee || 0) }]
              : []),
          ],
          discount_type: Number(discountPct || 0) > 0 ? "other" : "none",
          discount_pct: Number(discountPct || 0),
          payment_method: method,
          amount_tendered: Number(amountTendered || total),
          notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to process payment.");

      setMessage(`Payment complete for ${selected.patient_name}.`);
      setSelected(null);
      setFee(DEFAULT_FEE);
      setAmountTendered(DEFAULT_FEE);
      setDiscountPct(0);
      setProcedureDescription("");
      setProcedureFee(0);
      setNotes("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MainLayout pageTitle="Post-Consultation Billing" pageSubtitle="Collect payment after doctor consultation and add any required procedure fees">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />
        {message && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>{message}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px,.9fr)", gap: 14, alignItems: "start" }}>
          <Panel style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 900, color: "#162235" }}>Ready for Payment</div>
                <div style={{ color: "#6b778c", fontSize: 12 }}>Only completed consultations can be billed.</div>
              </div>
              <ActionButton tone="secondary" onClick={load}>Refresh</ActionButton>
            </div>

            {loading ? (
              <LoadingState label="Loading billing queue..." />
            ) : payable.length === 0 ? (
              <EmptyState title="No completed consultations to bill" detail="The doctor must complete the visit before cashier payment." />
            ) : (
              <div style={{ display: "grid" }}>
                {payable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectAppointment(item)}
                    style={{
                      border: "none",
                      borderTop: "1px solid #eef3f9",
                      background: selected?.id === item.id ? "#f2f7ff" : "#fff",
                      padding: 14,
                      cursor: "pointer",
                      textAlign: "left",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      fontFamily: "inherit",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900, color: "#162235" }}>{item.patient_name}</div>
                      <div style={{ color: "#6b778c", fontSize: 12 }}>
                        #{item.id} - {formatDate(item.date)} {formatTime(item.time)} - {item.specialty_name || "No specialty"}
                      </div>
                      {getRequestedServices(item) && (
                        <div style={{ marginTop: 6, color: "#163a6b", fontSize: 12, fontWeight: 800 }}>
                          Doctor request: {getRequestedServices(item)}
                        </div>
                      )}
                    </div>
                    <StatusBadge status={item.status} />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel style={{ padding: 16 }}>
            {!selected ? (
              <EmptyState title="Select a completed consultation" detail="Payment records the consultation fee and any procedure charges." />
            ) : (
              <form onSubmit={submitPayment} style={{ display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#162235" }}>{selected.patient_name}</div>
                  <div style={{ color: "#6b778c", fontSize: 13 }}>
                    Appointment #{selected.id} - {selected.doctor_name || "Doctor"}
                  </div>
                </div>

                {getRequestedServices(selected) && (
                  <div style={{ border: "1px solid #d9e8fb", background: "#f5f9ff", borderRadius: 8, padding: 12, display: "grid", gap: 4 }}>
                    <div style={{ color: "#163a6b", fontSize: 12, fontWeight: 900 }}>Doctor requested services</div>
                    <div style={{ color: "#26384d", fontSize: 13, lineHeight: 1.45 }}>{getRequestedServices(selected)}</div>
                    <div style={{ color: "#6b778c", fontSize: 12 }}>Confirm the actual clinic charge before collecting payment.</div>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Consultation fee">
                    <input style={inputStyle} type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </Field>
                  <Field label="Discount %">
                    <input style={inputStyle} type="number" min="0" max="100" step="0.01" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
                  </Field>
                  <Field label="Payment method">
                    <select style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="gcash">GCash</option>
                      <option value="maya">Maya</option>
                      <option value="card">Card</option>
                      <option value="philhealth">PhilHealth</option>
                      <option value="hmo">HMO</option>
                    </select>
                  </Field>
                  <Field label="Amount tendered">
                    <input style={inputStyle} type="number" min="0" step="0.01" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
                  <Field label="Procedure / diagnostic charge">
                    <input
                      style={inputStyle}
                      value={procedureDescription}
                      onChange={(e) => setProcedureDescription(e.target.value)}
                      placeholder="Optional, e.g. laboratory, procedure, supply"
                    />
                  </Field>
                  <Field label="Additional fee">
                    <input style={inputStyle} type="number" min="0" step="0.01" value={procedureFee} onChange={(e) => setProcedureFee(e.target.value)} />
                  </Field>
                </div>

                <Field label="Notes">
                  <textarea style={{ ...inputStyle, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>

                <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
                  <Row label="Consultation" value={money(fee)} />
                  <Row label="Additional services" value={money(procedureFee)} />
                  <Row label="Subtotal" value={money(Number(fee || 0) + Number(procedureFee || 0))} />
                  <Row label="Discount" value={`${discountPct || 0}%`} />
                  <Row label="Total" value={money(total)} strong />
                  <Row label="Change" value={money(Number(amountTendered || 0) - total)} />
                </div>

                <ActionButton type="submit" disabled={!canSubmit}>
                  {saving ? "Processing..." : "Process Payment"}
                </ActionButton>
              </form>
            )}
          </Panel>
        </div>
      </div>
    </MainLayout>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: strong ? 16 : 13, fontWeight: strong ? 900 : 700, color: strong ? "#162235" : "#42526a" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
