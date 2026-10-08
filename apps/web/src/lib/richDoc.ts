/**
 * Formatted text (request 46) to and from the editor's document: paragraphs,
 * titles (level-3 headings) and nested bullet / numbered lists, with bold,
 * underline and font-size marks. The stored value stays the plain-text
 * markup of `@eradigm/shared` richText.
 */
import type { JSONContent } from "@tiptap/react";
import { parseRich, serializeInline, type RichBlock, type RichRun } from "@eradigm/shared";

function runsToContent(runs: RichRun[]): JSONContent[] {
  return runs
    .filter((r) => r.text)
    .map((r) => {
      const marks: JSONContent["marks"] = [];
      if (r.bold) marks.push({ type: "bold" });
      if (r.underline) marks.push({ type: "underline" });
      if (r.size && r.size !== 1) marks.push({ type: "textStyle", attrs: { fontSize: `${r.size}em` } });
      return { type: "text", text: r.text, ...(marks.length ? { marks } : {}) };
    });
}

const para = (runs: RichRun[]): JSONContent => {
  const content = runsToContent(runs);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** The markup as the editor's document. */
export function toDoc(value: string): JSONContent {
  const out: JSONContent[] = [];
  // The open list at each depth of the bullets being read.
  let stack: JSONContent[] = [];
  for (const b of parseRich(value ?? "")) {
    if (b.kind !== "item") {
      stack = [];
      out.push(b.kind === "title" ? { type: "heading", attrs: { level: 3 }, content: runsToContent(b.runs) } : para(b.runs));
      continue;
    }
    const type = b.ordered ? "orderedList" : "bulletList";
    // A bullet cannot skip a level.
    const d = Math.min(b.depth, stack.length);
    stack = stack.slice(0, d + 1);
    if (stack[d] && stack[d]!.type !== type) stack = stack.slice(0, d);
    if (!stack[d]) {
      const start = b.ordered ? Number.parseInt(b.marker, 10) || 1 : 1;
      const list: JSONContent = { type, ...(b.ordered && start !== 1 ? { attrs: { start } } : {}), content: [] };
      if (d === 0) out.push(list);
      else {
        const parentItems = stack[d - 1]!.content!;
        parentItems[parentItems.length - 1]!.content!.push(list);
      }
      stack[d] = list;
    }
    stack[d]!.content!.push({ type: "listItem", content: [para(b.runs)] });
  }
  if (!out.length) out.push({ type: "paragraph" });
  return { type: "doc", content: out };
}

/** A paragraph's (or heading's) lines: its runs, split where it has hard line breaks. */
function lines(node: JSONContent): RichRun[][] {
  const out: RichRun[][] = [[]];
  for (const c of node.content ?? []) {
    if (c.type === "hardBreak") {
      out.push([]);
      continue;
    }
    if (c.type !== "text" || !c.text) continue;
    const marks = c.marks ?? [];
    const size = Number.parseFloat(String(marks.find((m) => m.type === "textStyle")?.attrs?.fontSize ?? ""));
    out[out.length - 1]!.push({
      text: c.text,
      ...(marks.some((m) => m.type === "bold") ? { bold: true } : {}),
      ...(marks.some((m) => m.type === "underline") ? { underline: true } : {}),
      ...(Number.isFinite(size) && size !== 1 ? { size } : {}),
    });
  }
  return out;
}

/** The editor's document as markup. */
export function fromDoc(doc: JSONContent): string {
  const blocks: RichBlock[] = [];
  const list = (node: JSONContent, depth: number) => {
    const ordered = node.type === "orderedList";
    let n = Number(node.attrs?.start ?? 1) || 1;
    for (const item of node.content ?? []) {
      let first = true;
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          list(child, depth + 1);
          continue;
        }
        for (const runs of lines(child)) {
          if (first) {
            blocks.push({ kind: "item", depth, ordered, marker: ordered ? `${n}.` : "-", runs });
            first = false;
          } else blocks.push({ kind: "p", runs });
        }
      }
      if (first) blocks.push({ kind: "item", depth, ordered, marker: ordered ? `${n}.` : "-", runs: [] });
      n += 1;
    }
  };
  for (const node of doc.content ?? []) {
    if (node.type === "bulletList" || node.type === "orderedList") list(node, 0);
    else if (node.type === "heading") lines(node).forEach((runs, i) => blocks.push(i === 0 ? { kind: "title", runs } : { kind: "p", runs }));
    else lines(node).forEach((runs) => blocks.push({ kind: "p", runs }));
  }
  return blocks
    .map((b) => {
      const inline = serializeInline(b.runs);
      if (b.kind === "title") return `### ${inline}`;
      if (b.kind === "item") return `${"  ".repeat(b.depth)}${b.marker} ${inline}`;
      return inline;
    })
    .join("\n");
}
