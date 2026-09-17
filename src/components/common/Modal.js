import React, { useEffect } from "react";

// Reusable in-app modal shell used across the app (admin, frontdesk, patient,
// doctor). Renders a fixed overlay with a centered card: a coloured header
// (title + optional subtitle + close button) and a scrollable body slot.
// Theme-agnostic and self-styled so it can be dropped into any screen without
// pulling in a specific design system. Closes on Escape and on overlay click,
// and locks background scroll while open.
//
// The consumer is expected to render its own <form> (with submit/cancel
// buttons) inside `children`, so keyboard submit and button clicks work
// naturally without an extra footer contract.
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  headerColor = "#163a6b",
  width = 460,
  closeOnOverlay = true,
}) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(10,20,35,.58)",
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
    >
      <div
        style={{
          width: `min(${width}px, 100%)`,
          maxHeight: "90vh",
          overflow: "hidden",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 70px rgba(15,23,42,.28)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            background: headerColor,
            color: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 12, opacity: 0.82, marginTop: 3, wordBreak: "break-word" }}>{subtitle}</div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                border: "none",
                borderRadius: 8,
                background: "rgba(255,255,255,.14)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          )}
        </div>

        <div style={{ padding: 20, background: "#fafbfd", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}
