import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { C, SHADOW } from "../../utils/adminTheme";

// ============================================================================
// Shared searchable dropdown for long lists of people (patients, doctors).
// Looks like the plain <select> it replaces, but opens a panel with a search
// box. The list is filtered in the browser from the options already loaded, so
// typing never sends a request.
//
//   options      [{ value, label, detail?, keywords? }]
//                `detail` is a small second line (an ID, a count) that tells
//                two entries with the same name apart; it is searchable too.
//   allLabel     optional first entry, e.g. "All Patients" (its value is
//                `allValue`, "all" by default). It always stays on top.
//
// Options are shown alphabetically by label whatever order they arrive in.
// Entries with the same label keep the order the caller passed them in.
// The panel is drawn on top of the page (not inside the caller's box), so a
// card or modal with `overflow: hidden` can't cut it off.
// ============================================================================

// Case, accents and extra spaces don't matter: " Peña  cruz" -> "pena cruz".
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Alphabetical order for display names.
export function compareLabels(a, b) {
  return collator.compare(normalizeText(a), normalizeText(b));
}

// A sorted COPY; the caller's array is left as it was.
export function sortOptions(options) {
  return [...(Array.isArray(options) ? options : [])].sort((a, b) => compareLabels(a.label, b.label));
}

// A very long list is cut here until the user types; searching still covers
// every option.
const MAX_VISIBLE = 300;
const PANEL_GAP = 6;
const SCREEN_MARGIN = 12;

const triggerStyle = {
  height: 40,
  width: "100%",
  minWidth: 0,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "0 12px",
  background: "#fff",
  color: C.navy,
  fontSize: 13,
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  textAlign: "left",
  cursor: "pointer",
};

export default function SearchSelect({
  value,
  onChange,
  options,
  allLabel,
  allValue = "all",
  placeholder = "Select",
  searchPlaceholder = "Search...",
  emptyText = "No matches found.",
  ariaLabel,
  disabled = false,
  style,
}) {
  const listId = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState(null);

  const sorted = useMemo(
    () => sortOptions(options).map((option) => ({
      ...option,
      value: String(option.value),
      haystack: normalizeText(`${option.label} ${option.detail || ""} ${option.keywords || ""}`),
    })),
    [options]
  );

  const allItem = useMemo(
    () => (allLabel ? { value: String(allValue), label: allLabel, haystack: normalizeText(allLabel), isAll: true } : null),
    [allLabel, allValue]
  );

  // Every word typed must appear somewhere in the entry ("gopela jer" finds
  // "Jerome Gopela").
  const words = useMemo(() => normalizeText(query).split(" ").filter(Boolean), [query]);
  const matches = useMemo(
    () => (words.length ? sorted.filter((option) => words.every((word) => option.haystack.includes(word))) : sorted),
    [sorted, words]
  );
  const showAll = allItem && (!words.length || words.every((word) => allItem.haystack.includes(word)));
  const items = useMemo(
    () => [...(showAll ? [allItem] : []), ...matches.slice(0, MAX_VISIBLE)],
    [allItem, matches, showAll]
  );

  const current = String(value ?? "");
  const selected = sorted.find((option) => option.value === current) || (allItem && current === allItem.value ? allItem : null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - SCREEN_MARGIN;
    const above = rect.top - SCREEN_MARGIN;
    const openUp = below < 240 && above > below;
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - SCREEN_MARGIN * 2);
    const left = Math.min(Math.max(rect.left, SCREEN_MARGIN), window.innerWidth - SCREEN_MARGIN - width);
    setPosition({
      left,
      width,
      maxHeight: Math.max(160, Math.min(380, openUp ? above : below) - PANEL_GAP),
      fontFamily: window.getComputedStyle(triggerRef.current).fontFamily,
      ...(openUp ? { bottom: window.innerHeight - rect.top + PANEL_GAP } : { top: rect.bottom + PANEL_GAP }),
    });
  }, []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    if (disabled) return;
    const selectedAt = [...(allItem ? [allItem] : []), ...sorted.slice(0, MAX_VISIBLE)].findIndex((item) => item.value === current);
    setQuery("");
    setActiveIndex(Math.max(selectedAt, 0));
    setOpen(true);
  };

  // Keep the panel attached to the field while the page scrolls or resizes,
  // and close it on a click anywhere else.
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onScroll = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      place();
    };
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [close, open, place]);

  useEffect(() => {
    if (open && position) searchRef.current?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, items.length]);

  const choose = (item) => {
    if (!item) return;
    if (item.value !== current) onChange(item.value);
    close(true);
  };

  const onSearchKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[activeIndex]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      // Handled here so a surrounding modal doesn't also close on Escape.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      close(true);
    }
  };

  const onTriggerKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPanel();
    }
  };

  const hidden = matches.length - Math.min(matches.length, MAX_VISIBLE);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        title={selected ? [selected.label, selected.detail].filter(Boolean).join(" - ") : undefined}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        style={{ ...triggerStyle, ...(disabled ? { opacity: 0.75, cursor: "not-allowed" } : null), ...style }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? C.navy : C.muted }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0 }} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            zIndex: 1100,
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: position.width,
            maxHeight: position.maxHeight,
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: SHADOW.pop,
            fontFamily: position.fontFamily,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, position: "relative", flexShrink: 0 }}>
            <Search size={15} color={C.muted} style={{ position: "absolute", left: 21, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={onSearchKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-label={searchPlaceholder}
              aria-expanded="true"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: "100%",
                height: 36,
                boxSizing: "border-box",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "0 10px 0 32px",
                background: C.soft,
                color: C.navy,
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>

          <div id={listId} role="listbox" aria-label={ariaLabel} style={{ overflowY: "auto", padding: "6px 0" }}>
            {items.map((item, index) => {
              const active = index === activeIndex;
              const isSelected = item.value === current;
              return (
                <div
                  key={item.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 14px",
                    cursor: "pointer",
                    background: active ? C.blueL : "transparent",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: item.isAll || isSelected ? 800 : 600, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </div>
                    {item.detail && (
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.detail}
                      </div>
                    )}
                  </div>
                  {isSelected && <Check size={15} color={C.blue} style={{ flexShrink: 0 }} aria-hidden="true" />}
                </div>
              );
            })}

            {items.length === 0 && (
              <div style={{ padding: "14px 16px", fontSize: 13, color: C.text }}>{emptyText}</div>
            )}
            {hidden > 0 && (
              <div style={{ padding: "8px 14px", fontSize: 11.5, color: C.muted, borderTop: `1px solid ${C.border}`, marginTop: 6 }}>
                Showing the first {MAX_VISIBLE} of {matches.length}. Type a name to narrow the list.
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
