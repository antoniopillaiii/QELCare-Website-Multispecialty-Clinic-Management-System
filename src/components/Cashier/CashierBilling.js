import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Pagination, { usePagination } from "../common/Pagination";
import { describeLoadError, fetchAllPages } from "../../utils/paginatedFetch";

const DEFAULT_FEE = 800;
const PAGE_SIZE = 10;
const AUTO_REFRESH_MS = 60000;

const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["gcash", "GCash"],
  ["maya", "Maya"],
  ["card", "Card"],
  ["bank_transfer", "Bank transfer"],
  ["philhealth", "PhilHealth"],
  ["hmo", "HMO"],
  ["other", "Other"],
];

function getRequestedServices(item) {
  return String(item?.requested_services || item?.lab_requests || "").trim();
}

// Same rounding as the billing API, so the total shown is the total charged.
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// A plain non-negative decimal ("800", "800.50"); anything else is NaN.
function parseAmount(text) {
  const value = String(text ?? "").trim();
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
}

function matchesSearch(item, query) {
  if (!query) return true;
  const q = query.toLowerCase().replace(/^#/, "");
  return [item.patient_name, item.doctor_name, item.specialty_name, String(item.id)]
    .some((value) => String(value || "").toLowerCase().includes(q));
}

export default function CashierBilling() {
  const [appointments, setAppointments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [fee, setFee] = useState(String(DEFAULT_FEE));
  const [method, setMethod] = useState("cash");
  // null = follow the total (exact payment) until the cashier types an amount.
  const [tenderedInput, setTenderedInput] = useState(null);
  const [discountPct, setDiscountPct] = useState("0");
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFee, setProcedureFee] = useState("0");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("oldest");

  // Synchronous guard: two submits in the same instant send one request.
  const inFlight = useRef(false);
  const selectedRef = useRef(null);
  const formRef = useRef(null);
  selectedRef.current = selected;

  // Every visit awaiting payment, however many there are. FOR_BILLING already
  // means "consultation done, not paid": paying flips it to COMPLETED in the
  // same transaction, and a void puts it back. Returns the rows, or null when
  // the request failed (a failed refresh keeps the rows already on screen).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const rows = await fetchAllPages("/appointments", { status: "FOR_BILLING" });
      setAppointments(rows);
      setLoaded(true);
      setLoadError("");
      return rows;
    } catch (err) {
      setLoadError(describeLoadError(err, "Couldn't load the visits awaiting payment."));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // If the open visit is no longer awaiting payment (paid at another counter,
  // for example), close the form instead of leaving a stale one to retry.
  const dropSelectionIfGone = useCallback((rows) => {
    const current = selectedRef.current;
    if (!rows || !current) return false;
    if (rows.some((row) => row.id === current.id && row.status === "FOR_BILLING")) return false;
    setSelected(null);
    return true;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // New visits reach For Billing while the cashier works: refresh quietly.
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (inFlight.current) return;
      const rows = await load({ silent: true });
      const current = selectedRef.current;
      if (dropSelectionIfGone(rows) && current) {
        setNotice(`${current.patient_name || `Visit #${current.id}`} is no longer awaiting payment (it may have been paid at another counter).`);
      }
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [dropSelectionIfGone, load]);

  // On a phone the form sits under the list: bring it into view.
  useEffect(() => {
    if (!selected || !formRef.current) return;
    const rect = formRef.current.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight - 120) {
      formRef.current.scrollIntoView({ block: "start" });
    }
  }, [selected]);

  const payable = useMemo(() => {
    const query = search.trim();
    const rows = appointments
      .filter((item) => item.status === "FOR_BILLING" && matchesSearch(item, query))
      .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
    return sortOrder === "newest" ? rows.reverse() : rows;
  }, [appointments, search, sortOrder]);

  const { page, totalPages, pageItems, setPage, totalItems } = usePagination(payable, PAGE_SIZE, `${search}|${sortOrder}`);
  const unpaidCount = appointments.filter((item) => item.status === "FOR_BILLING").length;

  // Amounts, validated the way the billing API validates them, so what the
  // cashier sees is exactly what will be charged.
  const calc = useMemo(() => {
    const errors = [];
    const feeValue = String(fee).trim() === "" ? NaN : parseAmount(fee);
    const extraValue = String(procedureFee).trim() === "" ? 0 : parseAmount(procedureFee);
    const pctValue = String(discountPct).trim() === "" ? 0 : parseAmount(discountPct);
    if (!Number.isFinite(feeValue)) errors.push("Consultation fee must be a number of 0 or more.");
    if (!Number.isFinite(extraValue)) errors.push("Additional fee must be a number of 0 or more.");
    if (!Number.isFinite(pctValue) || pctValue > 100) errors.push("Discount must be between 0 and 100%.");
    const amountsValid = errors.length === 0;

    const subtotal = amountsValid ? round2(feeValue + extraValue) : NaN;
    if (amountsValid && subtotal <= 0) errors.push("Enter a consultation fee or an additional charge.");
    const pct = amountsValid ? round2(pctValue) : 0;
    const discountAmount = amountsValid ? round2(subtotal * (pct / 100)) : NaN;
    const total = amountsValid ? round2(subtotal - discountAmount) : NaN;

    const tendered = tenderedInput === null ? total : parseAmount(tenderedInput);
    if (tenderedInput !== null && !Number.isFinite(tendered)) {
      errors.push("Amount tendered must be a number.");
    } else if (amountsValid && Number.isFinite(tendered) && tendered < total) {
      errors.push("Amount tendered is less than the total.");
    }
    const change = Number.isFinite(tendered) && Number.isFinite(total) ? round2(tendered - total) : NaN;

    return { errors, feeValue, extraValue, pct, subtotal, discountAmount, total, tendered, change };
  }, [discountPct, fee, procedureFee, tenderedInput]);

  const canSubmit = Boolean(selected && !saving && calc.errors.length === 0);

  function resetForm(item = null) {
    const requestedServices = getRequestedServices(item);
    setFee(String(DEFAULT_FEE));
    setDiscountPct("0");
    setProcedureDescription(requestedServices);
    setProcedureFee("0");
    setTenderedInput(null);
    setMethod("cash");
    setNotes(requestedServices ? `Doctor requested services: ${requestedServices}` : "");
  }

  function selectAppointment(item) {
    setSelected(item);
    setMessage("");
    setError("");
    setNotice("");
    resetForm(item);
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!selected || inFlight.current || calc.errors.length) return;
    inFlight.current = true;
    const visit = selected;

    setSaving(true);
    setError("");
    setMessage("");
    setNotice("");
    try {
      const response = await authFetch("/billing", {
        method: "POST",
        body: JSON.stringify({
          appointment_id: visit.id,
          patient_id: visit.patient_id,
          line_items: [
            { description: "Consultation fee", amount: calc.feeValue },
            ...(calc.extraValue > 0
              ? [{ description: procedureDescription.trim() || "Additional procedure / diagnostic service", amount: calc.extraValue }]
              : []),
          ],
          discount_type: calc.pct > 0 ? "other" : "none",
          discount_pct: calc.pct,
          payment_method: method,
          amount_tendered: calc.tendered,
          notes,
        }),
      });
      if (!response) return;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        const failure = new Error(payload.message || "Failed to process payment.");
        failure.status = response.status;
        throw failure;
      }

      const bill = payload.billing || payload.data?.billing || {};
      setMessage(
        `Payment recorded for ${visit.patient_name || `visit #${visit.id}`}: OR ${bill.or_number || "—"} · Total ${money(bill.total_amount)} · Tendered ${money(bill.amount_tendered)} · Change ${money(bill.change_amount)}.`
      );
      setSelected(null);
      resetForm();
      await load({ silent: true });
    } catch (err) {
      setError(describeLoadError(err, "Failed to process payment."));
      // The server refused this visit (e.g. already paid elsewhere): refresh,
      // and close the form if it's no longer awaiting payment.
      if (err.status) {
        const rows = await load({ silent: true });
        if (dropSelectionIfGone(rows)) {
          setError(`${err.message} The list has been refreshed.`);
        }
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const firstLoadFailed = !loaded && loadError && !loading;

  return (
    <MainLayout pageTitle="Post-Consultation Billing" pageSubtitle="Collect payment after doctor consultation and add any required procedure fees">
      <div style={{ display: "grid", gap: 14 }}>
        <ErrorState message={error} />
        {message && (
          <div role="status" style={{ padding: "10px 12px", borderRadius: 8, background: "#edf8f1", color: "#0f6b3c", fontSize: 13, fontWeight: 800 }}>
            {message}
          </div>
        )}
        {notice && (
          <div role="status" style={{ padding: "10px 12px", borderRadius: 8, background: "#fff7df", color: "#8a5a00", fontSize: 13, fontWeight: 800 }}>
            {notice}
          </div>
        )}
        {loaded && loadError && (
          <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "#fff7df", color: "#8a5a00", fontSize: 13, fontWeight: 800 }}>
            Couldn't refresh the list, so it may be out of date. {loadError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px,.9fr)", gap: 14, alignItems: "start" }}>
          <Panel style={{ overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e8eef6", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 900, color: "#162235" }}>Ready for Payment</div>
                  <div style={{ color: "#6b778c", fontSize: 12 }}>
                    {loaded ? `${unpaidCount} completed consultation${unpaidCount === 1 ? "" : "s"} awaiting payment.` : "Only completed consultations can be billed."}
                  </div>
                </div>
                <ActionButton tone="secondary" onClick={() => load()} disabled={loading}>
                  {loading ? "Refreshing..." : "Refresh"}
                </ActionButton>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="search"
                  aria-label="Search visits awaiting payment"
                  placeholder="Search patient, doctor or visit #"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inputStyle, flex: "1 1 200px" }}
                />
                <select aria-label="Sort visits" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }}>
                  <option value="oldest">Oldest visit first</option>
                  <option value="newest">Newest visit first</option>
                </select>
              </div>
            </div>

            {loading && !loaded ? (
              <LoadingState label="Loading billing queue..." />
            ) : firstLoadFailed ? (
              <div style={{ padding: 28, textAlign: "center" }} role="alert">
                <div style={{ fontWeight: 900, color: "#ad3131", marginBottom: 4 }}>Couldn't load the visits awaiting payment</div>
                <div style={{ fontSize: 13, color: "#6b778c", marginBottom: 12 }}>{loadError}</div>
                <ActionButton tone="secondary" onClick={() => load()}>Try Again</ActionButton>
              </div>
            ) : payable.length === 0 ? (
              search.trim() ? (
                <EmptyState title="No visits match your search" detail="Try a patient name, doctor or visit number." />
              ) : (
                <EmptyState title="No completed consultations to bill" detail="The doctor must complete the visit before cashier payment." />
              )
            ) : (
              <>
                <div style={{ display: "grid" }}>
                  {pageItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected?.id === item.id}
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
                <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={PAGE_SIZE} onPageChange={setPage} label="visits" />
              </>
            )}
          </Panel>

          <Panel style={{ padding: 16 }}>
            {!selected ? (
              <EmptyState title="Select a completed consultation" detail="Payment records the consultation fee and any procedure charges." />
            ) : (
              <form ref={formRef} onSubmit={submitPayment} noValidate style={{ display: "grid", gap: 12, scrollMarginTop: 80 }}>
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
                    <input style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </Field>
                  <Field label="Discount %">
                    <input style={inputStyle} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
                  </Field>
                  <Field label="Payment method">
                    <select style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                      {PAYMENT_METHODS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Amount tendered">
                    <input
                      style={inputStyle}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={tenderedInput === null ? (Number.isFinite(calc.total) ? String(calc.total) : "") : tenderedInput}
                      onChange={(e) => setTenderedInput(e.target.value)}
                    />
                  </Field>
                </div>
                {tenderedInput !== null && (
                  <button
                    type="button"
                    onClick={() => setTenderedInput(null)}
                    style={{ justifySelf: "end", marginTop: -6, border: "none", background: "none", color: "#163a6b", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                  >
                    Use exact amount
                  </button>
                )}

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
                    <input style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={procedureFee} onChange={(e) => setProcedureFee(e.target.value)} />
                  </Field>
                </div>

                <Field label="Notes">
                  <textarea style={{ ...inputStyle, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>

                <div style={{ border: "1px solid #e3ebf5", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
                  <Row label="Consultation" value={Number.isFinite(calc.feeValue) ? money(calc.feeValue) : "—"} />
                  <Row label="Additional services" value={Number.isFinite(calc.extraValue) ? money(calc.extraValue) : "—"} />
                  <Row label="Subtotal" value={Number.isFinite(calc.subtotal) ? money(calc.subtotal) : "—"} />
                  <Row label={`Discount (${calc.pct}%)`} value={Number.isFinite(calc.discountAmount) ? `- ${money(calc.discountAmount)}` : "—"} />
                  <Row label="Total" value={Number.isFinite(calc.total) ? money(calc.total) : "—"} strong />
                  <Row label="Amount tendered" value={Number.isFinite(calc.tendered) ? money(calc.tendered) : "—"} />
                  <Row label="Change" value={Number.isFinite(calc.change) && calc.change >= 0 ? money(calc.change) : "—"} />
                </div>

                {calc.errors.length > 0 && (
                  <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "#fff0f0", color: "#ad3131", fontSize: 13, fontWeight: 800, display: "grid", gap: 4 }}>
                    {calc.errors.map((text) => <div key={text}>{text}</div>)}
                  </div>
                )}

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
