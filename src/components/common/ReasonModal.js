import React, { useState } from "react";
import Modal from "./Modal";

// In-app replacement for window.prompt() when a short, required reason must be
// captured (appointment cancellation, medication decline, etc.). Renders a
// labelled textarea inside a Modal, blocks submission until a non-empty reason
// is entered, and hands the trimmed reason to onConfirm.
//
// The parent decides what happens next (close the modal and fire the request);
// pass `busy` while that request is in flight to disable the controls.
export default function ReasonModal({
  title = "Provide a reason",
  subtitle,
  label = "Reason",
  placeholder = "Type a short reason...",
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger", // "danger" | "primary"
  busy = false,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const accent = tone === "danger" ? "#ad3131" : "#163a6b";

  const submit = (event) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={busy ? undefined : onClose}
      headerColor={accent}
      width={480}
      closeOnOverlay={!busy}
    >
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 7, color: "#0f2744", fontSize: 13, fontWeight: 800 }}>
          {label}
          <textarea
            autoFocus
            rows={4}
            value={reason}
            placeholder={placeholder}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            style={{
              width: "100%",
              border: "1px solid #d7e2ef",
              borderRadius: 10,
              padding: 12,
              fontSize: 14,
              fontFamily: "inherit",
              color: "#162235",
              background: busy ? "#f4f6fa" : "#fff",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonStyle(false, busy, accent)}>
            {cancelText}
          </button>
          <button type="submit" disabled={busy || !trimmed} style={buttonStyle(true, busy || !trimmed, accent)}>
            {busy ? "Please wait..." : confirmText}
          </button>
        </div>
      </form>
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
