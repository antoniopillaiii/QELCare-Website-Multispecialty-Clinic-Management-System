// ============================================================
// FILE: src/utils/exportUtils.js
// ------------------------------------------------------------
// Shared, zero-dependency export helpers + <ExportMenu /> control.
//
// Every admin data table uses the same three downloads:
//   - PDF   : opens a branded print window and auto-triggers print
//   - Excel : emits a styled HTML <table> saved as .xls
//             (application/vnd.ms-excel) which Excel/LibreOffice
//             open natively as a real worksheet — no library needed
//   - CSV   : UTF-8 Blob download (BOM-prefixed so Excel keeps accents)
//
// Column contract (shared by all three exporters):
//   columns = [{ header: "Label", key: "field", value?: (row) => any }]
//   - `value(row)` is an optional formatter so the export matches
//     exactly what the screen shows (formatted dates, status labels…).
//   - If `value` is omitted we fall back to row[key].
// ============================================================

import React, { useEffect, useRef, useState } from "react";

// ── Internal formatting helpers ───────────────────────────────
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

function cellText(column, row) {
  const raw = typeof column.value === "function" ? column.value(row) : row?.[column.key];
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

function dateStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function withStamp(base, extension) {
  const clean = String(base || "qelcare-export").replace(/\.[a-z0-9]+$/i, "");
  return `${clean}-${dateStamp()}.${extension}`;
}

function downloadBlob(filename, content, type) {
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

function generatedLine() {
  return new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── CSV ───────────────────────────────────────────────────────
export function exportToCsv(filenameBase, columns, rows) {
  const lines = [];
  lines.push(columns.map((column) => csvCell(column.header)).join(","));
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvCell(cellText(column, row))).join(","));
  });
  // Prepend a UTF-8 BOM so Excel renders accented characters correctly.
  downloadBlob(withStamp(filenameBase, "csv"), `﻿${lines.join("\r\n")}`, "text/csv;charset=utf-8");
}

// ── Excel (.xls HTML table — no dependency) ───────────────────
export function exportToExcel(filenameBase, sheetTitle, columns, rows) {
  const safeSheet = escapeHtml(sheetTitle || "QELCare Export").slice(0, 31) || "Export";
  const head = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td style="mso-number-format:'\\@'">${escapeHtml(cellText(column, row))}</td>`).join("")}</tr>`
    )
    .join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${safeSheet}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  th { background: #163a6b; color: #ffffff; font-weight: bold; text-align: left; padding: 6px 10px; border: 1px solid #b9c6d6; }
  td { padding: 5px 10px; border: 1px solid #d8e2ee; color: #17212b; }
</style>
</head>
<body>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;

  downloadBlob(withStamp(filenameBase, "xls"), html, "application/vnd.ms-excel");
}

// ── PDF (print window) ────────────────────────────────────────
export function exportToPdf({ title, subtitle, columns, rows }) {
  const popup = window.open("", "_blank", "width=1100,height=800");
  if (!popup) {
    // Popup was blocked. Return false so the caller (ExportMenu) can surface an
    // in-app notice instead of a native window.alert.
    return false;
  }

  const head = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join("");
  const body =
    rows.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align:center;color:#66758a;padding:18px;">No records to export.</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr>${columns.map((column) => `<td>${escapeHtml(cellText(column, row))}</td>`).join("")}</tr>`
          )
          .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title || "QELCare Report")}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #17212b; margin: 28px; }
  .brand { color: #163a6b; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  h1 { color: #0f2744; margin: 4px 0 4px; font-size: 22px; }
  .sub { color: #66758a; font-size: 13px; margin: 0 0 4px; }
  .meta { color: #8a97a8; font-size: 12px; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d8e2ee; padding: 7px 9px; text-align: left; font-size: 11.5px; vertical-align: top; }
  th { background: #163a6b; color: #ffffff; }
  tbody tr:nth-child(even) td { background: #f4f7fb; }
  .count { margin: 14px 0 0; color: #66758a; font-size: 12px; }
  @media print { body { margin: 14mm; } .count { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="brand">QELCare</div>
  <h1>${escapeHtml(title || "QELCare Report")}</h1>
  ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}
  <p class="meta">Generated ${escapeHtml(generatedLine())} &middot; ${rows.length} record${rows.length === 1 ? "" : "s"}</p>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}

// ── <ExportMenu /> dropdown control ───────────────────────────
const menuColors = {
  navy: "#0f2744",
  blue: "#163a6b",
  border: "#e8eef6",
  muted: "#5a6a7e",
};

export function ExportMenu({
  filename = "qelcare-export",
  title = "QELCare Report",
  subtitle = "",
  sheetTitle,
  columns = [],
  rows = [],
  disabled = false,
  buttonLabel = "Download",
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const isEmpty = !rows || rows.length === 0;
  const blocked = disabled || isEmpty;

  const run = (action) => {
    setOpen(false);
    if (blocked) return;
    if (action === "pdf") {
      const started = exportToPdf({ title, subtitle, columns, rows });
      if (started === false) setNotice("Popup blocked. Please allow popups for this site, then try Download PDF again.");
    }
    if (action === "excel") exportToExcel(filename, sheetTitle || title, columns, rows);
    if (action === "csv") exportToCsv(filename, columns, rows);
  };

  const items = [
    { key: "pdf", label: "PDF document", hint: ".pdf (print)" },
    { key: "excel", label: "Excel worksheet", hint: ".xls" },
    { key: "csv", label: "CSV file", hint: ".csv" },
  ];

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => !blocked && setOpen((value) => !value)}
        disabled={blocked}
        title={isEmpty ? "No rows to export" : `Download ${rows.length} row${rows.length === 1 ? "" : "s"}`}
        style={{
          height: 38,
          padding: "0 14px",
          borderRadius: 10,
          border: `1px solid ${menuColors.border}`,
          background: "#fff",
          color: menuColors.blue,
          fontSize: 13,
          fontWeight: 800,
          cursor: blocked ? "not-allowed" : "pointer",
          opacity: blocked ? 0.6 : 1,
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          whiteSpace: "nowrap",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {buttonLabel}
        <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && !blocked && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 1200,
            minWidth: 196,
            background: "#fff",
            border: `1px solid ${menuColors.border}`,
            borderRadius: 12,
            boxShadow: "0 16px 40px rgba(15,23,42,.18)",
            padding: 6,
            overflow: "hidden",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => run(item.key)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: menuColors.navy,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
              onMouseEnter={(event) => (event.currentTarget.style.background = "#f4f7fb")}
              onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
            >
              <span>{item.label}</span>
              <span style={{ color: menuColors.muted, fontSize: 11, fontWeight: 700 }}>{item.hint}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          role="alert"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 1300,
            maxWidth: "min(440px, calc(100vw - 32px))",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#fff7df",
            color: "#9a6500",
            border: "1px solid #f0d58f",
            boxShadow: "0 12px 34px rgba(15,23,42,.18)",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          <span style={{ lineHeight: 1.45 }}>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss"
            style={{ border: "none", background: "transparent", color: "#9a6500", cursor: "pointer", fontSize: 17, lineHeight: 1, fontWeight: 900, padding: 0, flexShrink: 0 }}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
