import type { ReactNode } from "react";
import { parseRich, type RichBlock, type RichRun } from "@eradigm/shared";

/**
 * Formatted text as written in a `RichTextField` (requests 44 and 46): each
 * line break is kept, a blank line starts a new paragraph, `### ` lines are
 * titles, "- " / "1. " lines are bullets nested by two spaces a level, and
 * bold, underline and font size show inside a line. Only that markup is
 * understood; any other text (including tags) is shown as text, never as HTML.
 */
interface Item {
  depth: number;
  ordered: boolean;
  runs: RichRun[];
  children: Item[];
}

export function Runs({ runs }: { runs: RichRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let n: ReactNode = r.text;
        if (r.bold) n = <strong>{n}</strong>;
        if (r.underline) n = <u>{n}</u>;
        if (r.size && r.size !== 1) n = <span style={{ fontSize: `${r.size}em` }}>{n}</span>;
        return <span key={i}>{n}</span>;
      })}
    </>
  );
}

/** Nested lists from consecutive bullet lines (a deeper line belongs to the bullet above it). */
function tree(lines: Extract<RichBlock, { kind: "item" }>[]): Item[] {
  const root: Item[] = [];
  const stack: Item[] = [];
  for (const b of lines) {
    const item: Item = { depth: b.depth, ordered: b.ordered, runs: b.runs, children: [] };
    while (stack.length && stack[stack.length - 1]!.depth >= item.depth) stack.pop();
    if (stack.length) stack[stack.length - 1]!.children.push(item);
    else root.push(item);
    stack.push(item);
  }
  return root;
}

function List({ items, k }: { items: Item[]; k: string }) {
  const Tag = items[0]?.ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((it, i) => (
        <li key={`${k}-${i}`}>
          <Runs runs={it.runs} />
          {it.children.length > 0 && <List items={it.children} k={`${k}-${i}`} />}
        </li>
      ))}
    </Tag>
  );
}

export function BulletText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const out: ReactNode[] = [];
  let para: RichRun[][] = [];
  let bullets: Extract<RichBlock, { kind: "item" }>[] = [];
  const flushPara = () => {
    if (para.length)
      out.push(
        <p key={`p${out.length}`}>
          {para.map((runs, i) => (
            <span key={i}>
              {i > 0 && <br />}
              <Runs runs={runs} />
            </span>
          ))}
        </p>,
      );
    para = [];
  };
  const flushList = () => {
    if (bullets.length) out.push(<List key={`l${out.length}`} k={`l${out.length}`} items={tree(bullets)} />);
    bullets = [];
  };
  for (const b of parseRich(text ?? "")) {
    if (b.kind === "item") {
      flushPara();
      bullets.push(b);
    } else if (b.kind === "title") {
      flushPara();
      flushList();
      out.push(
        <h4 className="rt-title" key={`t${out.length}`}>
          <Runs runs={b.runs} />
        </h4>,
      );
    } else if (!b.runs.some((r) => r.text.trim())) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(b.runs);
    }
  }
  flushPara();
  flushList();
  return (
    <div className={`rich-text${className ? ` ${className}` : ""}`} data-testid={testId}>
      {out}
    </div>
  );
}

/** The same renderer under the name used across the dashboard. */
export const RichText = BulletText;
