/**
 * Searchable dropdown (WAI-ARIA combobox with a listbox popup), single or
 * multiple selection. Used for every tracker dropdown: Inbox drafts, the
 * Tracker/Dashboard filters, the Trend Test and signal revisions.
 *
 * - Type to filter (case- and accent-insensitive "contains" match).
 * - Keyboard: ↓/↑ move, Enter picks, Esc closes, Home/End jump; in multiple
 *   mode Enter toggles and Backspace on an empty search removes the last value.
 * - Focus never leaves the input (aria-activedescendant), and the list is
 *   rendered in a portal with fixed positioning, so scrolling tables, sticky
 *   filter bars and the record drawer never clip it.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ComboOption {
  value: string;
  label?: string;
}

interface Common {
  options: (string | ComboOption)[];
  /** Accessible name when the input is not wrapped in a <label>. */
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  style?: CSSProperties;
  onBlur?: () => void;
  /** Options always shown first and never filtered out while the search is empty (e.g. "All"). */
  pinned?: ComboOption[];
  testId?: string;
}

type Props = Common &
  ({ multiple?: false; value: string; onChange: (v: string) => void } | { multiple: true; value: string[]; onChange: (v: string[]) => void });

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text;
  const i = fold(text).indexOf(fold(q));
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function Combobox(props: Props) {
  const { options, label, placeholder, className = "control", disabled, invalid, describedBy, style, onBlur, pinned = [], testId } = props;
  const multiple = props.multiple === true;
  const selected: string[] = multiple ? (props.value as string[]) : props.value ? [props.value as string] : [];
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const all = useMemo(() => options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value })), [options]);
  const labelOf = (v: string) => [...pinned, ...all].find((o) => o.value === v)?.label ?? v;
  const q = query.trim();
  const shown = useMemo(() => {
    const matches = q ? all.filter((o) => fold(o.label).includes(fold(q))) : all;
    const pins = q ? pinned.filter((o) => fold(o.label ?? o.value).includes(fold(q))) : pinned;
    return [...pins.map((o) => ({ value: o.value, label: o.label ?? o.value, pinned: true })), ...matches.map((o) => ({ ...o, pinned: false }))];
  }, [all, pinned, q]);

  const display = multiple ? selected.map(labelOf).join(", ") : selected[0] != null ? labelOf(selected[0]) : "";

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const width = Math.max(r.width, 240);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    if (below < 220 && above > below) setPos({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(320, above) });
    else setPos({ left, width, top: r.bottom + 4, maxHeight: Math.max(120, Math.min(320, below)) });
  };

  const openList = (initialQuery = "") => {
    if (disabled) return;
    setQuery(initialQuery);
    const i = initialQuery ? 0 : Math.max(0, [...pinned.map((p) => p.value), ...all.map((o) => o.value)].indexOf(selected[0] ?? "\u0000"));
    setActive(i);
    place();
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useLayoutEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  useEffect(() => {
    if (active >= shown.length) setActive(Math.max(0, shown.length - 1));
  }, [shown.length, active]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (v: string) => {
    if (multiple) {
      const cur = props.value as string[];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      (props.onChange as (v: string[]) => void)(next);
      setQuery("");
    } else {
      (props.onChange as (v: string) => void)(v);
      close();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || (k === "Enter" && !e.nativeEvent.isComposing) || k === "F4") {
        e.preventDefault();
        openList();
      } else if (k === "Backspace" && multiple && selected.length) {
        (props.onChange as (v: string[]) => void)(selected.slice(0, -1));
      }
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (k === "Home" && !query) {
      e.preventDefault();
      setActive(0);
    } else if (k === "End" && !query) {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (k === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o.value);
    } else if (k === "Escape") {
      // Close only the list, not a surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (k === "Tab") {
      close();
    } else if (k === "Backspace" && multiple && !query && selected.length) {
      (props.onChange as (v: string[]) => void)(selected.slice(0, -1));
    }
  };

  const activeId = open && shown[active] ? `${id}-o${active}` : undefined;
  const emptyText = q ? `No matches for “${q}”` : "No options";

  return (
    <div className={`cbx ${open ? "open" : ""} ${disabled ? "disabled" : ""}`} style={style}>
      <input
        ref={inputRef}
        className={`${className} cbx-input`}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        title={display || undefined}
        value={open ? query : display}
        placeholder={open ? (display || "Type to search…") : placeholder}
        onChange={(e) => {
          if (!open) openList(e.target.value);
          else {
            setQuery(e.target.value);
            setActive(0);
          }
        }}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        onBlur={() => {
          close();
          onBlur?.();
        }}
        data-testid={testId}
      />
      <span className="cbx-chev" aria-hidden="true">
        ▾
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            className="cbx-pop"
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            // Keep focus in the input while scrolling or clicking inside the list.
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="cbx-list">
              {shown.map((o, i) => {
                const isSel = selected.includes(o.value);
                return (
                  <li
                    key={`${o.pinned ? "p" : "o"}:${o.value}`}
                    id={`${id}-o${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={isSel}
                    className={`cbx-opt ${i === active ? "active" : ""} ${isSel ? "sel" : ""} ${o.pinned ? "pinned" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o.value)}
                  >
                    <span className="cbx-check" aria-hidden="true">
                      {isSel ? "✓" : ""}
                    </span>
                    <span className="cbx-text">
                      <Highlight text={o.label} q={q} />
                    </span>
                  </li>
                );
              })}
            </ul>
            {!shown.length && (
              <div className="cbx-empty" role="status">
                {emptyText}
              </div>
            )}
            {multiple && selected.length > 0 && (
              <div className="cbx-foot">
                {selected.length} selected · click or Enter to add or remove · Esc to close
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
