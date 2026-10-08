import type { ReactNode } from "react";

/**
 * Plain text with Word-style bullets, as typed in a `ListTextarea` (request
 * 44): each line break is kept, a blank line starts a new paragraph, and
 * lines starting with "- ", "* ", "+ " or "1. " are bullets, nested by two
 * spaces (or a tab) per level. Numbered markers make a numbered list.
 */
const ITEM = /^([ \t]*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;

interface Item {
  depth: number;
  ordered: boolean;
  text: string;
  children: Item[];
}

const depthOf = (indent: string) => Math.floor(indent.replace(/\t/g, "  ").length / 2);

/** Nested lists from consecutive bullet lines (a deeper line belongs to the bullet above it). */
function tree(lines: RegExpExecArray[]): Item[] {
  const root: Item[] = [];
  const stack: Item[] = [];
  for (const m of lines) {
    const item: Item = { depth: depthOf(m[1] ?? ""), ordered: /\d/.test(m[2] ?? ""), text: m[3] ?? "", children: [] };
    while (stack.length && stack[stack.length - 1]!.depth >= item.depth) stack.pop();
    // A bullet indented more than one level below its parent sits one level down.
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
          {it.text}
          {it.children.length > 0 && <List items={it.children} k={`${k}-${i}`} />}
        </li>
      ))}
    </Tag>
  );
}

export function BulletText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const out: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let bullets: RegExpExecArray[] = [];
  const flushPara = () => {
    if (para.length)
      out.push(
        <p key={`p${out.length}`}>
          {para.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {l}
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
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (m) {
      flushPara();
      bullets.push(m);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return (
    <div className={className} data-testid={testId}>
      {out}
    </div>
  );
}
