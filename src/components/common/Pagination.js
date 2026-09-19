import React, { useEffect, useMemo, useState } from "react";
import { C } from "../../utils/adminTheme";

// ============================================================================
// Shared table pagination — follows the pattern already used by Patients,
// Manage Users and Activity Logs: a footer bar under the table with a
// "Showing X to Y of Z" summary on the left, and "Page X of Y" + Previous/Next
// on the right.
//
// The bar hides itself when everything fits on one page, so adding it to a
// short/live list (queue, nurse station) changes nothing visually.
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;

function buttonStyle(disabled) {
  return {
    height: 38,
    padding: "0 14px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: "#fff",
    color: C.blue,
    fontWeight: 800,
    fontSize: 13,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

// Client-side pagination for an already-loaded/filtered array.
//   `resetKey` — pass your filter/search signature so changing a filter jumps
//   back to page 1. Data refreshes alone must NOT change it, otherwise a
//   live-polling table would yank the user back to page 1 every refresh.
export function usePagination(items, pageSize = DEFAULT_PAGE_SIZE, resetKey) {
  // Memoised so a non-array/undefined `items` doesn't produce a fresh []
  // on every render and invalidate the slice below.
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  // Clamp rather than reset, so a shrinking list lands on the last page
  // instead of an empty one.
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => list.slice((safePage - 1) * pageSize, safePage * pageSize),
    [list, safePage, pageSize]
  );

  return { page: safePage, totalPages, pageItems, setPage, pageSize, totalItems: list.length };
}

// Render-prop wrapper for tables built inside a plain render helper (rather than
// their own component), where calling usePagination directly would break the
// Rules of Hooks. Give it the full row list and render the page it hands back:
//
//   <PaginatedRows rows={rows} resetKey={title} label="appointments">
//     {(pageRows) => <table>…{pageRows.map(…)}…</table>}
//   </PaginatedRows>
export function PaginatedRows({ rows, resetKey, label = "entries", pageSize = DEFAULT_PAGE_SIZE, children }) {
  const { page, totalPages, pageItems, setPage, totalItems } = usePagination(rows, pageSize, resetKey);
  return (
    <>
      {children(pageItems)}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={setPage}
        label={label}
      />
    </>
  );
}

export default function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  label = "entries",
}) {
  if (!totalPages || totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div
      style={{
        padding: 18,
        borderTop: `1px solid ${C.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ color: C.text, fontSize: 12, fontWeight: 800 }}>
        Showing {from} to {to} of {totalItems} {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.muted, fontSize: 12, fontWeight: 800 }}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          style={buttonStyle(page <= 1)}
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          style={buttonStyle(page >= totalPages)}
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
