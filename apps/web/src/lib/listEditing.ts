/**
 * Word-style bullet lists in plain-text fields, written as Markdown:
 *
 * - Tab on a bullet indents it one level ("  - "); on a plain line it makes
 *   the line a bullet. Shift+Tab does the reverse (outdent, then plain text).
 *   With several lines selected, every line moves.
 * - Enter on a bullet starts the next bullet at the same level (numbered
 *   lists count on); Enter on an empty bullet outdents it, or ends the list.
 *
 * Pure functions over (value, selection), so they are easy to test.
 */
export interface TextState {
  value: string;
  start: number;
  end: number;
}

export const INDENT = "  ";
const MAX_DEPTH = 8;
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)(.*)$/;

interface Item {
  indent: string;
  marker: string;
  gap: string;
  text: string;
}
const parse = (line: string): Item | null => {
  const m = ITEM.exec(line);
  return m ? { indent: m[1] ?? "", marker: m[2] ?? "-", gap: m[3] ?? " ", text: m[4] ?? "" } : null;
};
const nextMarker = (marker: string) => {
  const n = /^(\d+)([.)])$/.exec(marker);
  return n ? `${Number(n[1]) + 1}${n[2]}` : marker;
};

/** The lines the selection touches: [first line start, last line end). */
function lineSpan(value: string, start: number, end: number): [number, number] {
  const a = value.lastIndexOf("\n", start - 1) + 1;
  const e = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const b = value.indexOf("\n", e);
  return [a, b < 0 ? value.length : b];
}

/** Apply `fn` to each selected line, keeping the selection on the same text. */
function eachLine(s: TextState, fn: (line: string) => string): TextState {
  const [a, b] = lineSpan(s.value, s.start, s.end);
  const lines = s.value.slice(a, b).split("\n");
  const out = lines.map(fn);
  const value = s.value.slice(0, a) + out.join("\n") + s.value.slice(b);
  // Shift the caret / selection by the change on its own line.
  const firstDelta = (out[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  const total = value.length - s.value.length;
  if (s.start === s.end) {
    const pos = Math.max(a, s.start + firstDelta);
    return { value, start: pos, end: pos };
  }
  return { value, start: Math.max(a, s.start + firstDelta), end: Math.max(a, s.end + total) };
}

export function indent(s: TextState): TextState {
  return eachLine(s, (line) => {
    const it = parse(line);
    if (!it) return line.trim() ? `- ${line.trimStart()}` : "- ";
    if (it.indent.length / INDENT.length >= MAX_DEPTH) return line;
    return INDENT + line;
  });
}

export function outdent(s: TextState): TextState {
  return eachLine(s, (line) => {
    const it = parse(line);
    if (it) return it.indent.length ? line.slice(Math.min(INDENT.length, it.indent.length)) : it.text;
    return line.replace(/^ {1,2}/, "");
  });
}

/** Enter: continue (or end) the list; null when Enter should behave normally. */
export function newline(s: TextState): TextState | null {
  if (s.start !== s.end) return null;
  const [a] = lineSpan(s.value, s.start, s.start);
  const b = s.value.indexOf("\n", s.start);
  const line = s.value.slice(a, b < 0 ? s.value.length : b);
  const it = parse(line);
  if (!it) return null;
  // Caret inside the marker itself: behave normally.
  if (s.start - a < it.indent.length + it.marker.length + it.gap.length) return null;
  if (!it.text.trim()) {
    // An empty bullet: outdent it, or end the list (like Word).
    const replaced = it.indent.length ? it.indent.slice(INDENT.length) + it.marker + it.gap : "";
    const value = s.value.slice(0, a) + replaced + s.value.slice(a + line.length);
    const pos = a + replaced.length;
    return { value, start: pos, end: pos };
  }
  const insert = `\n${it.indent}${nextMarker(it.marker)} `;
  const value = s.value.slice(0, s.start) + insert + s.value.slice(s.end);
  const pos = s.start + insert.length;
  return { value, start: pos, end: pos };
}
