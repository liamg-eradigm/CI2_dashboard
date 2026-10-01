import { useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { indent, newline, outdent, type TextState } from "../lib/listEditing";

/** Shown under long-text fields (and read out with them). */
export const LIST_HINT = "Bullets: Tab indents · Shift+Tab outdents · Enter adds the next bullet · Esc then Tab leaves the field";

/**
 * A textarea with Word-style bullet points written as Markdown ("- ", nested
 * by two spaces): Tab / Shift+Tab indent and outdent instead of moving to the
 * next field, and Enter continues the list. Press Esc first to Tab out of the
 * field (so the keyboard never gets stuck).
 */
export function ListTextarea({
  value,
  onValueChange,
  onKeyDown,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onValueChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const released = useRef(false);
  const apply = (next: TextState | null, e: KeyboardEvent) => {
    if (!next) return;
    e.preventDefault();
    onValueChange(next.value);
    // Put the caret back once React has rendered the new value.
    requestAnimationFrame(() => ref.current?.setSelectionRange(next.start, next.end));
  };
  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const el = e.currentTarget;
        const s: TextState = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
        if (e.key === "Escape") {
          // First Esc: let the next Tab leave the field (a second Esc closes a dialog as usual).
          if (!released.current) {
            released.current = true;
            e.preventDefault();
          }
          return;
        }
        if (e.key === "Tab") {
          if (released.current) {
            released.current = false;
            return; // Esc, then Tab: move on to the next field as usual.
          }
          apply(e.shiftKey ? outdent(s) : indent(s), e);
          return;
        }
        released.current = false;
        if (e.key === "Enter" && !e.shiftKey) apply(newline(s), e);
      }}
      onBlur={(e) => {
        released.current = false;
        rest.onBlur?.(e);
      }}
    />
  );
}
