import { describe, expect, it } from "vitest";
import { indent, newline, outdent, type TextState } from "./listEditing";

/** "|" marks the caret, "[" "]" a selection. */
const st = (s: string): TextState => {
  const c = s.indexOf("|");
  if (c >= 0) return { value: s.replace("|", ""), start: c, end: c };
  const a = s.indexOf("[");
  const b = s.indexOf("]") - 1;
  return { value: s.replace("[", "").replace("]", ""), start: a, end: b };
};
const show = (t: TextState | null) => (t ? (t.start === t.end ? t.value.slice(0, t.start) + "|" + t.value.slice(t.start) : t.value) : null);

describe("Word-style bullets", () => {
  it("Tab makes a plain line a bullet, then indents it one level each time; Shift+Tab undoes it", () => {
    let t = indent(st("Deal terms|"));
    expect(show(t)).toBe("- Deal terms|");
    t = indent(t);
    expect(show(t)).toBe("  - Deal terms|");
    t = indent(t);
    expect(show(t)).toBe("    - Deal terms|");
    t = outdent(outdent(t));
    expect(show(t)).toBe("- Deal terms|");
    expect(show(outdent(t))).toBe("Deal terms|");
    expect(show(indent(st("|")))).toBe("- |");
  });

  it("Enter continues the list at the same level, counts numbered lists, and an empty bullet outdents or ends the list", () => {
    expect(show(newline(st("- One|")))).toBe("- One\n- |");
    expect(show(newline(st("  - Nested|")))).toBe("  - Nested\n  - |");
    expect(show(newline(st("1. First|")))).toBe("1. First\n2. |");
    expect(show(newline(st("- One\n  - |")))).toBe("- One\n- |");
    expect(show(newline(st("- One\n- |")))).toBe("- One\n|");
    expect(newline(st("Plain text|"))).toBeNull();
  });

  it("moves every selected line", () => {
    const t = indent(st("[- a\n- b]\nc"));
    expect(t.value).toBe("  - a\n  - b\nc");
    expect(outdent(t).value).toBe("- a\n- b\nc");
  });
});
