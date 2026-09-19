import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/auth";
import MainLayout from "../Layout/MainLayout";
import { todayISO } from "../Workflow/ClinicUi";

function formatTime(str) {
  if (!str) return "-";
  const [hour, minute] = String(str).split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getRequestedServices(item) {
  return String(item?.requested_services || item?.lab_requests || "").trim();
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const AVATAR_POOL = [
  ["#163a6b", "#2f6fed"],
  ["#1f7a6f", "#2a9a8d"],
  ["#7a1827", "#b32042"],
  ["#5a3a8a", "#7b52b5"],
  ["#a56a00", "#d98b20"],
  ["#1a6b5a", "#2a9b82"],
];

function avatarGrad(id) {
  return AVATAR_POOL[(id || 0) % AVATAR_POOL.length];
}

function StatCard({ label, value, sub, accent, icon, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover && onClick ? "#f4f8ff" : "#fff",
        border: "1px solid #e4ecf5",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: hover && onClick ? "0 8px 28px rgba(22,58,107,.12)" : "0 2px 8px rgba(15,23,42,.05)",
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
        cursor: onClick ? "pointer" : "default",
        transition: ".15s ease",
        transform: hover && onClick ? "translateY(-2px)" : "none",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: `${accent}16`, display: "grid", placeItems: "center" }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#8a97a8", marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#0f2744", lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: "#7a8797", marginTop: 6 }}>{sub}</div>}
      </div>
    </button>
  );
}

export default function CashierDashboard() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [bills, setBills] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [apptRes, billingRes, dashboardRes] = await Promise.all([
        authFetch("/appointments?limit=100"),
        authFetch("/billing?limit=100"),
        authFetch("/billing/dashboard"),
      ]);

      const apptData = await apptRes.json();
      const billingData = await billingRes.json();
      const dashboardData = await dashboardRes.json();

      if (!apptRes.ok) throw new Error(apptData.error || apptData.message || "Failed to load appointments.");
      if (!billingRes.ok) throw new Error(billingData.error || billingData.message || "Failed to load billing.");
      if (!dashboardRes.ok) throw new Error(dashboardData.error || dashboardData.message || "Failed to load cashier dashboard.");

      setAppointments(apptData.appointments || []);
      setBills(billingData.data || []);
      setDashboard(dashboardData.data || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayISO();

  const paidAppointmentIds = useMemo(() => {
    return new Set(bills.filter((bill) => bill.status === "PAID").map((bill) => Number(bill.appointment_id)));
  }, [bills]);

  const readyForPayment = useMemo(() => {
    return appointments
      .filter((item) => item.status === "COMPLETED")
      .filter((item) => !paidAppointmentIds.has(Number(item.id)))
      .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
  }, [appointments, paidAppointmentIds]);

  const todayReadyForPayment = useMemo(() => {
    return readyForPayment.filter((item) => String(item.date || "").slice(0, 10) === today);
  }, [readyForPayment, today]);

  const todayAppointments = useMemo(() => {
    return appointments.filter((item) => String(item.date || "").slice(0, 10) === today);
  }, [appointments, today]);

  const recentPaid = dashboard?.recent || bills.filter((bill) => bill.status === "PAID").slice(0, 6);

  const now = new Date().toLocaleString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

  return (
    <MainLayout pageTitle="Cashier Dashboard" pageSubtitle={`Today is ${now}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard
          label="Today's Appointments"
          value={loading ? "..." : todayAppointments.length}
          sub="Scheduled today"
          accent="#163a6b"
          icon={<IconCalendar color="#163a6b" />}
        />
        <StatCard
          label="Pending Payment"
          value={loading ? "..." : readyForPayment.length}
          sub="Completed, unpaid visits"
          accent="#a56a00"
          icon={<IconClock color="#a56a00" />}
          onClick={() => navigate("/cashier/billing")}
        />
        <StatCard
          label="Today Revenue"
          value={loading ? "..." : formatMoney(dashboard?.stats?.today_revenue)}
          sub="Paid today"
          accent="#1f7a52"
          icon={<IconCheck color="#1f7a52" />}
          onClick={() => navigate("/cashier/billing")}
        />
        <StatCard
          label="Voided"
          value={loading ? "..." : dashboard?.stats?.voided_count || 0}
          sub="All voided transactions"
          accent="#b94949"
          icon={<IconX color="#b94949" />}
          onClick={() => navigate("/cashier/billing")}
        />
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fff0f0", border: "1px solid #fcc", borderRadius: 8, fontSize: 13, color: "#c0392b", fontWeight: 700 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <PanelLike
          title="Ready for Payment"
          subtitle="Completed consultations awaiting cashier"
          right={<button type="button" onClick={() => navigate("/cashier/billing")} style={smallButtonStyle}>Open Billing</button>}
        >
          {loading ? (
            <SpinnerBlock />
          ) : todayReadyForPayment.length === 0 ? (
            <EmptyPanel title="No pending payments today" detail="Completed doctor visits will appear here before payment." />
          ) : (
            todayReadyForPayment.map((item, index) => (
              <PatientRow
                key={item.id}
                item={item}
                border={index < todayReadyForPayment.length - 1}
                right={
                  <div style={{ display: "grid", gap: 5, justifyItems: "end" }}>
                    {getRequestedServices(item) && <span style={{ ...pillStyle, background: "#eef3fb", color: "#163a6b" }}>With request</span>}
                    <span style={pillStyle}>Unpaid</span>
                  </div>
                }
              />
            ))
          )}
        </PanelLike>

        <PanelLike
          title="Recent Paid Transactions"
          subtitle="Latest posted payments"
          right={<span style={{ ...pillStyle, color: "#163a6b", background: "#eef3fb" }}>{recentPaid.length} shown</span>}
        >
          {loading ? (
            <SpinnerBlock />
          ) : recentPaid.length === 0 ? (
            <EmptyPanel title="No paid transactions yet" detail="Payments will show here after processing." />
          ) : (
            recentPaid.map((bill, index) => (
              <PatientRow
                key={bill.id || bill.or_number}
                item={{
                  id: bill.id,
                  patient_id: bill.patient_id,
                  patient_name: bill.patient_name,
                  doctor_name: bill.or_number,
                  time: bill.appointment_time,
                }}
                border={index < recentPaid.length - 1}
                right={<strong style={{ fontSize: 12, color: "#0f2744" }}>{formatMoney(bill.total_amount)}</strong>}
              />
            ))
          )}
        </PanelLike>
      </div>

      <div style={{ marginTop: 18, background: "#fff", border: "1px solid #e4ecf5", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(15,23,42,.05)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f2744", marginRight: 4 }}>Quick Actions</div>
        <button type="button" onClick={() => navigate("/cashier/billing")} style={primaryButtonStyle}>Open Billing</button>
        <button type="button" onClick={load} style={secondaryButtonStyle}>Refresh</button>
      </div>
    </MainLayout>
  );
}

function PanelLike({ title, subtitle, right, children }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e4ecf5", borderRadius: 14, boxShadow: "0 4px 18px rgba(15,23,42,.06)", overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #eef3f9", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#0f2744" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#8a97a8", marginTop: 2 }}>{subtitle}</div>
        </div>
        {right}
      </div>
      <div style={{ maxHeight: 380, overflowY: "auto" }}>{children}</div>
    </section>
  );
}

function PatientRow({ item, right, border }) {
  const [g1, g2] = avatarGrad(item.patient_id || item.id);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderBottom: border ? "1px solid #f0f5fb" : "none" }}>
      <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg,${g1},${g2})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 12, border: "2px solid #fff", boxShadow: "0 2px 6px rgba(15,23,42,.1)" }}>
        {getInitials(item.patient_name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#0f2744", fontSize: 13 }}>{item.patient_name || "Patient"}</div>
        <div style={{ fontSize: 11, color: "#8a97a8", marginTop: 2 }}>
          {item.doctor_name || "Doctor"} {item.time ? `- ${formatTime(item.time)}` : ""}
        </div>
        {getRequestedServices(item) && (
          <div style={{ fontSize: 11, color: "#163a6b", marginTop: 4, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Request: {getRequestedServices(item)}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function EmptyPanel({ title, detail }) {
  return (
    <div style={{ padding: "38px 22px", textAlign: "center" }}>
      <div style={{ fontWeight: 900, color: "#0f2744", fontSize: 15 }}>{title}</div>
      <div style={{ color: "#8a97a8", fontSize: 13, marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function SpinnerBlock() {
  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <div style={{ display: "inline-block", width: 32, height: 32, borderRadius: "50%", border: "3px solid #eef3fb", borderTopColor: "#163a6b", animation: "spin .7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function IconCalendar({ color }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}

function IconClock({ color }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
}

function IconCheck({ color }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}

function IconX({ color }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}

const pillStyle = {
  padding: "3px 10px",
  borderRadius: 99,
  fontSize: 11,
  fontWeight: 800,
  background: "#fff7df",
  color: "#9a6500",
  flexShrink: 0,
};

const smallButtonStyle = {
  height: 34,
  padding: "0 14px",
  border: "1px solid #163a6b",
  borderRadius: 8,
  background: "#eef3fb",
  color: "#163a6b",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const primaryButtonStyle = {
  height: 40,
  padding: "0 18px",
  border: "none",
  borderRadius: 10,
  background: "#163a6b",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const secondaryButtonStyle = {
  height: 40,
  padding: "0 14px",
  border: "1px solid #dde6f0",
  borderRadius: 10,
  background: "#fff",
  color: "#66778a",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};
