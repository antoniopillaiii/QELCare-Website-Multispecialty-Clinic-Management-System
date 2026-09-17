import React from "react";
import Modal from "./Modal";

// In-app replacement for window.confirm(): a yes/no confirmation dialog built
// on the shared Modal shell. No text input - just a message and two buttons.
// `message` renders with pre-line whitespace so "\n\n" in the text becomes
// paragraph breaks. Pass `busy` while the confirmed action is in flight.
export default function ConfirmModal({
  title = "Please confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger", // "danger" | "primary"
  busy = false,
  onConfirm,
  onClose,
}) {
  const accent = tone === "danger" ? "#ad3131" : "#163a6b";

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onClose}
      headerColor={accent}
      width={440}
      closeOnOverlay={!busy}
    >
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ color: "#33445c", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line" }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" autoFocus onClick={onClose} disabled={busy} style={buttonStyle(false, busy, accent)}>
            {cancelText}
          </button>
          <button type="button" onClick={() => !busy && onConfirm()} disabled={busy} style={buttonStyle(true, busy, accent)}>
            {busy ? "Please wait..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function buttonStyle(primary, disabled, accent) {
  return {
    height: 40,
    padding: "0 16px",
    borderRadius: 10,
    border: primary ? "none" : "1px solid #cddbeb",
    background: primary ? accent : "#fff",
    color: primary ? "#fff" : "#163a6b",
    fontSize: 13,
    fontWeight: 800,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
