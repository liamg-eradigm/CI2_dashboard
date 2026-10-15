import { describe, expect, it } from "vitest";
import { fromDoc, toDoc } from "./richDoc";

describe("formatted text in the editor (request 46)", () => {
  it("round-trips paragraphs, blank lines, titles, nested bullets, numbered lists and marks", () => {
    const text = [
      '### **Pricing** <span style="font-size:1.3em">update</span>',
      "Payers <u>pushed back</u>.",
      "",
      "- Rejections",
      "  - fell to **5%**",
      "    - new evidence",
      "- Uptake",
      "1. First",
      "2. Second",
      "Last line",
    ].join("\n");
    expect(fromDoc(toDoc(text))).toBe(text);
  });
  it("keeps plain text as it is, and an empty value empty", () => {
    expect(fromDoc(toDoc("Just text\nTwo lines"))).toBe("Just text\nTwo lines");
    expect(fromDoc(toDoc(""))).toBe("");
  });
  it("nests a bullet that skips a level under the one above", () => {
    expect(fromDoc(toDoc("- a\n    - b"))).toBe("- a\n  - b");
  });
});

describe("numbered lists in the editor (request 60)", () => {
  it("keeps a bullet's second line in it (a line break), and back", () => {
    const text = "1. First\n  more of it\n2. Second";
    const doc = toDoc(text);
    expect(doc.content).toHaveLength(1);
    expect(doc.content![0]!.content![0]!.content![0]!.content!.map((c) => c.type)).toEqual(["text", "hardBreak", "text"]);
    expect(fromDoc(doc)).toBe(text);
  });
  it("keeps the numbers of a list split by blank lines", () => {
    const text = "1. a\n\n2. b\n\n3. c";
    const doc = toDoc(text);
    expect(doc.content!.filter((n) => n.type === "orderedList").map((n) => n.attrs?.start ?? 1)).toEqual([1, 2, 3]);
    expect(fromDoc(doc)).toBe(text);
  });
});
