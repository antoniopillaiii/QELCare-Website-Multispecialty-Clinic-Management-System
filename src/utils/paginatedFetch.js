// ============================================================================
// Shared helpers for server-paginated list endpoints ({ data, total, page,
// pages }, max 100 rows per page). Screens fetch one page for the table and
// use fetchAllPages() only when they truly need the whole filtered dataset
// (exports, full work queues) - never a single oversized "limit" request that
// the API silently caps at 100.
// ============================================================================
import { authFetch } from "./auth";

// "?a=1&b=two", skipping empty / "all" values.
export function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === "all") return;
    if (Array.isArray(value) && value.length === 0) return;
    query.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function fetchJson(path) {
  const response = await authFetch(path);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Request failed.");
  }
  return payload;
}

// Every page of a list, in order, de-duplicated by `idKey` (a row inserted
// while paging would otherwise shift a row onto two pages).
export async function fetchAllPages(path, params = {}, { rowsKey = "data", idKey = "id", maxPages = 500 } = {}) {
  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchJson(`${path}${buildQuery({ ...params, page, limit: 100 })}`);
    const pageRows = Array.isArray(payload[rowsKey]) ? payload[rowsKey] : [];
    pageRows.forEach((row) => {
      const key = row?.[idKey];
      if (key !== undefined && key !== null) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      rows.push(row);
    });
    if (page >= (Number(payload.pages) || 1) || pageRows.length === 0) return rows;
  }
  throw new Error("Too many rows to load at once. Narrow the filters and try again.");
}
