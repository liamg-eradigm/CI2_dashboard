/**
 * Formatted text in the dashboard's long-text fields (request 46), kept as
 * plain text with light, Markdown-compatible markup so that exports,
 * searches and the AI writer still read it as text:
 *
 * - one line per paragraph; a blank line between paragraphs
 * - `### ` starts a title line
 * - `- ` (or `* `, `+ `, `1. `) starts a bullet, nested by two spaces a level
 * - `**bold**`, `<u>underline</u>` and
 *   `<span style="font-size:1.3em">larger</span>` inside a line
 *
 * Text without any of these is unchanged, so existing values need no
 * migration. Only these tags are recognised; anything else stays text.
 */

/** Font sizes a selection steps through (1 = the field's own size). */
export const FONT_SIZE_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;
const MIN_SIZE = 0.5;
const MAX_SIZE = 3;

export interface RichRun {
  text: string;
  bold?: boolean;
  underline?: boolean;
  /** Relative font size (em); absent = normal. */
  size?: number;
}

export type RichBlock =
  | { kind: "p"; runs: RichRun[] }
  | { kind: "title"; runs: RichRun[] }
  | { kind: "item"; depth: number; ordered: boolean; marker: string; runs: RichRun[] };

const TOKEN = /\*\*|<u>|<\/u>|<span style="font-size:\s*([\d.]+)em;?">|<\/span>/g;
const ITEM = /^([ \t]*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TITLE = /^###\s+(.*)$/;

const clampSize = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n * 100) / 100));

/** The runs of one line: its text with bold, underline and size. */
export function parseInline(line: string): RichRun[] {
  const runs: RichRun[] = [];
  let bold = false;
  const underline: boolean[] = [];
  const sizes: number[] = [];
  // "**" toggles bold only when it has a partner on the line (a lone "**" is text).
  const boldMarks = (line.match(/\*\*/g) ?? []).length;
  let boldSeen = 0;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const size = sizes[sizes.length - 1];
    const run: RichRun = { text, ...(bold ? { bold: true } : {}), ...(underline.length ? { underline: true } : {}), ...(size && size !== 1 ? { size } : {}) };
    const prev = runs[runs.length - 1];
    if (prev && !!prev.bold === !!run.bold && !!prev.underline === !!run.underline && prev.size === run.size) prev.text += text;
    else runs.push(run);
  };
  for (const m of line.matchAll(TOKEN)) {
    const t = m[0];
    let literal = false;
    if (t === "**") {
      boldSeen += 1;
      // The last of an odd number of "**" has no partner.
      if (boldMarks % 2 === 1 && boldSeen === boldMarks) literal = true;
    } else if (t === "</u>") literal = underline.length === 0;
    else if (t === "</span>") literal = sizes.length === 0;
    push(line.slice(last, m.index));
    last = m.index + t.length;
    if (literal) {
      push(t);
      continue;
    }
    if (t === "**") bold = !bold;
    else if (t === "<u>") underline.push(true);
    else if (t === "</u>") underline.pop();
    else if (t === "</span>") sizes.pop();
    else sizes.push(clampSize(Number(m[1]) || 1));
  }
  push(line.slice(last));
  return runs;
}

/** A line's runs as markup (size outside underline outside bold). */
export function serializeInline(runs: RichRun[]): string {
  return runs
    .map((r) => {
      let s = r.text;
      if (!s) return "";
      if (r.bold) {
        // Keep spaces outside the stars ("**bold** text", not "**bold **text").
        const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s) ?? ["", "", s, ""];
        s = core ? `${lead}**${core}**${trail}` : s;
      }
      if (r.underline) s = `<u>${s}</u>`;
      if (r.size && r.size !== 1) s = `<span style="font-size:${clampSize(r.size)}em">${s}</span>`;
      return s;
    })
    .join("");
}

/** Lines of formatted text as blocks: paragraphs (an empty one for a blank line), titles and bullets. */
export function parseRich(text: string): RichBlock[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line): RichBlock => {
      const t = TITLE.exec(line);
      if (t) return { kind: "title", runs: parseInline(t[1] ?? "") };
      const it = ITEM.exec(line);
      if (it) {
        const marker = it[2] ?? "-";
        return { kind: "item", depth: Math.floor((it[1] ?? "").replace(/\t/g, "  ").length / 2), ordered: /\d/.test(marker), marker, runs: parseInline(it[3] ?? "") };
      }
      return { kind: "p", runs: parseInline(line) };
    });
}

export function serializeRich(blocks: RichBlock[]): string {
  return blocks
    .map((b) => {
      const inline = serializeInline(b.runs);
      if (b.kind === "title") return `### ${inline}`;
      if (b.kind === "item") return `${"  ".repeat(b.depth)}${b.ordered ? b.marker : "-"} ${inline}`;
      return inline;
    })
    .join("\n");
}

/** The text without its formatting (bullets kept), for tables, searches, exports to plain text and the AI writer. */
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  if (!/\*\*|<u>|<\/u>|<span style="font-size|<\/span>|^###\s/m.test(text)) return text;
  return parseRich(text)
    .map((b) => {
      const inline = b.runs.map((r) => r.text).join("");
      if (b.kind === "item") return `${"  ".repeat(b.depth)}${b.ordered ? b.marker : "-"} ${inline}`;
      return inline;
    })
    .join("\n");
}

/** Whether the text has any formatting (bold, underline, size or a title line). */
export const isFormatted = (text: string | null | undefined): boolean => !!text && plainText(text) !== text;

/** The next font size up (+1) or down (-1) from `size` (1 = normal). */
export function stepFontSize(size: number | null | undefined, dir: 1 | -1): number {
  const cur = size ?? 1;
  if (dir > 0) return FONT_SIZE_STEPS.find((s) => s > cur + 0.001) ?? FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]!;
  return [...FONT_SIZE_STEPS].reverse().find((s) => s < cur - 0.001) ?? FONT_SIZE_STEPS[0]!;
}
